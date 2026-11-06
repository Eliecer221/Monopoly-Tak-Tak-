// Pruebas del pago manual por PayPal: datos de cobro, orden, comprobante y
// acreditación. Usa base de datos en memoria y un `fetch` falso: no toca red ni
// mueve dinero.
//
//   node test/paypal.mjs

import { createServer } from "../server/server.mjs";
import { createMemoryDb } from "../server/db.mjs";
import { paypalPayTo, paypalConfigured, DEFAULT_PAYPAL_RECEIVER_EMAIL } from "../server/paypal.mjs";

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

async function main() {
  const RECEIVER = "taktak.messenger@gmail.com";

  // ---------- datos de cobro ----------
  {
    const def = paypalPayTo({});
    assert(def.email === RECEIVER, `el correo por defecto no es el esperado: ${def.email}`);
    assert(DEFAULT_PAYPAL_RECEIVER_EMAIL === RECEIVER, "la constante por defecto cambió");
    assert(paypalConfigured({}) === true, "PayPal debería estar configurado por defecto");
    const custom = paypalPayTo({ PAYPAL_RECEIVER_EMAIL: "otro@correo.com" });
    assert(custom.email === "otro@correo.com", "la variable de entorno no se respeta");
    assert(custom.holder === "Monopoly Tak Tak", "el titular por defecto cambió");
    console.log("✓ PayPal: el correo de cobro por defecto es el de la plataforma");
  }

  // ---------- flujo completo por el servidor ----------
  const env = {
    ALLOWED_EMAIL_DOMAINS: "gmail.com,ejemplo.com",
    TAKTAK_DEV_CODES: "1",
    ADMIN_TOKEN: "admin-secreto",
    OPENAI_API_KEY: "sk-fake",
  };
  const db = createMemoryDb();
  const aiReadings = [];
  const fakeFetch = async (url) => {
    if (url.includes("api.openai.com")) {
      const reading = aiReadings.shift() || {
        amount: 1.99,
        currency: "USD",
        receiver: RECEIVER,
        confidence: 0.95,
      };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(reading) } }] }) };
    }
    return { ok: false, json: async () => ({}) };
  };
  const server = createServer({ db, env, fetchImpl: fakeFetch });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    // El catálogo informa a la tienda que PayPal es el método disponible.
    let res = await request(base, "/api/store/catalog");
    assert(res.status === 200, "el catálogo no se sirve");
    assert(res.body.payments.paypal === true, "el catálogo no informa que PayPal está activo");
    assert(res.body.payments.stripe === false, "Stripe no debería estar activo");
    assert(res.body.payments.mercadopago === false, "MercadoPago no debería estar activo");
    console.log("✓ Tienda: el catálogo ofrece PayPal y no Stripe ni MercadoPago");

    // La cotización pública devuelve el correo de cobro.
    res = await request(base, "/api/paypal/quote", get(null));
    assert(res.status === 200 && res.body.pay.email === RECEIVER, "la cotización no devuelve el correo");

    // Sin sesión no se puede comprar.
    res = await request(base, "/api/paypal/order", post({ productId: "coins_500" }));
    assert(res.status === 401, "se permitió comprar sin iniciar sesión");

    // Registro y verificación para desbloquear la compra.
    res = await request(base, "/api/auth/signup", post({ email: "ana@ejemplo.com", password: "supersegura1", name: "Ana" }));
    assert(res.status === 201, `no se pudo registrar: ${JSON.stringify(res.body)}`);
    const token = res.body.token;

    res = await request(base, "/api/auth/verify/start", post({ channel: "email" }, token));
    res = await request(base, "/api/auth/verify/confirm", post({ channel: "email", code: res.body.devCode }, token));
    assert(res.body.user.emailVerified === true, "el correo no quedó verificado");

    // KYC enviado y aprobado por el administrador.
    const IMGK = "data:image/png;base64," + "K".repeat(3000);
    res = await request(base, "/api/kyc/submit", post({ docType: "cedula", docNumber: "12345678", docImage: IMGK, selfie: IMGK, consent: true }, token));
    assert(res.status === 201 && res.body.status === "pending", `el KYC no quedó pendiente: ${JSON.stringify(res.body)}`);
    let me = await request(base, "/api/auth/me", get(token));
    res = await request(base, "/api/kyc/decide", post({ userId: me.body.user.id, status: "verified" }, null, { "x-admin-token": "admin-secreto" }));
    assert(res.status === 200, `el administrador no pudo aprobar el KYC: ${JSON.stringify(res.body)}`);

    // Producto inexistente.
    res = await request(base, "/api/paypal/order", post({ productId: "no_existe" }, token));
    assert(res.status === 400, "se aceptó un producto inexistente");

    // Orden correcta.
    res = await request(base, "/api/paypal/order", post({ productId: "coins_500" }, token));
    assert(res.status === 201, `no se creó la orden: ${JSON.stringify(res.body)}`);
    assert(res.body.pay.email === RECEIVER, "la orden no devuelve el correo de cobro");
    assert(res.body.amountCents === 199, "el monto de la orden no coincide");
    const orderId = res.body.orderId;

    // Comprobante con destinatario ajeno → no acredita.
    const IMG = "data:image/png;base64," + "A".repeat(3000);
    aiReadings.push({ amount: 1.99, currency: "USD", receiver: "otro@correo.com", confidence: 0.4 });
    res = await request(base, "/api/paypal/receipt", post({ orderId, image: IMG, reference: "PP-1" }, token));
    assert(res.body.verdict !== "approved", "un comprobante con destinatario ajeno fue aprobado");
    me = await request(base, "/api/auth/me", get(token));
    assert(me.body.user.wallet.coins === 500, "un comprobante falso acreditó monedas");
    console.log("✓ PayPal: un comprobante con destinatario ajeno no acredita");

    // Comprobante correcto (imagen nueva) → acredita.
    const IMG2 = "data:image/png;base64," + "B".repeat(3000);
    aiReadings.push({ amount: 1.99, currency: "USD", receiver: RECEIVER, confidence: 0.95, reference: "PP-2" });
    res = await request(base, "/api/paypal/receipt", post({ orderId, image: IMG2, reference: "PP-2" }, token));
    assert(res.body.verdict === "approved", `el comprobante correcto no se aprobó: ${JSON.stringify(res.body)}`);
    me = await request(base, "/api/auth/me", get(token));
    assert(me.body.user.wallet.coins === 1000, `no se acreditaron las monedas: ${me.body.user.wallet.coins}`);
    console.log("✓ PayPal: el comprobante válido acredita las monedas");

    // Reutilizar el mismo comprobante se rechaza.
    const dup = await request(base, "/api/paypal/order", post({ productId: "coins_500" }, token));
    res = await request(base, "/api/paypal/receipt", post({ orderId: dup.body.orderId, image: IMG2 }, token));
    assert(res.body.verdict === "rejected", "se reutilizó el mismo comprobante");
    console.log("✓ PayPal: el comprobante reutilizado se rechaza");

    // Sin imagen no se acepta el comprobante.
    res = await request(base, "/api/paypal/receipt", post({ orderId: dup.body.orderId, image: "" }, token));
    assert(res.status === 400, "se aceptó un comprobante sin imagen");

    // La salud informa que PayPal está disponible.
    res = await request(base, "/health");
    assert(res.body.paypal === true, "la salud no informa que PayPal está disponible");

    console.log("\nPayPal: todas las pruebas pasaron");
  } finally {
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error("✗", err.message);
  process.exit(1);
});
