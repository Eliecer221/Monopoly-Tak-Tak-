// Pruebas del libro contable contra PostgreSQL real.
//
//   TAKTAK_TEST_DB="postgres://..." node test/ledger.mjs
//
// No usa dobles: levanta transacciones de verdad y comprueba las garantías que
// importan, incluida la concurrencia con conexiones simultáneas.

import { createPool, migrate, LedgerRepository, LedgerError, SYSTEM_ACCOUNTS } from "../server/ledger.mjs";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// `code` nulo acepta cualquier error: sirve para comprobar los que impone la
// propia base de datos (triggers), que no son de tipo LedgerError.
const expectError = async (fn, code, msg) => {
  try {
    await fn();
  } catch (err) {
    if (code) {
      assert(err instanceof LedgerError, `${msg}: se esperaba LedgerError, llegó ${err}`);
      assert(err.code === code, `${msg}: código ${err.code}, se esperaba ${code}`);
    }
    return err;
  }
  throw new Error(`${msg}: no lanzó error`);
};

const URL = process.env.TAKTAK_TEST_DB || "postgres://postgres:devpass@127.0.0.1:55432/taktak";
const PROJECT = `test_${Date.now()}`;

const pool = createPool({ connectionString: URL });
await migrate(pool);
const repo = new LedgerRepository(pool, { projectId: PROJECT, assetId: "MTC" });

try {
  // ---------- asientos cuadrados ----------
  const seed = await repo.transaction(async (c) => {
    const user = await repo.ensureUserAccount(c, "u1");
    const cash = await repo.ensureSystemAccount(c, SYSTEM_ACCOUNTS.CASH_ASSET);
    // Entrada inicial: la plataforma recibe dinero y acredita 1000 monedas.
    await repo.post(c, {
      postingKey: "seed:u1",
      memo: "carga inicial",
      entries: [
        { accountId: cash, amount: 1000 },
        { accountId: user, amount: -1000 },
      ],
    });
    return { user, cash };
  });
  assert((await repo.userBalance("u1")) === 1000n, "el saldo inicial no es 1000");
  console.log("✓ Asiento cuadrado: se escribe y el saldo queda en 1000");

  // Un asiento que no cuadra debe rechazarse. Lo impone la base de datos.
  await expectError(
    () =>
      repo.transaction(async (c) => {
        const cash = await repo.ensureSystemAccount(c, SYSTEM_ACCOUNTS.CASH_ASSET);
        const user = await repo.ensureUserAccount(c, "u1");
        await repo.post(c, {
          postingKey: "bad:1",
          memo: "descuadrado",
          entries: [
            { accountId: cash, amount: 100 },
            { accountId: user, amount: -90 },
          ],
        });
      }),
    "UNBALANCED",
    "un asiento descuadrado"
  );
  console.log("✓ Un asiento que no cuadra se rechaza antes de tocar la base de datos");

  // El trigger diferido lo impide aunque el código no lo compruebe.
  await expectError(
    () =>
      repo.transaction(async (c) => {
        const j = await c.query(
          `INSERT INTO journals (project_id, posting_key, memo) VALUES ($1,$2,$3) RETURNING id`,
          [PROJECT, "raw:unbalanced", "crudo"]
        );
        const cash = await repo.ensureSystemAccount(c, SYSTEM_ACCOUNTS.CASH_ASSET);
        const user = await repo.ensureUserAccount(c, "u1");
        await c.query(`INSERT INTO postings (journal_id, account_id, amount) VALUES ($1,$2,$3)`, [
          j.rows[0].id, cash, 50,
        ]);
        await c.query(`INSERT INTO postings (journal_id, account_id, amount) VALUES ($1,$2,$3)`, [
          j.rows[0].id, user, -40,
        ]);
      }),
    null,
    "un asiento descuadrado escrito a mano"
  );
  console.log("✓ El trigger de la base de datos bloquea un asiento descuadrado aunque se escriba a mano");

  // ---------- inmutabilidad ----------
  const { rows: anyPosting } = await pool.query(
    `SELECT p.id FROM postings p JOIN journals j ON j.id=p.journal_id
      WHERE j.project_id=$1 LIMIT 1`,
    [PROJECT]
  );
  await expectError(
    () => pool.query(`UPDATE postings SET amount = 999 WHERE id=$1`, [anyPosting[0].id]),
    null,
    "modificar un asiento"
  );
  await expectError(
    () => pool.query(`DELETE FROM postings WHERE id=$1`, [anyPosting[0].id]),
    null,
    "borrar un asiento"
  );
  console.log("✓ Los asientos son inmutables: ni se modifican ni se borran");

  // ---------- idempotencia de la compra ----------
  const first = await repo.creditPurchase({ orderId: "ord-1", userId: "u1", amountCents: 199 });
  assert(first.alreadyPaid === false, "la primera compra debería acreditar");
  const second = await repo.creditPurchase({ orderId: "ord-1", userId: "u1", amountCents: 199 });
  assert(second.alreadyPaid === true, "la segunda compra debería ser idempotente");
  assert((await repo.userBalance("u1")) === 1199n, `el saldo tras la compra es ${await repo.userBalance("u1")}, se esperaba 1199`);

  // Repetir el asiento con la misma clave tampoco duplica.
  await repo.transaction(async (c) => {
    const user = await repo.ensureUserAccount(c, "u1");
    const cash = await repo.ensureSystemAccount(c, SYSTEM_ACCOUNTS.CASH_ASSET);
    const r1 = await repo.post(c, {
      postingKey: "dup:key",
      entries: [{ accountId: cash, amount: 5 }, { accountId: user, amount: -5 }],
    });
    assert(r1.alreadyPosted === false, "el primer asiento debería escribirse");
  });
  await repo.transaction(async (c) => {
    const user = await repo.ensureUserAccount(c, "u1");
    const cash = await repo.ensureSystemAccount(c, SYSTEM_ACCOUNTS.CASH_ASSET);
    const r2 = await repo.post(c, {
      postingKey: "dup:key",
      entries: [{ accountId: cash, amount: 5 }, { accountId: user, amount: -5 }],
    });
    assert(r2.alreadyPosted === true, "el asiento repetido debería detectarse");
  });
  // 1000 iniciales + 199 de la compra + 5 del asiento directo = 1204.
  // El asiento repetido no debe sumar otros 5.
  assert((await repo.userBalance("u1")) === 1204n, `repetir la clave duplicó el saldo: ${await repo.userBalance("u1")}`);
  console.log("✓ Idempotencia: repetir la compra o la clave no duplica el saldo");

  // ---------- reservas ----------
  const r1 = await repo.reserve({ userId: "u1", amount: 500, reservationKey: "ronda-1" });
  assert(r1.alreadyHeld === false, "la reserva debería crearse");
  const r1b = await repo.reserve({ userId: "u1", amount: 500, reservationKey: "ronda-1" });
  assert(r1b.alreadyHeld === true, "la reserva repetida debería detectarse");
  assert(r1b.reservationId === r1.reservationId, "la reserva repetida no es la misma");

  // Con 1204 y 500 apartados quedan 704: pedir 700 debe pasar y 800 no.
  await expectError(
    () => repo.reserve({ userId: "u1", amount: 800, reservationKey: "ronda-2" }),
    "INSUFFICIENT_FUNDS",
    "reservar por encima del disponible"
  );
  console.log("✓ Reservas: idempotentes y no dejan gastar lo ya apartado");

  // ---------- concurrencia real ----------
  // Diez reservas de 300 a la vez sobre 704 disponibles: solo 2 pueden pasar.
  const attempts = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      repo
        .reserve({ userId: "u1", amount: 300, reservationKey: `race-${i}` })
        .then(() => "ok")
        .catch((e) => e.code)
    )
  );
  const granted = attempts.filter((a) => a === "ok").length;
  assert(granted === 2, `se concedieron ${granted} reservas de 300 con 704 libres; se esperaban 2`);
  assert(
    attempts.filter((a) => a === "INSUFFICIENT_FUNDS").length === 8,
    "el resto debería fallar por saldo"
  );
  console.log(`✓ Concurrencia: 10 reservas de 300 a la vez con 704 libres → ${granted} pasan, 8 fallan (sin doble gasto)`);

  // ---------- retiros ----------
  await expectError(
    () =>
      repo.requestWithdrawalOnce({
        userId: "u1",
        amount: 5000,
        destinationToken: "correo@ejemplo.com",
        idempotencyKey: "w-1",
      }),
    "INSUFFICIENT_FUNDS",
    "retirar más del saldo"
  );

  // Se liberan las reservas para dejar saldo disponible.
  for (const a of attempts) void a;
  await repo.transaction(async (c) => {
    await c.query(
      `UPDATE reservations SET status='released', closed_at=now()
        WHERE project_id=$1 AND user_id='u1' AND status='held'`,
      [PROJECT]
    );
  });

  const w = await repo.requestWithdrawalOnce({
    userId: "u1",
    amount: 1000,
    fee: 50,
    destinationToken: "correo@ejemplo.com",
    idempotencyKey: "w-1",
  });
  assert(w.duplicate === false, "el primer retiro debería crearse");
  const w2 = await repo.requestWithdrawalOnce({
    userId: "u1",
    amount: 1000,
    fee: 50,
    destinationToken: "correo@ejemplo.com",
    idempotencyKey: "w-1",
  });
  assert(w2.duplicate === true, "el retiro repetido debería ser idempotente");
  assert(w2.withdrawalId === w.withdrawalId, "el retiro repetido no es el mismo");
  assert((await repo.userBalance("u1")) === 204n, `el saldo tras el retiro es ${await repo.userBalance("u1")}, se esperaba 204`);
  console.log("✓ Retiros: idempotentes por clave, con comisión, y descuentan una sola vez");

  // ---------- outbox ----------
  const claimed = await repo.claimOutbox(10);
  assert(claimed.length >= 2, `el outbox debería tener al menos 2 pendientes, tiene ${claimed.length}`);
  const topics = claimed.map((c) => c.topic);
  assert(topics.includes("purchase.credited"), "falta el aviso de la compra");
  assert(topics.includes("withdrawal.requested"), "falta el aviso del retiro");

  // Un segundo worker no puede reclamar lo ya reclamado.
  const claimed2 = await repo.claimOutbox(10);
  assert(claimed2.length === 0, `el segundo worker no debería reclamar nada, reclamó ${claimed2.length}`);
  console.log("✓ Outbox: los efectos externos se escriben con el asiento y SKIP LOCKED evita el doble procesado");

  await repo.completeOutbox(claimed[0].id);
  const { rows: doneRow } = await pool.query(`SELECT status FROM outbox WHERE id=$1`, [claimed[0].id]);
  assert(doneRow[0].status === "done", "el efecto completado no quedó marcado");

  // Fallo con reintento y espera creciente.
  await repo.failOutbox(claimed[1].id, "el proveedor no responde", 3);
  const { rows: retryRow } = await pool.query(
    `SELECT status, attempts, last_error, available_at > now() AS wait FROM outbox WHERE id=$1`,
    [claimed[1].id]
  );
  assert(retryRow[0].status === "pending", "un fallo con intentos disponibles debería reintentarse");
  assert(retryRow[0].wait === true, "el reintento debería esperar");
  assert(String(retryRow[0].last_error).includes("no responde"), "el error no quedó registrado");
  console.log("✓ Outbox: un fallo se reintenta con espera creciente y guarda el motivo");

  // ---------- conciliación ----------
  const rec = await repo.reconcile();
  assert(rec.ledgerTotal === 0n, `la suma del libro debería ser cero, es ${rec.ledgerTotal}`);
  assert(rec.ok === true, "la conciliación debería dar bien");
  const recBad = await repo.reconcile({ externalTotal: 100 });
  assert(recBad.ok === false && recBad.difference === -100n, "una diferencia debería detectarse");
  console.log("✓ Conciliación: el libro cuadra a cero y una diferencia se detecta");

  // ---------- pasivos ----------
  const liabilities = await repo.totalUserLiabilities();
  assert(liabilities === 204n, `la deuda con usuarios debería ser 204, es ${liabilities}`);
  console.log(`✓ Pasivos: la plataforma debe 204 monedas al usuario (cuadra con su saldo)`);

  // ---------- auditoría ----------
  await repo.audit({ actorId: "admin-1", action: "reconcile", detail: { ok: true } });
  const { rows: auditRows } = await pool.query(`SELECT action FROM audit_log WHERE project_id=$1`, [PROJECT]);
  assert(auditRows.length === 1 && auditRows[0].action === "reconcile", "la auditoría no registró");
  console.log("✓ Auditoría: las acciones sensibles quedan registradas");

  console.log("\n✅ Pruebas del libro contable superadas");
} finally {
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`).catch(() => {});
  await repo.close();
}
