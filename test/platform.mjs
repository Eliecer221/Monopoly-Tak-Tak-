// Pruebas del sistema de plataforma: 2FA, KYC, límites, juego responsable,
// validación de comprobantes por IA, retiros por Zinli y bote 60/40.
//
//   node test/platform.mjs

import { createServer } from "../server/server.mjs";
import { createMemoryDb } from "../server/db.mjs";
import { generateBackupCodes, generateSecret, totpCode, verifyTotp, base32Decode } from "../server/totp.mjs";
import { evaluateReceipt, normalizeReading, parseModelJson, sha256 } from "../server/ai-receipts.mjs";
import { checkPurchaseAllowed, limitsFor, selfExclude, validateKycSubmission, DEFAULT_LIMITS } from "../server/kyc.mjs";
import { splitPot, withdrawalQuote, MIN_WITHDRAWAL_COINS, validateBuyIn } from "../server/zinli.mjs";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function request(base, path, options) {
  const res = await fetch(`${base}${path}`, options);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const post = (payload, token, extra = {}) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  },
  body: JSON.stringify(payload),
});

const get = (token, extra = {}) => ({
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
});

// Imagen de prueba: un data URL de tamaño plausible.
const IMG = "data:image/png;base64," + "A".repeat(3000);

// Proveedor de IA falso: devuelve lo que la prueba indique, sin red.
function fakeAi(reading) {
  return async (url, options) => {
    if (url.includes("api.openai.com")) {
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(reading) } }],
        }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };
}

async function main() {
  // ---------- TOTP ----------
  const secret = generateSecret();
  assert(base32Decode(secret).length === 20, "el secreto no mide 20 bytes");
  const code = totpCode(secret);
  assert(/^\d{6}$/.test(code), "el código no tiene 6 dígitos");
  assert(verifyTotp(secret, code), "el código actual no valida");
  assert(verifyTotp(secret, code, { timeMs: Date.now() + 30000 }), "no se acepta la ventana de reloj");
  assert(!verifyTotp(secret, code, { timeMs: Date.now() + 300000 }), "se aceptó un código muy antiguo");
  assert(!verifyTotp(secret, "000000", { window: 0 }) || code === "000000", "se aceptó un código falso");
  assert(!verifyTotp(secret, "abc"), "se aceptó un código no numérico");
  assert(!verifyTotp(generateSecret(), code), "un secreto distinto validó el código");
  const backups = generateBackupCodes();
  assert(backups.length === 8 && new Set(backups).size === 8, "los códigos de respaldo están mal");
  console.log("✓ 2FA: TOTP de 6 dígitos con ventana de reloj y códigos de respaldo");

  // ---------- reparto del bote 60/40 ----------
  assert(splitPot(100).winner === 60 && splitPot(100).house === 40, "el reparto 60/40 está mal");
  assert(splitPot(7).winner + splitPot(7).house === 7, "el reparto pierde monedas con números impares");
  assert(splitPot(0).total === 0, "un bote vacío no da cero");
  // El redondeo nunca puede perder ni crear monedas.
  for (const n of [1, 3, 9, 33, 999, 12345]) {
    const r = splitPot(n);
    assert(r.winner + r.house === n, `el reparto de ${n} no cuadra`);
  }
  assert(validateBuyIn(50).value === 50, "buy-in válido rechazado");
  assert(validateBuyIn(-1).error, "buy-in negativo aceptado");
  assert(validateBuyIn(999999).error, "buy-in desmedido aceptado");
  console.log("✓ Bote: 60/40 exacto, sin monedas perdidas en el redondeo");

  // ---------- KYC ----------
  assert(validateKycSubmission({ docType: "cedula", docNumber: "12345678", docImage: IMG, selfie: IMG, consent: true }).value, "KYC válido rechazado");
  assert(validateKycSubmission({ docType: "otro", docNumber: "12345678", docImage: IMG, selfie: IMG, consent: true }).error, "tipo de documento inválido aceptado");
  assert(validateKycSubmission({ docType: "cedula", docNumber: "1", docImage: IMG, selfie: IMG, consent: true }).error, "documento corto aceptado");
  assert(validateKycSubmission({ docType: "cedula", docNumber: "12345678", docImage: "x", selfie: IMG, consent: true }).error, "documento sin foto aceptado");
  assert(validateKycSubmission({ docType: "cedula", docNumber: "12345678", docImage: IMG, selfie: IMG }).error, "KYC sin consentimiento aceptado");
  console.log("✓ KYC: exige documento, selfie y consentimiento");

  // ---------- límites y juego responsable ----------
  const unverified = { kyc: { status: "none" }, wallet: { coins: 0 }, spentLog: [] };
  assert(checkPurchaseAllowed(unverified, 199).error, "se permitió comprar sin KYC");
  const verified = { kyc: { status: "verified" }, wallet: { coins: 0 }, spentLog: [] };
  assert(checkPurchaseAllowed(verified, 199).value, "un usuario verificado no pudo comprar");
  // Un usuario verificado tiene límites más altos; se usa su propio techo.
  const heavy = {
    kyc: { status: "verified" },
    spentLog: [{ at: new Date().toISOString(), amountCents: limitsFor(verified).dailyCents }],
  };
  assert(checkPurchaseAllowed(heavy, 199).error, "se superó el límite diario sin bloquear");
  // Un usuario sin KYC usa el techo básico.
  const heavyBasic = {
    kyc: { status: "none" },
    spentLog: [{ at: new Date().toISOString(), amountCents: DEFAULT_LIMITS.dailyCents }],
  };
  assert(checkPurchaseAllowed(heavyBasic, 199).error, "se superó el límite diario básico sin bloquear");
  const excluded = { kyc: { status: "verified" }, spentLog: [], selfExcludedUntil: new Date(Date.now() + 864e5).toISOString() };
  assert(checkPurchaseAllowed(excluded, 199).error, "una cuenta autoexcluida pudo comprar");
  assert(limitsFor(verified).dailyCents > limitsFor(unverified).dailyCents, "el KYC no amplía los límites");
  assert(selfExclude(verified, 30).$set.selfExcludedUntil, "la autoexclusión no fija fecha");
  assert(selfExclude(verified, 9999).$set.selfExcludedUntil, "la autoexclusión no acota los días");
  console.log("✓ Juego responsable: KYC obligatorio, límites diarios y autoexclusión");

  // ---------- retiros ----------
  assert(withdrawalQuote(500).error, "se permitió retirar por debajo del mínimo");
  const quote = withdrawalQuote(2000).value;
  assert(quote.gross === 2000 && quote.fee === 100 && quote.net === 1900, "la comisión del retiro está mal");
  assert(MIN_WITHDRAWAL_COINS === 1000, "el mínimo de retiro cambió sin actualizar la prueba");
  console.log("✓ Retiros: mínimo y comisión transparentes");

  // ---------- validación de comprobantes por IA ----------
  assert(parseModelJson('```json\n{"amount":5}\n```').amount === 5, "no se extrae el JSON del modelo");
  assert(parseModelJson('bla {"amount":7} bla').amount === 7, "no se extrae el JSON con prosa");
  assert(parseModelJson("sin json") === null, "texto sin JSON debería dar null");
  const reading = normalizeReading({ amount: "5", currency: "usd", confidence: "0.9", looksEdited: false });
  assert(reading.amount === 5 && reading.currency === "USD" && reading.confidence === 0.9, "la lectura no se normaliza");

  const config = { receiverEmail: "pagos@taktak.com", receiverPhone: "+584120000000" };
  const good = evaluateReceipt({
    reading: normalizeReading({ amount: 5, currency: "USD", receiver: "pagos@taktak.com", confidence: 0.95 }),
    expectedCents: 499,
    config,
  });
  assert(good.verdict === "approved", `un comprobante correcto no se aprobó: ${good.verdict} ${good.score}`);

  const short = evaluateReceipt({
    reading: normalizeReading({ amount: 1, currency: "USD", receiver: "pagos@taktak.com", confidence: 0.9 }),
    expectedCents: 499,
    config,
  });
  assert(short.verdict !== "approved", "un monto insuficiente fue aprobado");

  const edited = evaluateReceipt({
    reading: normalizeReading({ amount: 5, currency: "USD", receiver: "pagos@taktak.com", confidence: 0.99, looksEdited: true }),
    expectedCents: 499,
    config,
  });
  assert(edited.verdict !== "approved", "una imagen manipulada fue aprobada");

  const wrongPayee = evaluateReceipt({
    reading: normalizeReading({ amount: 5, currency: "USD", receiver: "otro@correo.com", confidence: 0.9 }),
    expectedCents: 499,
    config,
  });
  assert(wrongPayee.verdict !== "approved", "un destinatario ajeno fue aprobado");

  const unreadable = evaluateReceipt({ reading: null, expectedCents: 499, config });
  assert(unreadable.verdict === "manual_review", "un comprobante ilegible no fue a revisión");
  console.log("✓ IA: aprueba lo correcto y rechaza monto bajo, manipulación y destinatario ajeno");

  // ---------- servidor: flujo completo ----------
  const env = {
    TAKTAK_DEV_CODES: "1",
    ADMIN_TOKEN: "admin-secreto",
    ZINLI_RECEIVER_EMAIL: "pagos@taktak.com",
    ZINLI_RECEIVER_PHONE: "+584120000000",
    ZINLI_RECEIVER_NAME: "Monopoly Tak Tak",
    OPENAI_API_KEY: "sk-fake",
  };
  const db = createMemoryDb();
  const aiReadings = [];
  const fakeFetch = async (url, options) => {
    if (url.includes("api.openai.com")) {
      const reading = aiReadings.shift() || { amount: 4.99, currency: "USD", receiver: "pagos@taktak.com", confidence: 0.95 };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reading) } }] }) };
    }
    return { ok: false, json: async () => ({}) };
  };
  const server = createServer({ db, env, fetchImpl: fakeFetch });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Registro
    let res = await request(base, "/api/auth/signup", post({ email: "jefa@ejemplo.com", password: "clavefuerte1", name: "Jefa" }));
    assert(res.status === 201, "no se pudo registrar");
    const token = res.body.token;
    assert(res.body.user.kyc.status === "none", "el usuario nuevo no empieza sin KYC");
    assert(res.body.user.emailVerified === false, "el usuario nuevo no empieza sin verificar");
    assert(res.body.user.twoFactorEnabled === false, "el 2FA empieza activado");

    // Compra bloqueada sin KYC
    res = await request(base, "/api/zinli/order", post({ productId: "coins_1500" }, token));
    assert(res.status === 403, "se permitió comprar sin KYC");
    assert(String(res.body.error).includes("KYC"), "el error no menciona el KYC");

    // Verificación de correo
    res = await request(base, "/api/auth/verify/start", post({ channel: "email" }, token));
    assert(res.status === 200 && res.body.devCode, "no se generó el código de correo");
    res = await request(base, "/api/auth/verify/confirm", post({ channel: "email", code: "000000" }, token));
    assert(res.status === 400, "un código de correo falso fue aceptado");
    res = await request(base, "/api/auth/verify/start", post({ channel: "email" }, token));
    res = await request(base, "/api/auth/verify/confirm", post({ channel: "email", code: res.body.devCode }, token));
    assert(res.status === 200 && res.body.user.emailVerified === true, "el correo no quedó verificado");

    // Verificación de teléfono
    res = await request(base, "/api/auth/verify/start", post({ channel: "phone" }, token));
    res = await request(base, "/api/auth/verify/confirm", post({ channel: "phone", code: res.body.devCode }, token));
    assert(res.body.user.phoneVerified === true, "el teléfono no quedó verificado");
    console.log("✓ Registro: correo y teléfono se verifican con código");

    // 2FA
    res = await request(base, "/api/auth/2fa/setup", post({}, token));
    const twoFaSecret = res.body.secret;
    assert(twoFaSecret && res.body.otpauth.startsWith("otpauth://totp/"), "no se generó el secreto de 2FA");
    res = await request(base, "/api/auth/2fa/enable", post({ code: "000000" }, token));
    assert(res.status === 400, "se activó el 2FA con un código falso");
    res = await request(base, "/api/auth/2fa/enable", post({ code: totpCode(twoFaSecret) }, token));
    assert(res.status === 200 && res.body.backupCodes.length === 8, "no se activó el 2FA");
    res = await request(base, "/api/auth/me", get(token));
    assert(res.body.user.twoFactorEnabled === true, "el 2FA no aparece activo");
    assert(!("secret" in res.body.user) && !("twoFactor" in res.body.user), "se filtró el secreto de 2FA");
    res = await request(base, "/api/auth/2fa/disable", post({ code: "000000" }, token));
    assert(res.status === 400, "se desactivó el 2FA sin código válido");
    console.log("✓ 2FA: activación y desactivación exigen código; el secreto no se filtra");

    // KYC
    res = await request(base, "/api/kyc/submit", post({ docType: "cedula", docNumber: "12345678", docImage: "x", selfie: IMG, consent: true }, token));
    assert(res.status === 400, "se aceptó un KYC con documento ilegible");
    res = await request(base, "/api/kyc/submit", post({ docType: "cedula", docNumber: "12345678", docImage: IMG, selfie: IMG, consent: true }, token));
    assert(res.status === 201 && res.body.status === "pending", "el KYC no quedó pendiente");

    // Aún pendiente: la compra sigue bloqueada
    res = await request(base, "/api/zinli/order", post({ productId: "coins_1500" }, token));
    assert(res.status === 403, "se compró con el KYC solo pendiente");

    // El administrador aprueba
    res = await request(base, "/api/kyc/decide", post({ userId: "x", status: "verified" }, null, { "x-admin-token": "malo" }));
    assert(res.status === 403, "se decidió el KYC sin token de administrador");
    const userId = (await request(base, "/api/auth/me", get(token))).body.user.id;
    res = await request(base, "/api/kyc/decide", post({ userId, status: "verified" }, null, { "x-admin-token": "admin-secreto" }));
    assert(res.status === 200, "el administrador no pudo aprobar el KYC");
    res = await request(base, "/api/kyc/status", get(token));
    assert(res.body.kyc.status === "verified", "el KYC no aparece verificado");
    assert(res.body.limits.dailyCents > 0, "no se devuelven los límites");
    console.log("✓ KYC: solo el administrador aprueba y la compra se desbloquea al verificar");

    // Compra por Zinli
    res = await request(base, "/api/zinli/order", post({ productId: "coins_1500" }, token));
    assert(res.status === 201, `no se creó la orden de Zinli: ${JSON.stringify(res.body)}`);
    assert(res.body.pay.email === "pagos@taktak.com", "no se devuelven los datos de Zinli");
    const orderId = res.body.orderId;

    // Comprobante falso (destinatario ajeno y monto bajo) → no acredita
    aiReadings.push({ amount: 1, currency: "USD", receiver: "otro@correo.com", confidence: 0.4 });
    res = await request(base, "/api/zinli/receipt", post({ orderId, image: IMG, reference: "123" }, token));
    assert(res.body.verdict !== "approved", "un comprobante falso fue aprobado");
    const afterBad = (await request(base, "/api/auth/me", get(token))).body.user.wallet.coins;
    assert(afterBad === 500, "un comprobante falso acreditó monedas");

    // Un comprobante correcto (imagen nueva) sí acredita
    const IMG2 = "data:image/png;base64," + "B".repeat(3000);
    aiReadings.push({ amount: 4.99, currency: "USD", receiver: "pagos@taktak.com", confidence: 0.95 });
    res = await request(base, "/api/zinli/receipt", post({ orderId, image: IMG2, reference: "123" }, token));
    assert(res.body.verdict === "approved", `el comprobante correcto no se aprobó: ${JSON.stringify(res.body)}`);
    const afterGood = (await request(base, "/api/auth/me", get(token))).body.user.wallet.coins;
    assert(afterGood === 2000, `no se acreditaron las monedas: ${afterGood}`);

    // Reutilizar el mismo comprobante (misma imagen) se rechaza
    const dup = await request(base, "/api/zinli/order", post({ productId: "coins_1500" }, token));
    res = await request(base, "/api/zinli/receipt", post({ orderId: dup.body.orderId, image: IMG2 }, token));
    assert(res.body.verdict === "rejected", "se reutilizó el mismo comprobante");
    assert(String(res.body.reasons[0]).includes("ya fue usado"), "el rechazo del duplicado no es por reutilización");
    console.log("✓ Zinli: el comprobante válido acredita y el reutilizado se rechaza");

    // Revisión manual del administrador
    const pending = await request(base, "/api/zinli/order", post({ productId: "coins_500" }, token));
    aiReadings.push({ amount: 1.99, currency: "USD", receiver: "pagos@taktak.com", confidence: 0.5, looksEdited: true });
    const IMG3 = "data:image/png;base64," + "C".repeat(3000);
    res = await request(base, "/api/zinli/receipt", post({ orderId: pending.body.orderId, image: IMG3 }, token));
    assert(["manual_review", "rejected"].includes(res.body.verdict), "un comprobante dudoso no fue a revisión");
    res = await request(base, "/api/admin/receipts", get(null, { "x-admin-token": "admin-secreto" }));
    assert(res.status === 200, "el administrador no ve la cola de revisión");
    res = await request(base, "/api/admin/receipts", get(null, { "x-admin-token": "malo" }));
    assert(res.status === 403, "la cola de revisión quedó abierta");
    console.log("✓ Revisión manual: protegida por token de administrador");

    // Retiro
    res = await request(base, "/api/zinli/withdrawal", post({ coins: 500 }, token));
    assert(res.status === 400, "se permitió retirar por debajo del mínimo");
    res = await request(base, "/api/zinli/withdrawal", post({ coins: 1500 }, token));
    assert(res.status === 201, `no se creó el retiro: ${JSON.stringify(res.body)}`);
    assert(res.body.email === "jefa@ejemplo.com", "el retiro no va al correo verificado del usuario");
    assert(res.body.net === 1425, `la comisión del retiro está mal: ${res.body.net}`);
    const wid = res.body.id;
    const afterRequest = (await request(base, "/api/auth/me", get(token))).body.user.wallet.coins;
    assert(afterRequest === 2000 - 1500, "las monedas no se retuvieron al pedir el retiro");

    // Rechazo: devuelve las monedas
    res = await request(base, "/api/admin/withdrawals/decide", post({ id: wid, status: "rejected" }, null, { "x-admin-token": "admin-secreto" }));
    assert(res.status === 200, "el administrador no pudo rechazar el retiro");
    const afterReject = (await request(base, "/api/auth/me", get(token))).body.user.wallet.coins;
    assert(afterReject === 2000, "un retiro rechazado no devolvió las monedas");
    console.log("✓ Retiro: al correo verificado, con comisión, y devuelve monedas si se rechaza");

    // Autoexclusión
    res = await request(base, "/api/responsible/self-exclude", post({ days: 30 }, token));
    assert(res.status === 200 && res.body.selfExcludedUntil, "no se pudo autoexcluir");
    res = await request(base, "/api/zinli/order", post({ productId: "coins_500" }, token));
    assert(res.status === 403, "una cuenta autoexcluida pudo comprar");
    console.log("✓ Autoexclusión: bloquea las compras de inmediato");

    // Bote 60/40
    res = await request(base, "/api/pot/settle", post({ buyIn: 100, players: 8, winner: true }, token));
    assert(res.status === 200, `no se liquidó el bote: ${JSON.stringify(res.body)}`);
    assert(res.body.pot === 800 && res.body.winner === 480 && res.body.house === 320, `el reparto del bote está mal: ${JSON.stringify(res.body)}`);
    res = await request(base, "/api/pot/settle", post({ buyIn: 100, players: 9, winner: true }, token));
    assert(res.status === 400, "se permitió una partida de 9 jugadores");
    res = await request(base, "/api/pot/settle", post({ buyIn: 100, players: 4, winner: false }, token));
    assert(res.status === 400, "se liquidó el bote sin ser ganador");
    console.log("✓ Bote: 2–8 jugadores, reparto 60/40 y solo el ganador liquida");
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log("\n✅ Pruebas de plataforma superadas");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
