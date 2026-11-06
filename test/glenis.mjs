// GLENIS: registro de decisiones y control de retiros.
//
// Lo que se comprueba aquí no es que la IA "acierte", sino que el dinero esté
// gobernado: que todo quede registrado, que GLENIS no pague sola un retiro y
// que la cuenta madre sea la única que reparte el rol de administrador.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "../server/server.mjs";
import { createMemoryDb } from "../server/db.mjs";
import {
  GlenisLog,
  buildWithdrawalCase,
  glenisEnabled,
  explainWithdrawal,
  GLENIS_MAX_AUTO_APPROVALS_PER_DAY,
} from "../server/glenis.mjs";
import {
  visionProviderFromEnv,
  textProviderFromEnv,
  callGroqText,
  GEMINI_MODELS,
} from "../server/ai-receipts.mjs";
import {
  validateSignup,
  parseAllowedDomains,
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ALLOWED_DOMAINS,
} from "../server/auth.mjs";

let passed = 0;
const ok = (cond, msg) => {
  assert(cond, msg);
  passed++;
  console.log("  ok -", msg);
};

// ---------- registro solo con Gmail ----------

ok(DEFAULT_ALLOWED_DOMAINS.includes("gmail.com"), "Gmail es el dominio por defecto");
ok(
  validateSignup({ email: "ana@hotmail.com", password: "clavefuerte1", name: "Ana" }).error,
  "se rechaza un correo que no es Gmail"
);
ok(
  validateSignup({ email: "ana@gmail.com", password: "clavefuerte1", name: "Ana" }).value?.email === "ana@gmail.com",
  "se acepta un correo de Gmail"
);
ok(
  validateSignup(
    { email: "ana@tudominio.com", password: "clavefuerte1", name: "Ana" },
    { allowedDomains: parseAllowedDomains("gmail.com,tudominio.com") }
  ).value?.email === "ana@tudominio.com",
  "ALLOWED_EMAIL_DOMAINS amplía los dominios permitidos"
);
ok(DEFAULT_ADMIN_EMAIL === "eliecerdepablos@gmail.com", "la cuenta madre es eliecerdepablos@gmail.com");

// ---------- GLENIS no paga sola ----------

const fakeDb = () => {
  const docs = [];
  return {
    collection: () => ({
      insertOne: async (d) => docs.push(d),
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => docs } ) }), toArray: async () => docs }),
    }),
  };
};

const log = new GlenisLog(fakeDb());
await log.record({ actor: "GLENIS", action: "receipt.review", decision: "approved", reasons: ["monto correcto"] });
await log.record({ actor: "GLENIS", action: "receipt.review", decision: "rejected", reasons: ["comprobante repetido"] });
await log.record({ actor: "GLENIS", action: "withdrawal.review", decision: "pending", reasons: ["KYC sin verificar"] });
const summary = await log.summary();
ok(summary.total === 3, "el registro de GLENIS guarda cada decisión");
ok(summary.approved === 1 && summary.rejected === 1, "el resumen separa aprobados y rechazados");

const caseClean = await buildWithdrawalCase({
  withdrawal: { id: "w1", userId: "u1", email: "ana@gmail.com", gross: 1000, fee: 50, net: 950 },
  user: { kyc: { status: "verified" }, emailVerified: true, twoFactor: { enabled: true } },
  totals: { day: 0, week: 0, month: 0 },
  limits: { dailyUnits: 20000 },
  priorWithdrawals: [],
});
ok(caseClean.needsHuman === true, "un retiro limpio sigue necesitando al administrador");
ok(caseClean.risks.length === 0, "un retiro limpio no arrastra riesgos");
ok(caseClean.score === 1, "un retiro limpio puntúa 1");

const caseRisky = await buildWithdrawalCase({
  withdrawal: { id: "w2", userId: "u2", email: "luis@gmail.com", gross: 5000, fee: 250, net: 4750 },
  user: { kyc: { status: "none" }, emailVerified: false, twoFactor: { enabled: false } },
  totals: { day: 19000, week: 19000, month: 19000 },
  limits: { dailyUnits: 20000 },
  priorWithdrawals: [
    { id: "a", email: "luis@gmail.com", status: "paid" },
    { id: "b", email: "luis@gmail.com", status: "paid" },
    { id: "c", email: "luis@gmail.com", status: "paid" },
  ],
});
ok(caseRisky.risks.length >= 4, "un retiro con señales acumula riesgos");
ok(caseRisky.score < caseClean.score, "el retiro con señales puntúa menos");
ok(caseRisky.recommendation === "revisar", "GLENIS recomienda revisar el retiro con señales");

ok(glenisEnabled({}) === true, "GLENIS viene encendida");
ok(glenisEnabled({ GLENIS_ENABLED: "0" }) === false, "GLENIS se puede apagar");
ok(GLENIS_MAX_AUTO_APPROVALS_PER_DAY === 5, "hay tope de aprobaciones automáticas por día");

// ---------- dos papeles, dos claves ----------
// La clave de Groq no lee imágenes: si se usara como visión, GLENIS aprobaría
// comprobantes sin haberlos leído. Ese error no puede volver.
ok(
  visionProviderFromEnv({ GROQ_API_KEY: "gsk_x" }) === null,
  "Groq no se usa como lector de comprobantes (no lee imágenes)"
);
ok(
  visionProviderFromEnv({ OPENAI_API_KEY: "sk-x" })?.name === "openai",
  "OpenAI sí se usa para leer comprobantes"
);
ok(
  textProviderFromEnv({ GROQ_API_KEY: "gsk_x" })?.name === "groq",
  "Groq sí se usa para redactar"
);
ok(
  visionProviderFromEnv({ GEMINI_API_KEY: "k" })?.name === "gemini",
  "Gemini se usa para leer comprobantes"
);

// Google retira los nombres fijos de modelo cada pocos meses. Si alguien vuelve
// a clavar uno retirado, GLENIS se queda sin leer comprobantes y todo va a
// revisión manual sin que nadie sepa por qué.
const RETIRED = ["gemini-1.5-flash", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
ok(
  GEMINI_MODELS.every((m) => !RETIRED.includes(m)),
  "ningún modelo de Gemini retirado en la lista"
);
ok(GEMINI_MODELS.length >= 2, "hay más de un modelo de Gemini para reintentar");
ok(
  GEMINI_MODELS.some((m) => m.endsWith("-latest")),
  "se usa al menos un alias vigente de Gemini"
);

// Sin proveedor de texto, GLENIS no se queda muda: usa las reglas.
const quiet = await explainWithdrawal({ case: caseRisky, env: {} });
ok(quiet.text.includes("KYC") || quiet.text.includes("revisa") || quiet.text.includes("Revisa"), "sin proveedor, GLENIS resume con reglas");
ok(quiet.provider === null, "sin proveedor de texto, GLENIS lo dice");

// Con un proveedor falso, GLENIS usa el texto que devuelve el modelo.
const fakeExplain = await explainWithdrawal({
  case: caseClean,
  env: { GROQ_API_KEY: "gsk_x" },
  fetchImpl: async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "Todo en orden, revisa el destino." } }] }),
  }),
});
ok(fakeExplain.text === "Todo en orden, revisa el destino.", "con proveedor, GLENIS usa la redacción del modelo");

// Si el proveedor falla, GLENIS vuelve a las reglas en vez de inventar.
const brokenExplain = await explainWithdrawal({
  case: caseClean,
  env: { GROQ_API_KEY: "gsk_x" },
  fetchImpl: async () => ({ ok: false, json: async () => ({ error: { message: "sin cuota" } }) }),
});
ok(brokenExplain.error === "sin cuota" && brokenExplain.text.length > 0, "si el proveedor falla, GLENIS resume con reglas");

// El llamador de texto envía el contenido como cadena (así lo exige Groq).
let sawStringContent = false;
await callGroqText({
  prompt: "hola",
  apiKey: "gsk_x",
  fetchImpl: async (_url, opts) => {
    sawStringContent = typeof JSON.parse(opts.body).messages[0].content === "string";
    return { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  },
});
ok(sawStringContent, "el texto se envía como cadena, no como bloques de imagen");

// ---------- extremo a extremo por HTTP ----------

const env = {
  ALLOWED_EMAIL_DOMAINS: "gmail.com,ejemplo.com",
  TAKTAK_DEV_CODES: "1",
};
const server = createServer({ db: createMemoryDb(), env });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const post = (body, token) =>
  fetch(`${base}/api/x`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const call = async (path, { method = "GET", body, token } = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

// Estado de GLENIS: público y sin secretos.
let res = await call("/api/glenis/status");
ok(res.status === 200 && res.json.name === "GLENIS", "el estado de GLENIS es público");
ok(!JSON.stringify(res.json).match(/gsk_|api[_-]?key/i), "el estado no filtra ninguna clave");
ok("vision" in res.json && "text" in res.json, "el estado declara los dos papeles: visión y texto");

// El registro de decisiones es solo para el administrador.
res = await call("/api/glenis/log");
ok(res.status === 403, "el registro de GLENIS está cerrado sin sesión de administrador");

// Un usuario normal no puede administrar.
const normal = await call("/api/auth/signup", {
  method: "POST",
  body: { email: "ana@gmail.com", password: "clavefuerte1", name: "Ana" },
});
ok(normal.status === 200 || normal.status === 201, "se registra una cuenta normal con Gmail");
ok(normal.json.user.role === "user", "una cuenta normal no nace administradora");
res = await call("/api/glenis/log", { token: normal.json.token });
ok(res.status === 403, "un usuario normal no entra al registro de GLENIS");
res = await call("/api/glenis/role", {
  method: "POST",
  token: normal.json.token,
  body: { email: "ana@gmail.com", role: "admin" },
});
ok(res.status === 403, "un usuario normal no puede repartir roles");

// La cuenta madre sí puede, y su rol nace de la configuración.
const mother = await call("/api/auth/signup", {
  method: "POST",
  body: { email: DEFAULT_ADMIN_EMAIL, password: "clavefuerte1", name: "Eliecer" },
});
ok(mother.status === 200 || mother.status === 201, "la cuenta madre se registra");
ok(mother.json.user.role === "admin", "la cuenta madre nace como administradora");
res = await call("/api/glenis/log", { token: mother.json.token });
ok(res.status === 200 && Array.isArray(res.json.entries), "la cuenta madre sí ve el registro de GLENIS");

// Y reparte el rol a alguien de confianza.
res = await call("/api/glenis/role", {
  method: "POST",
  token: mother.json.token,
  body: { email: "ana@gmail.com", role: "admin" },
});
ok(res.status === 200 && res.json.role === "admin", "la cuenta madre da el rol de administrador");
res = await call("/api/glenis/log", { token: normal.json.token });
ok(res.status === 200, "quien recibe el rol entra al registro de GLENIS");

// El expediente de retiros está cerrado a los curiosos.
res = await call("/api/glenis/withdrawals");
ok(res.status === 403, "los expedientes de retiro son solo para el administrador");

server.close();
console.log(`\nGLENIS: ${passed} comprobaciones correctas.`);
