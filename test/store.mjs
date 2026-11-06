// Pruebas de cuentas, tienda y pagos reales.
// Usa una base de datos en memoria y un `fetch` falso: no toca red ni bases
// de datos reales, y no mueve dinero.
//
//   node test/store.mjs

import crypto from "node:crypto";
import { createServer } from "../server/server.mjs";
import { createMemoryDb } from "../server/db.mjs";
import {
  verifyStripeSignature,
  verifyMercadoPagoSignature,
} from "../server/payments.mjs";
import { Store, catalog, applyProduct, productById } from "../server/store.mjs";
import { hashPassword, verifyPassword, validateSignup } from "../server/auth.mjs";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const STRIPE_SECRET = "whsec_test_123";
const STRIPE_KEY = "sk_test_123";

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

const post = (payload, token) => ({
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(payload),
});

const get = (token) => ({ headers: token ? { Authorization: `Bearer ${token}` } : {} });

// Firma un evento de Stripe igual que lo haría el proveedor.
function signStripe(rawBody, secret = STRIPE_SECRET, ts = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  return `t=${ts},v1=${v1}`;
}

async function main() {
  // ---------- criptografía de contraseñas ----------
  const { salt, hash } = hashPassword("contraseña-larga");
  assert(verifyPassword("contraseña-larga", salt, hash), "la contraseña correcta no valida");
  assert(!verifyPassword("otra-cosa", salt, hash), "una contraseña incorrecta validó");
  assert(hashPassword("x").salt !== hashPassword("x").salt, "la sal no es aleatoria por usuario");
  assert(validateSignup({ email: "mal", password: "12345678", name: "A" }).error, "correo inválido aceptado");
  assert(validateSignup({ email: "a@b.co", password: "corta", name: "A" }).error, "contraseña corta aceptada");
  console.log("✓ Contraseñas: scrypt con sal, comparación en tiempo constante");

  // ---------- firmas de webhook ----------
  const raw = JSON.stringify({ type: "checkout.session.completed" });
  assert(verifyStripeSignature(raw, signStripe(raw), STRIPE_SECRET), "firma válida de Stripe rechazada");
  assert(!verifyStripeSignature(raw, signStripe(raw, "otro-secreto"), STRIPE_SECRET), "firma ajena aceptada");
  assert(!verifyStripeSignature(raw, "t=1,v1=deadbeef", STRIPE_SECRET), "firma falsa aceptada");
  assert(!verifyStripeSignature(raw, signStripe(raw, STRIPE_SECRET, 1), STRIPE_SECRET), "firma caducada aceptada");
  assert(!verifyStripeSignature(raw, "", STRIPE_SECRET), "firma vacía aceptada");

  const mpTs = Math.floor(Date.now() / 1000);
  const manifest = `id:999;request-id:req-1;ts:${mpTs};`;
  const mpSig = `ts=${mpTs},v1=${crypto.createHmac("sha256", "mp-secret").update(manifest).digest("hex")}`;
  assert(
    verifyMercadoPagoSignature({ dataId: "999", requestId: "req-1", header: mpSig, secret: "mp-secret" }),
    "firma válida de MercadoPago rechazada"
  );
  assert(
    !verifyMercadoPagoSignature({ dataId: "999", requestId: "req-1", header: mpSig, secret: "malo" }),
    "firma ajena de MercadoPago aceptada"
  );
  console.log("✓ Webhooks: firma de Stripe y de MercadoPago verificadas, las falsas rechazadas");

  // ---------- catálogo y cartera ----------
  const products = catalog();
  assert(products.length >= 6, "el catálogo es demasiado corto");
  assert(products.every((p) => p.priceCents > 0), "hay productos sin precio");
  assert(productById("coins_500").coins === 500, "el producto de monedas está mal definido");
  const walletUser = { wallet: { coins: 0, gems: 0, dice: 0 }, purchases: 0, spentCents: 0 };
  const update = applyProduct(walletUser, productById("coins_500"));
  assert(update.wallet.coins === 500, "las monedas no se acreditaron");
  assert(update.spentCents === 199, "el gasto no se registró");
  console.log(`✓ Catálogo: ${products.length} productos con precio real`);

  // ---------- servidor con base de datos en memoria ----------
  const db = createMemoryDb();
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("api.stripe.com")) {
      return {
        ok: true,
        json: async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/pay/cs_test_1" }),
      };
    }
    return { ok: false, json: async () => ({}) };
  };

  const env = {
    ALLOWED_EMAIL_DOMAINS: "gmail.com,ejemplo.com",
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: STRIPE_SECRET,
    MERCADOPAGO_WEBHOOK_SECRET: "mp-secret",
  };
  const server = createServer({ db, env, fetchImpl: fakeFetch });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // Cuentas
    let res = await request(base, "/api/auth/signup", post({ email: "ana@ejemplo.com", password: "supersegura1", name: "Ana" }));
    assert(res.status === 201, `no se pudo registrar: ${JSON.stringify(res.body)}`);
    assert(res.body.token && res.body.user.id, "el registro no devolvió sesión");
    assert(res.body.user.wallet.coins === 500, "el usuario nuevo no recibió monedas de bienvenida");
    const token = res.body.token;
    assert(!("hash" in res.body.user) && !("salt" in res.body.user), "se filtró el hash de la contraseña");

    res = await request(base, "/api/auth/signup", post({ email: "ana@ejemplo.com", password: "supersegura1", name: "Ana" }));
    assert(res.status === 400, "se permitió registrar el mismo correo dos veces");

    res = await request(base, "/api/auth/signup", post({ email: "b@ejemplo.com", password: "123", name: "B" }));
    assert(res.status === 400, "se aceptó una contraseña débil");

    res = await request(base, "/api/auth/me", get(token));
    assert(res.status === 200 && res.body.user.email === "ana@ejemplo.com", "la sesión no se reconoce");

    res = await request(base, "/api/auth/me", get("token-falso"));
    assert(res.status === 401, "un token falso fue aceptado");

    res = await request(base, "/api/auth/login", post({ email: "ana@ejemplo.com", password: "mala" }));
    assert(res.status === 401, "una contraseña mala inició sesión");

    res = await request(base, "/api/auth/login", post({ email: "ana@ejemplo.com", password: "supersegura1" }));
    assert(res.status === 200 && res.body.token, "el inicio de sesión correcto falló");
    console.log("✓ Cuentas: registro, login, sesión y datos sensibles fuera de la respuesta");

    // Tienda
    res = await request(base, "/api/store/catalog");
    assert(res.status === 200 && res.body.products.length >= 6, "el catálogo no se sirve");
    assert(res.body.payments.stripe === true, "el catálogo no informa que Stripe está activo");

    res = await request(base, "/api/store/checkout", post({ productId: "coins_500", provider: "stripe" }));
    assert(res.status === 401, "se permitió comprar sin iniciar sesión");

    res = await request(base, "/api/store/checkout", post({ productId: "no_existe", provider: "stripe" }, token));
    assert(res.status === 400, "se aceptó un producto inexistente");

    res = await request(base, "/api/store/checkout", post({ productId: "coins_500", provider: "paypal" }, token));
    assert(res.status === 400, "se aceptó un proveedor no soportado");

    res = await request(base, "/api/store/checkout", post({ productId: "coins_500", provider: "stripe" }, token));
    assert(res.status === 201 && res.body.url.includes("stripe.com"), "no se creó la sesión de pago");
    const orderId = res.body.orderId;
    assert(orderId, "no se devolvió el identificador de la orden");

    // El checkout real se pidió a Stripe con la clave de entorno.
    const stripeCall = calls.find((c) => c.url.includes("api.stripe.com"));
    assert(stripeCall.options.headers.Authorization === `Bearer ${STRIPE_KEY}`, "la clave de Stripe no se usó");
    console.log("✓ Tienda: catálogo, permisos, validación y sesión de pago en Stripe");

    // Webhook: firma falsa no acredita
    const event = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: orderId, payment_intent: "pi_1" } },
    });
    res = await request(base, "/api/payments/webhook/stripe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      body: event,
    });
    assert(res.status === 400, "un webhook con firma falsa fue aceptado");
    res = await request(base, "/api/auth/me", get(token));
    assert(res.body.user.wallet.coins === 500, "un webhook falso acreditó monedas");
    console.log("✓ Seguridad: un webhook sin firma válida no acredita saldo");

    // Webhook válido acredita una sola vez, aunque se repita
    const signed = {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": signStripe(event) },
      body: event,
    };
    res = await request(base, "/api/payments/webhook/stripe", signed);
    assert(res.status === 200 && res.body.ok === true, "el webhook válido no acreditó");
    res = await request(base, "/api/auth/me", get(token));
    assert(res.body.user.wallet.coins === 1000, `las monedas no se acreditaron: ${res.body.user.wallet.coins}`);

    // Repetir el mismo webhook no puede duplicar el saldo (idempotencia).
    await request(base, "/api/payments/webhook/stripe", signed);
    await request(base, "/api/payments/webhook/stripe", signed);
    res = await request(base, "/api/auth/me", get(token));
    assert(res.body.user.wallet.coins === 1000, "un webhook repetido duplicó el saldo");
    console.log("✓ Pagos: webhook válido acredita una sola vez, aunque se repita");

    // Historial de compras
    res = await request(base, "/api/store/transactions", get(token));
    assert(res.status === 200 && res.body.transactions.length === 1, "el historial de compras está mal");
    assert(res.body.transactions[0].amountCents === 199, "el importe registrado es incorrecto");
    assert(!("_id" in res.body.transactions[0]), "se filtró el _id interno");

    res = await request(base, "/api/store/orders", get(token));
    assert(res.status === 200 && res.body.orders[0].status === "paid", "la orden no quedó como pagada");
    console.log("✓ Historial: compras y órdenes quedan registradas para el usuario");

    // Un usuario no ve las compras de otro
    const other = await request(base, "/api/auth/signup", post({ email: "luis@ejemplo.com", password: "otraclave99", name: "Luis" }));
    res = await request(base, "/api/store/transactions", get(other.body.token));
    assert(res.body.transactions.length === 0, "un usuario vio las compras de otro");
    console.log("✓ Aislamiento: cada usuario ve solo sus compras");

    // Sin Stripe configurado, el checkout falla en vez de fingir un pago
    const noPay = createServer({
      db: createMemoryDb(),
      env: { ALLOWED_EMAIL_DOMAINS: "gmail.com,ejemplo.com" },
      fetchImpl: fakeFetch,
    });
    await new Promise((r) => noPay.listen(0, r));
    const npBase = `http://127.0.0.1:${noPay.address().port}`;
    const npUser = await request(npBase, "/api/auth/signup", post({ email: "c@ejemplo.com", password: "claveclave1", name: "C" }));
    res = await request(npBase, "/api/store/checkout", post({ productId: "coins_500", provider: "stripe" }, npUser.body.token));
    assert(res.status === 502, "sin Stripe configurado el checkout debería fallar");
    const npHealth = await request(npBase, "/health");
    assert(npHealth.body.payments.stripe === false, "la salud debe indicar que Stripe está apagado");
    await new Promise((r) => noPay.close(r));
    console.log("✓ Sin pasarela: el checkout falla con error claro, nunca finge un pago");
  } finally {
    await new Promise((r) => server.close(r));
  }

  console.log("\n✅ Pruebas de cuentas, tienda y pagos superadas");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
