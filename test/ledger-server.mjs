// Prueba el servidor real contra PostgreSQL real, extremo a extremo.
//   DATABASE_URL=... node test/ledger-server.mjs
import { createServer } from "../server/server.mjs";
import { createPool, migrate, LedgerRepository } from "../server/ledger.mjs";
import { totpCode } from "../server/totp.mjs";

const URL = process.env.DATABASE_URL || "postgres://postgres:devpass@127.0.0.1:55432/taktak";
const pool = createPool({ connectionString: URL });
await migrate(pool);
await pool.query(`TRUNCATE journals, postings, balances, accounts, reservations, withdrawals, purchases, outbox, reconciliations, audit_log RESTART IDENTITY CASCADE`);

const assert = (c, m) => { if (!c) throw new Error(m); };

const env = {
  TAKTAK_MEMORY_DB: "1",
  DATABASE_URL: URL,
  ADMIN_TOKEN: "tok-admin-test",
  PROJECT_ID: "tak-tak",
  COIN_SYMBOL: "MTC",
  TAKTAK_DEV_CODES: "1",
};
const server = createServer({ env });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, opts = {}) => {
  const res = await fetch(base + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
};

try {
  // El health debe anunciar el libro contable activo y Airtm apagado.
  const health = await call("/health");
  assert(health.json.ledger === true, "el health debería indicar el libro activo");
  assert(health.json.airtm.enabled === false, "Airtm debería estar apagado");
  console.log("✓ Health: libro contable activo, Airtm apagado");

  // Registrar un usuario.
  const reg = await call("/api/auth/signup", {
    method: "POST",
    body: { name: "Probador", email: `ledger${Date.now()}@ejemplo.com`, password: "clave-segura-123" },
  });
  assert(reg.status === 201 || reg.status === 200, `registro falló: ${reg.status} ${reg.text}`);
  const token = reg.json.token;
  assert(token, "el registro no devolvió token");
  const auth = { Authorization: `Bearer ${token}` };
  console.log("✓ Cuenta creada en el servidor real");

  // Saldo inicial cero según el libro.
  const bal0 = await call("/api/ledger/balance", { headers: auth });
  assert(bal0.json.amount === "0", `el saldo inicial debería ser 0, es ${bal0.json.amount}`);
  console.log("✓ Libro: el saldo inicial es 0 según los asientos");

  // Sin KYC no se puede retirar.
  const noKyc = await call("/api/ledger/withdraw", {
    method: "POST", headers: auth,
    body: { amount: 100, destinationToken: "correo@ejemplo.com", idempotencyKey: "w1" },
  });
  assert(noKyc.status === 403, `sin KYC debería ser 403, fue ${noKyc.status}`);
  assert(noKyc.json.code === "KYC_REQUIRED", `código ${noKyc.json.code}`);
  console.log("✓ Retiro sin KYC: 403 KYC_REQUIRED");

  // Verificar correo (con el código de desarrollo).
  const vs = await call("/api/auth/verify/start", { method: "POST", headers: auth, body: { channel: "email" } });
  assert(vs.status === 200 && vs.json.devCode, `verify/start falló: ${vs.status} ${vs.text}`);
  const vc = await call("/api/auth/verify/confirm", {
    method: "POST", headers: auth, body: { channel: "email", code: vs.json.devCode },
  });
  assert(vc.status === 200, `verify/confirm falló: ${vc.status} ${vc.text}`);
  console.log("✓ Correo verificado");

  // Activar 2FA.
  const setup = await call("/api/auth/2fa/setup", { method: "POST", headers: auth });
  assert(setup.status === 200 && setup.json.secret, `2fa/setup falló: ${setup.status} ${setup.text}`);
  const code = totpCode(setup.json.secret);
  const en = await call("/api/auth/2fa/enable", { method: "POST", headers: auth, body: { code } });
  assert(en.status === 200, `2fa/enable falló: ${en.status} ${en.text}`);
  console.log("✓ 2FA activado");

  // KYC: documento y selfie válidos, y decisión del administrador.
  const bigImage = (tag) => "data:image/png;base64," + Buffer.from(tag.padEnd(2400, "x")).toString("base64");
  const ks = await call("/api/kyc/submit", {
    method: "POST", headers: auth,
    body: { docType: "cedula", docNumber: "12345678", docImage: bigImage("doc"), selfie: bigImage("selfie"), consent: true },
  });
  assert(ks.status === 201, `kyc/submit falló: ${ks.status} ${ks.text}`);
  const kd = await call("/api/kyc/decide", {
    method: "POST", headers: { "x-admin-token": "tok-admin-test" },
    body: { userId: reg.json.user.id, status: "verified" },
  });
  assert(kd.status === 200, `kyc/decide falló: ${kd.status} ${kd.text}`);
  console.log("✓ KYC verificado por el administrador");

  // Ahora sí hay saldo: se acredita con un asiento real, en una sola
  // transacción (usar pool.query suelto partiría el asiento y el trigger lo
  // rechazaría, que es justo lo que debe pasar).
  const repo = new LedgerRepository(pool, { projectId: "tak-tak", assetId: "MTC" });
  await repo.transaction(async (c) => {
    const userAcc = await repo.ensureUserAccount(c, reg.json.user.id);
    const cashAcc = await repo.ensureSystemAccount(c, "cash_asset");
    await repo.post(c, {
      postingKey: "seed:test",
      memo: "saldo de prueba",
      entries: [
        { accountId: cashAcc, amount: 500 },
        { accountId: userAcc, amount: -500 },
      ],
    });
  });

  const bal1 = await call("/api/ledger/balance", { headers: auth });
  assert(bal1.json.amount === "500", `el saldo debería ser 500, es ${bal1.json.amount}`);
  console.log("✓ Saldo acreditado con un asiento real: 500 monedas");

  // Retiro con todo en regla.
  const ok = await call("/api/ledger/withdraw", {
    method: "POST", headers: auth,
    body: { amount: 200, fee: 10, destinationToken: "correo@ejemplo.com", idempotencyKey: "w-real-1" },
  });
  assert(ok.status === 201, `el retiro válido debería ser 201, fue ${ok.status} ${ok.text}`);
  assert(ok.json.duplicate === false, "el primer retiro no debería ser duplicado");
  console.log("✓ Retiro con KYC, correo y 2FA: aceptado (201)");

  // Repetir la clave devuelve el mismo retiro, sin duplicar.
  const dup = await call("/api/ledger/withdraw", {
    method: "POST", headers: auth,
    body: { amount: 200, fee: 10, destinationToken: "correo@ejemplo.com", idempotencyKey: "w-real-1" },
  });
  assert(dup.status === 200 && dup.json.duplicate === true, "la clave repetida debería ser idempotente");
  assert(dup.json.withdrawalId === ok.json.withdrawalId, "debería devolver el mismo retiro");
  const bal2 = await call("/api/ledger/balance", { headers: auth });
  assert(bal2.json.amount === "300", `el saldo debería quedar en 300, es ${bal2.json.amount}`);
  console.log("✓ Idempotencia: repetir la clave no descuenta dos veces (saldo 300)");

  // Conciliación sin token: prohibida.
  const noAdmin = await call("/api/ledger/reconcile", { method: "POST" });
  assert(noAdmin.status === 403, `sin token debería ser 403, fue ${noAdmin.status}`);
  console.log("✓ Conciliación sin token de administrador: 403");

  // Conciliación con token: el libro cuadra a cero.
  const rec = await call("/api/ledger/reconcile", { method: "POST", headers: { "x-admin-token": "tok-admin-test" } });
  assert(rec.status === 200, `con token debería ser 200, fue ${rec.status} ${rec.text}`);
  assert(rec.json.ledgerTotal === "0", `el libro debería cuadrar a cero, es ${rec.json.ledgerTotal}`);
  assert(rec.json.ok === true, "la conciliación debería dar bien");
  console.log("✓ Conciliación con token: el libro cuadra a cero");

  console.log("\n✅ Pruebas del servidor con el libro contable superadas");
} finally {
  server.close();
  await new Promise((r) => setTimeout(r, 200));
  await pool.end().catch(() => {});
}
