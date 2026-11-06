// Repositorio financiero transaccional sobre PostgreSQL.
//
// Garantías que ofrece:
//   1. Todo asiento cuadra a cero. Un trigger diferido lo impone en la base de
//      datos, no en el código, así que no se puede saltar.
//   2. El saldo se mueve bloqueando la fila con SELECT ... FOR UPDATE, de modo
//      que dos operaciones a la vez no pueden gastar las mismas monedas.
//   3. Cada operación lleva clave de idempotencia única. Repetirla devuelve el
//      resultado anterior en vez de duplicar el movimiento.
//   4. Los efectos externos van al outbox dentro de la misma transacción: no
//      puede existir un asiento sin su aviso ni al contrario.
//   5. Los asientos son inmutables. Un error se corrige con un asiento nuevo.
//
// Convención de signos (partida doble clásica):
//   - En cada asiento, la suma de las partidas es CERO.
//   - Débito = positivo. Crédito = negativo.
//   - Los activos y gastos son de débito: su saldo natural es positivo.
//   - Los pasivos e ingresos son de crédito: su saldo natural es negativo.
// Por eso `rawBalance` devuelve el signo contable y `liabilityBalance` lo
// invierte, para que "lo que se debe al usuario" sea un número positivo.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new LedgerError(code, message);
};

// ---------- cuentas del sistema ----------
export const SYSTEM_ACCOUNTS = {
  // Lo que la plataforma tiene y debe a los usuarios.
  COINS_LIABILITY: "coins_liability",
  CASH_ASSET: "cash_asset",
  PURCHASE_REVENUE: "purchase_revenue",
  WITHDRAWAL_FEE_REVENUE: "withdrawal_fee_revenue",
  ROUND_ENTRY_REVENUE: "round_entry_revenue",
};

export function createPool({ connectionString, max = 10 } = {}) {
  if (!connectionString) fail("NO_CONNECTION", "falta la cadena de conexión");
  return new Pool({ connectionString, max });
}

export async function migrate(pool, schemaPath = path.join(import.meta.dirname, "schema.sql")) {
  const sql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(sql);
}

export class LedgerRepository {
  constructor(pool, { projectId, assetId = "MTC" } = {}) {
    if (!pool) fail("NO_POOL", "falta el pool de PostgreSQL");
    if (!projectId) fail("NO_PROJECT", "falta PROJECT_ID");
    this.pool = pool;
    this.projectId = projectId;
    this.assetId = assetId;
  }

  // Ejecuta `fn` dentro de una transacción. Si lanza, se revierte todo.
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------- cuentas ----------

  async ensureUserAccount(client, userId, kind = "liability") {
    const existing = await client.query(
      `SELECT id FROM accounts
        WHERE project_id=$1 AND user_id=$2 AND asset_id=$3 AND kind=$4`,
      [this.projectId, userId, this.assetId, kind]
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const inserted = await client.query(
      `INSERT INTO accounts (project_id, user_id, kind, asset_id, name)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [this.projectId, userId, kind, this.assetId, `user:${userId}`]
    );
    if (inserted.rows[0]) {
      const id = inserted.rows[0].id;
      await client.query(
        `INSERT INTO balances (account_id, amount) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
        [id]
      );
      return id;
    }

    const again = await client.query(
      `SELECT id FROM accounts
        WHERE project_id=$1 AND user_id=$2 AND asset_id=$3 AND kind=$4`,
      [this.projectId, userId, this.assetId, kind]
    );
    return again.rows[0].id;
  }

  async ensureSystemAccount(client, name) {
    const existing = await client.query(
      `SELECT id FROM accounts
        WHERE project_id=$1 AND user_id IS NULL AND asset_id=$2 AND kind=$3 AND name=$4`,
      [this.projectId, this.assetId, name, kindForSystem(name)]
    );
    if (existing.rows[0]) return existing.rows[0].id;

    const inserted = await client.query(
      `INSERT INTO accounts (project_id, user_id, kind, asset_id, name)
       VALUES ($1, NULL, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [this.projectId, kindForSystem(name), this.assetId, name]
    );
    if (inserted.rows[0]) {
      await client.query(
        `INSERT INTO balances (account_id, amount) VALUES ($1, 0) ON CONFLICT DO NOTHING`,
        [inserted.rows[0].id]
      );
      return inserted.rows[0].id;
    }

    const again = await client.query(
      `SELECT id FROM accounts
        WHERE project_id=$1 AND user_id IS NULL AND asset_id=$2 AND kind=$3 AND name=$4`,
      [this.projectId, this.assetId, kindForSystem(name), name]
    );
    return again.rows[0].id;
  }

  // ---------- saldo ----------

  // Saldo con signo contable (débito positivo). Es la verdad contable.
  async rawBalance(client, accountId) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(amount),0)::bigint AS amount FROM postings WHERE account_id=$1`,
      [accountId]
    );
    return BigInt(rows[0].amount);
  }

  // Saldo de una cuenta de pasivo, en positivo: lo que la plataforma debe.
  async liabilityBalance(client, accountId) {
    return -(await this.rawBalance(client, accountId));
  }

  // Total apartado por el usuario. Solo debe llamarse con la fila del saldo ya
  // bloqueada, para que el valor no cambie entre la comprobación y el uso.
  async queryHeld(client, userId) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(amount),0)::bigint AS held FROM reservations
        WHERE project_id=$1 AND user_id=$2 AND asset_id=$3 AND status='held'`,
      [this.projectId, userId, this.assetId]
    );
    return BigInt(rows[0].held);
  }

  // Bloquea la fila del saldo para poder comprobarlo y moverlo sin carreras.
  async lockBalance(client, accountId) {
    await client.query(`SELECT amount FROM balances WHERE account_id=$1 FOR UPDATE`, [accountId]);
  }

  // Monedas del usuario, en positivo.
  async userBalance(userId) {
    return this.transaction(async (client) => {
      const id = await this.ensureUserAccount(client, userId);
      return this.liabilityBalance(client, id);
    });
  }

  // ---------- asientos ----------

  // Escribe un asiento cuadrado. `entries` es [{ accountId, amount }] y debe
  // sumar cero. Si la clave ya existe, devuelve el asiento anterior.
  async post(client, { postingKey, memo = "", entries }) {
    if (!postingKey) fail("NO_KEY", "falta la clave de idempotencia");
    if (!Array.isArray(entries) || entries.length < 2) {
      fail("BAD_ENTRIES", "un asiento necesita al menos dos partidas");
    }

    const total = entries.reduce((s, e) => s + BigInt(e.amount), 0n);
    if (total !== 0n) fail("UNBALANCED", `el asiento no cuadra: suma ${total}`);

    const existing = await client.query(
      `SELECT id FROM journals WHERE project_id=$1 AND posting_key=$2`,
      [this.projectId, postingKey]
    );
    if (existing.rows[0]) {
      return { journalId: existing.rows[0].id, alreadyPosted: true };
    }

    const journal = await client.query(
      `INSERT INTO journals (project_id, posting_key, memo) VALUES ($1,$2,$3) RETURNING id`,
      [this.projectId, postingKey, memo]
    );
    const journalId = journal.rows[0].id;

    for (const entry of entries) {
      await client.query(
        `INSERT INTO postings (journal_id, account_id, amount) VALUES ($1,$2,$3)`,
        [journalId, entry.accountId, entry.amount.toString()]
      );
      await client.query(
        `UPDATE balances SET amount = amount + $2, updated_at = now() WHERE account_id = $1`,
        [entry.accountId, entry.amount.toString()]
      );
    }

    return { journalId, alreadyPosted: false };
  }

  // ---------- compra de monedas ----------

  // Acredita una compra ya validada. Idempotente por orden.
  //   Debe:  caja (entra el dinero)
  //   Haber: monedas del usuario (lo que le debemos)
  //   Haber: ingreso por venta (lo que gana la plataforma)
  // El importe pagado se reparte: `coinsCents` en monedas y el resto en ingreso.
  async creditPurchase({ orderId, userId, amountCents, coinsCents = amountCents, reference = "" }) {
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      fail("BAD_AMOUNT", "importe inválido");
    }
    if (coinsCents < 0 || coinsCents > amountCents) {
      fail("BAD_SPLIT", "el reparto de la compra es inválido");
    }

    return this.transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, status FROM purchases WHERE project_id=$1 AND order_id=$2`,
        [this.projectId, orderId]
      );
      if (existing.rows[0]?.status === "paid") {
        return { alreadyPaid: true, orderId };
      }

      await client.query(
        `INSERT INTO purchases (project_id, order_id, user_id, product_id, amount_cents, status, reference)
         VALUES ($1,$2,$3,$4,$5,'pending',$6)
         ON CONFLICT (project_id, order_id) DO NOTHING`,
        [this.projectId, orderId, userId, "coins", amountCents, reference]
      );

      const user = await this.ensureUserAccount(client, userId);
      const cash = await this.ensureSystemAccount(client, SYSTEM_ACCOUNTS.CASH_ASSET);
      const revenue = await this.ensureSystemAccount(client, SYSTEM_ACCOUNTS.PURCHASE_REVENUE);

      await this.lockBalance(client, user);

      const fee = amountCents - coinsCents;
      const entries = [
        { accountId: cash, amount: amountCents },
        { accountId: user, amount: -coinsCents },
      ];
      if (fee > 0) entries.push({ accountId: revenue, amount: -fee });

      await this.post(client, {
        postingKey: `purchase:${orderId}`,
        memo: `compra ${orderId}`,
        entries,
      });

      await client.query(
        `UPDATE purchases SET status='paid', paid_at=now() WHERE project_id=$1 AND order_id=$2`,
        [this.projectId, orderId]
      );

      await this.enqueue(client, {
        topic: "purchase.credited",
        dedupeKey: `purchase.credited:${orderId}`,
        payload: { orderId, userId, amountCents, coinsCents },
      });

      return { alreadyPaid: false, orderId };
    });
  }

  // ---------- reservas ----------

  // Aparta monedas. Se comprueba el saldo con la fila bloqueada, así que dos
  // reservas simultáneas no pueden gastar las mismas monedas.
  async reserve({ userId, amount, reason = "", reservationKey }) {
    if (!Number.isInteger(amount) || amount <= 0) fail("BAD_AMOUNT", "reserva inválida");
    if (!reservationKey) fail("NO_KEY", "falta la clave de la reserva");

    return this.transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, status, amount FROM reservations WHERE project_id=$1 AND user_id=$2 AND reason=$3 AND status='held'`,
        [this.projectId, userId, reservationKey]
      );
      if (existing.rows[0]) {
        return { reservationId: existing.rows[0].id, alreadyHeld: true };
      }

      const user = await this.ensureUserAccount(client, userId);

      // El bloqueo va PRIMERO. Lo reservado se lee después, ya en exclusiva:
      // si se leyera antes, dos transacciones verían el mismo disponible y
      // ambas pasarían, gastando las mismas monedas.
      await this.lockBalance(client, user);
      const balance = await this.liabilityBalance(client, user);
      const held = await this.queryHeld(client, userId);
      const available = balance - held;

      if (available < BigInt(amount)) {
        fail("INSUFFICIENT_FUNDS", `saldo disponible ${available}, se piden ${amount}`);
      }

      const inserted = await client.query(
        `INSERT INTO reservations (project_id, user_id, asset_id, amount, reason)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [this.projectId, userId, this.assetId, amount, reservationKey]
      );

      return { reservationId: inserted.rows[0].id, alreadyHeld: false, available: available - BigInt(amount) };
    });
  }

  async releaseReservation({ reservationId }) {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, status FROM reservations WHERE id=$1 AND project_id=$2 FOR UPDATE`,
        [reservationId, this.projectId]
      );
      if (!rows[0]) fail("NO_RESERVATION", "la reserva no existe");
      if (rows[0].status !== "held") fail("NOT_HELD", "la reserva ya está cerrada");
      await client.query(
        `UPDATE reservations SET status='released', closed_at=now() WHERE id=$1`,
        [reservationId]
      );
      return { released: true };
    });
  }

  // Consume la reserva y cobra la entrada. El importe va del usuario al ingreso.
  async consumeReservation({ reservationId, postingKey, memo = "" }) {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, user_id, amount, status FROM reservations
          WHERE id=$1 AND project_id=$2 FOR UPDATE`,
        [reservationId, this.projectId]
      );
      if (!rows[0]) fail("NO_RESERVATION", "la reserva no existe");
      if (rows[0].status !== "held") fail("NOT_HELD", "la reserva ya está cerrada");

      const user = await this.ensureUserAccount(client, rows[0].user_id);
      const revenue = await this.ensureSystemAccount(client, SYSTEM_ACCOUNTS.ROUND_ENTRY_REVENUE);
      await this.lockBalance(client, user);

      await this.post(client, {
        postingKey,
        memo,
        entries: [
          { accountId: user, amount: -BigInt(rows[0].amount) },
          { accountId: revenue, amount: BigInt(rows[0].amount) },
        ],
      });

      await client.query(
        `UPDATE reservations SET status='consumed', closed_at=now() WHERE id=$1`,
        [reservationId]
      );
      return { consumed: true, amount: BigInt(rows[0].amount) };
    });
  }

  // ---------- retiros ----------

  // Reserva el saldo y crea el retiro, una sola vez por clave de idempotencia.
  async requestWithdrawalOnce({ userId, amount, fee = 0, destinationToken, idempotencyKey, withdrawalId }) {
    if (!idempotencyKey) fail("NO_KEY", "falta la clave de idempotencia");
    if (!destinationToken) fail("NO_DESTINATION", "falta el destino");
    const net = amount - fee;
    if (net <= 0) fail("BAD_AMOUNT", "el neto del retiro debe ser positivo");

    return this.transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, withdrawal_id, status FROM withdrawals
          WHERE project_id=$1 AND user_id=$2 AND idempotency_key=$3`,
        [this.projectId, userId, idempotencyKey]
      );
      if (existing.rows[0]) {
        return { withdrawalId: existing.rows[0].withdrawal_id, status: existing.rows[0].status, duplicate: true };
      }

      const user = await this.ensureUserAccount(client, userId);

      // Igual que en las reservas: bloquear primero y calcular después.
      await this.lockBalance(client, user);
      const balance = await this.liabilityBalance(client, user);
      const available = balance - (await this.queryHeld(client, userId));
      if (available < BigInt(amount)) {
        fail("INSUFFICIENT_FUNDS", `saldo disponible ${available}, se piden ${amount}`);
      }

      const id = withdrawalId || `w_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Se apaga el pasivo de monedas (débito), sale efectivo de la caja
      // (crédito) y se reconoce la comisión como ingreso (crédito).
      const cash = await this.ensureSystemAccount(client, SYSTEM_ACCOUNTS.CASH_ASSET);
      const feeRevenue = await this.ensureSystemAccount(client, SYSTEM_ACCOUNTS.WITHDRAWAL_FEE_REVENUE);

      const entries = [
        { accountId: user, amount: amount },
        { accountId: cash, amount: -(amount - fee) },
      ];
      if (fee > 0) entries.push({ accountId: feeRevenue, amount: -fee });

      await this.post(client, {
        postingKey: `withdrawal:${id}`,
        memo: `retiro ${id}`,
        entries,
      });

      await client.query(
        `INSERT INTO withdrawals
           (project_id, withdrawal_id, user_id, asset_id, amount, fee, net, destination_token, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [this.projectId, id, userId, this.assetId, amount, fee, net, destinationToken, idempotencyKey]
      );

      await this.enqueue(client, {
        topic: "withdrawal.requested",
        dedupeKey: `withdrawal.requested:${id}`,
        payload: { withdrawalId: id, userId, amount, fee, net, destinationToken },
      });

      return { withdrawalId: id, status: "requested", duplicate: false };
    });
  }

  // ---------- outbox ----------

  async enqueue(client, { topic, payload, dedupeKey, availableAt = null }) {
    await client.query(
      `INSERT INTO outbox (project_id, topic, payload, dedupe_key, available_at)
       VALUES ($1,$2,$3,$4, COALESCE($5, now()))
       ON CONFLICT (project_id, dedupe_key) DO NOTHING`,
      [this.projectId, topic, JSON.stringify(payload), dedupeKey, availableAt]
    );
  }

  // Toma un lote de efectos pendientes bloqueándolos, para que dos workers no
  // procesen el mismo. SKIP LOCKED permite que varios workers avancen a la vez.
  async claimOutbox(limit = 10) {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, topic, payload, attempts FROM outbox
          WHERE project_id=$1 AND status='pending' AND available_at <= now()
          ORDER BY id
          LIMIT $2
          FOR UPDATE SKIP LOCKED`,
        [this.projectId, limit]
      );
      if (!rows.length) return [];
      await client.query(
        `UPDATE outbox SET status='processing', attempts = attempts + 1 WHERE id = ANY($1::bigint[])`,
        [rows.map((r) => r.id)]
      );
      return rows;
    });
  }

  async completeOutbox(id) {
    await this.pool.query(
      `UPDATE outbox SET status='done', processed_at=now() WHERE id=$1`,
      [id]
    );
  }

  // Reintento con espera creciente. Tras `maxAttempts` queda como fallido para
  // que una persona lo revise; no se pierde.
  async failOutbox(id, error, maxAttempts = 5) {
    await this.pool.query(
      `UPDATE outbox
          SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
              last_error = $3,
              available_at = now() + (interval '1 second' * power(2, attempts))
        WHERE id = $1`,
      [id, maxAttempts, String(error).slice(0, 500)]
    );
  }

  // ---------- conciliación ----------

  // Comprueba que la suma de los asientos de un activo es cero. Si el libro está
  // bien, cada moneda que se debe está respaldada por dinero o por ingreso.
  async reconcile({ externalTotal = null } = {}) {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(p.amount),0)::bigint AS total
           FROM postings p JOIN accounts a ON a.id = p.account_id
          WHERE a.project_id=$1 AND a.asset_id=$2`,
        [this.projectId, this.assetId]
      );
      const ledgerTotal = BigInt(rows[0].total);
      const external = externalTotal === null ? ledgerTotal : BigInt(externalTotal);
      const difference = ledgerTotal - external;
      const ok = difference === 0n;

      await client.query(
        `INSERT INTO reconciliations (project_id, asset_id, ledger_total, external_total, difference, ok, detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          this.projectId,
          this.assetId,
          ledgerTotal.toString(),
          external.toString(),
          difference.toString(),
          ok,
          JSON.stringify({ note: "suma del libro; debe ser cero" }),
        ]
      );

      return { ledgerTotal, externalTotal: external, difference, ok };
    });
  }

  // Suma de lo que la plataforma debe a los usuarios.
  async totalUserLiabilities() {
    return this.transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(p.amount),0)::bigint AS total
           FROM postings p JOIN accounts a ON a.id = p.account_id
          WHERE a.project_id=$1 AND a.asset_id=$2 AND a.kind='liability'`,
        [this.projectId, this.assetId]
      );
      // Las cuentas de pasivo son de crédito: se invierte el signo.
      return -BigInt(rows[0].total);
    });
  }

  async audit({ actorId = null, action, target = null, detail = {} }) {
    await this.pool.query(
      `INSERT INTO audit_log (project_id, actor_id, action, target, detail) VALUES ($1,$2,$3,$4,$5)`,
      [this.projectId, actorId, action, target, JSON.stringify(detail)]
    );
  }

  async close() {
    await this.pool.end();
  }
}

function kindForSystem(name) {
  if (name === SYSTEM_ACCOUNTS.CASH_ASSET) return "asset";
  if (name === SYSTEM_ACCOUNTS.COINS_LIABILITY) return "liability";
  return "revenue";
}
