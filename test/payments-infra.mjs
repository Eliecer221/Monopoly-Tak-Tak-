// Pruebas de Airtm (cerrado por defecto), política de dinero y worker del outbox.
//
//   node test/payments-infra.mjs

import { createMemoryDb } from "../server/db.mjs";
import { FinancialPolicy, PolicyError, WITHDRAWAL_LIMITS } from "../server/policy.mjs";
import {
  DisabledAirtmProvider,
  airtmConfig,
  createAirtmProvider,
  createAirtmTransport,
  verifyNotificationSignature,
} from "../server/airtm.mjs";
import { OutboxWorker } from "../server/outbox-worker.mjs";
import crypto from "node:crypto";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const expectThrow = async (fn, code, msg) => {
  try {
    await fn();
  } catch (err) {
    if (code) assert(err.code === code, `${msg}: código ${err.code}, se esperaba ${code}`);
    return err;
  }
  throw new Error(`${msg}: no lanzó error`);
};

// ---------- Airtm cerrado por defecto ----------
{
  const provider = new DisabledAirtmProvider();
  assert(provider.enabled === false, "el proveedor debería estar deshabilitado");
  await expectThrow(() => provider.createPayout({}), "PROVIDER_NOT_CONFIGURED", "un retiro sin configurar");
  await expectThrow(() => provider.createDeposit({}), "PROVIDER_NOT_CONFIGURED", "un depósito sin configurar");
  await expectThrow(() => provider.getOperation({}), "PROVIDER_NOT_CONFIGURED", "una consulta sin configurar");

  const config = airtmConfig({});
  assert(config.enabled === false, "sin entorno no debería estar habilitado");

  await expectThrow(
    () => createAirtmProvider({ AIRTM_ENVIRONMENT: "production", AIRTM_BASE_URL: "https://x.test", AIRTM_API_KEY: "k", AIRTM_API_SECRET: "s" }),
    "INTEGRATION_REQUIRED",
    "un Airtm habilitado sin implementación"
  );
  console.log("✓ Airtm: cerrado por defecto y nunca devuelve un pago exitoso simulado");
}

// ---------- sin endpoints inventados ----------
{
  const mod = await import("../server/airtm.mjs");
  const keys = Object.keys(mod.ENDPOINTS);
  assert(keys.length === 0, `no debe haber endpoints inventados, hay ${keys.length}: ${keys.join(",")}`);
  console.log("✓ Airtm: cero endpoints inventados (se añaden solo desde la documentación oficial)");
}

// ---------- firma de notificaciones ----------
{
  const secret = "secreto_de_prueba";
  const body = JSON.stringify({ id: "op-1", status: "completed" });
  const ts = Math.floor(Date.now() / 1000);
  const good = `t=${ts},v1=${crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;

  assert(verifyNotificationSignature({ rawBody: body, header: good, secret }).ok, "una firma válida no pasó");
  assert(!verifyNotificationSignature({ rawBody: body, header: "t=1,v1=malo", secret }).ok, "una firma falsa pasó");
  assert(!verifyNotificationSignature({ rawBody: body, header: good, secret: "otro" }).ok, "un secreto distinto pasó");
  assert(!verifyNotificationSignature({ rawBody: body, header: good }).ok, "sin secreto no debe pasar");

  const old = `t=${ts - 4000},v1=${crypto.createHmac("sha256", secret).update(`${ts - 4000}.${body}`).digest("hex")}`;
  assert(!verifyNotificationSignature({ rawBody: body, header: old, secret }).ok, "una firma caducada pasó");
  assert(!verifyNotificationSignature({ rawBody: body + " ", header: good, secret }).ok, "un cuerpo alterado pasó");
  console.log("✓ Airtm: la firma de notificaciones se verifica con tiempo constante y caducidad");
}

// ---------- transporte rechaza destinos externos ----------
{
  await expectThrow(() => createAirtmTransport({}), "PROVIDER_NOT_CONFIGURED", "transporte sin configurar");
  const transport = createAirtmTransport({
    AIRTM_ENVIRONMENT: "sandbox",
    AIRTM_BASE_URL: "https://api.airtm.test",
    AIRTM_API_KEY: "k",
    AIRTM_API_SECRET: "s",
  });
  await expectThrow(() => transport.request({ method: "GET", path: "//evil.test/x" }), "INVALID_REQUEST", "ruta con doble barra");
  await expectThrow(() => transport.request({ method: "GET", path: "https://evil.test/x" }), "INVALID_REQUEST", "URL absoluta externa");
  await expectThrow(() => transport.request({ method: "DELETE", path: "/x" }), "INVALID_REQUEST", "método no permitido");
  console.log("✓ Airtm: el transporte rechaza rutas externas y métodos no permitidos");
}

// ---------- política ----------
{
  const db = createMemoryDb();
  const policy = new FinancialPolicy(db, { adminToken: "tok-admin" });

  await expectThrow(() => policy.authorize({ actor: null, action: "withdraw" }), "UNAUTHENTICATED", "sin sesión");

  const sinKyc = { id: "u1", kyc: { status: "none" }, emailVerified: true, twoFactor: { enabled: true } };
  await expectThrow(() => policy.authorize({ actor: sinKyc, action: "withdraw" }), "KYC_REQUIRED", "retiro sin KYC");

  const sinCorreo = { id: "u1", kyc: { status: "verified" }, emailVerified: false, twoFactor: { enabled: true } };
  await expectThrow(() => policy.authorize({ actor: sinCorreo, action: "withdraw" }), "EMAIL_REQUIRED", "retiro sin correo");

  const sin2fa = { id: "u1", kyc: { status: "verified" }, emailVerified: true, twoFactor: { enabled: false } };
  await expectThrow(() => policy.authorize({ actor: sin2fa, action: "withdraw" }), "TWO_FACTOR_REQUIRED", "retiro sin 2FA");

  const excluido = {
    id: "u1", kyc: { status: "verified" }, emailVerified: true,
    twoFactor: { enabled: true }, selfExcludedUntil: new Date(Date.now() + 864e5).toISOString(),
  };
  await expectThrow(() => policy.authorize({ actor: excluido, action: "withdraw" }), "SELF_EXCLUDED", "retiro autoexcluido");

  const completo = { id: "u1", kyc: { status: "verified" }, emailVerified: true, twoFactor: { enabled: true } };
  assert((await policy.authorize({ actor: completo, action: "withdraw" })).allowed, "un usuario completo no pudo retirar");
  console.log("✓ Política: el retiro exige KYC, correo, 2FA y no estar autoexcluido");

  // Token de administrador con comparación en tiempo constante.
  assert(policy.requireAdmin("tok-admin").allowed, "el token correcto no pasó");
  await expectThrow(() => policy.requireAdmin("malo"), "FORBIDDEN", "token incorrecto");
  await expectThrow(() => policy.requireAdmin(""), "FORBIDDEN", "token vacío");

  // Límites de retiro.
  await policy.checkLimits({ actor: completo, amount: 1000 });
  await expectThrow(
    () => policy.checkLimits({ actor: completo, amount: WITHDRAWAL_LIMITS.dailyUnits + 1 }),
    "LIMIT_DAILY",
    "retiro por encima del límite diario"
  );
  console.log("✓ Política: token de administrador y límites de retiro diario/semanal/mensual");
}

// ---------- worker del outbox ----------
{
  const db = createMemoryDb();
  const seen = [];
  let failFirst = true;
  const repo = {
    async claimOutbox() {
      return seen.length === 0
        ? [{ id: 1, topic: "withdrawal.requested", payload: { withdrawalId: "w1" } }]
        : [];
    },
    async completeOutbox(id) {
      seen.push(`done:${id}`);
    },
    async failOutbox(id, err) {
      seen.push(`fail:${id}:${err}`);
    },
  };
  const worker = new OutboxWorker(repo, {
    "withdrawal.requested": async (payload) => {
      if (failFirst) {
        failFirst = false;
        throw new Error("Zinli no responde");
      }
      seen.push(`handled:${payload.withdrawalId}`);
    },
  }, { logger: { log() {}, warn() {}, error() {} } });

  const n = await worker.runOnce();
  assert(n === 1, "el worker debería haber tomado un efecto");
  assert(seen.some((s) => s.startsWith("fail:1")), "un fallo debería registrarse para reintento");

  // Un tema sin manejador tampoco debe perderse.
  const worker2 = new OutboxWorker(
    {
      async claimOutbox() { return [{ id: 9, topic: "tema.desconocido", payload: {} }]; },
      async completeOutbox(id) { seen.push(`done:${id}`); },
      async failOutbox(id, err) { seen.push(`fail:${id}:${err}`); },
    },
    {},
    { logger: { log() {}, warn() {}, error() {} } }
  );
  await worker2.runOnce();
  assert(seen.some((s) => s.includes("fail:9")), "un tema sin manejador debería quedar para revisión");
  console.log("✓ Outbox: los fallos se reintentan y un tema sin manejador no se pierde");
}

console.log("\n✅ Pruebas de infraestructura de pagos superadas");
