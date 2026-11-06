// Pagos reales. Integra Stripe y MercadoPago por sus APIs REST.
//
// Reglas de oro de este módulo:
//   1. Nunca se acredita saldo sin una confirmación firmada del proveedor.
//   2. Cada acreditación es idempotente: un webhook repetido no duplica monedas.
//   3. Sin claves configuradas el sistema falla con un error claro; jamás
//      simula una compra exitosa.

import crypto from "node:crypto";

export const PROVIDERS = ["stripe", "mercadopago"];

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Firma de Stripe: cabecera "t=<ts>,v1=<hmac>" sobre "<ts>.<cuerpo>".
export function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=").map((s) => s.trim()))
  );
  if (!parts.t || !parts.v1) return false;
  const expected = hmacHex(secret, `${parts.t}.${rawBody}`);
  if (!safeEqual(expected, parts.v1)) return false;
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  return Number.isFinite(age) ? age <= toleranceSec : false;
}

// Firma de MercadoPago: cabecera "ts=<ts>,v1=<hmac>" sobre el manifiesto
// "id:<dataId>;request-id:<requestId>;ts:<ts>;".
export function verifyMercadoPagoSignature({ dataId, requestId, header, secret }) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=").map((s) => s.trim()))
  );
  if (!parts.ts || !parts.v1) return false;
  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  return safeEqual(hmacHex(secret, manifest), parts.v1);
}

export function paymentsConfigured(env = process.env) {
  return {
    stripe: Boolean(env.STRIPE_SECRET_KEY),
    mercadopago: Boolean(env.MERCADOPAGO_ACCESS_TOKEN),
    webhooks: {
      stripe: Boolean(env.STRIPE_WEBHOOK_SECRET),
      mercadopago: Boolean(env.MERCADOPAGO_WEBHOOK_SECRET),
    },
  };
}

// Crea una sesión de pago en el proveedor y devuelve la URL de checkout.
export async function createCheckout({ provider, order, product, baseUrl, env = process.env, fetchImpl = fetch }) {
  if (provider === "stripe") {
    if (!env.STRIPE_SECRET_KEY) return { error: "Stripe no está configurado" };
    const body = new URLSearchParams({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": product.currency,
      "line_items[0][price_data][unit_amount]": String(product.priceCents),
      "line_items[0][price_data][product_data][name]": product.name,
      client_reference_id: order.id,
      "metadata[orderId]": order.id,
      "metadata[productId]": product.id,
      success_url: `${baseUrl}/?compra=ok&orden=${order.id}`,
      cancel_url: `${baseUrl}/?compra=cancelada&orden=${order.id}`,
    });
    const res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error?.message || "Stripe rechazó la sesión de pago" };
    return { value: { url: data.url, providerRef: data.id } };
  }

  if (provider === "mercadopago") {
    if (!env.MERCADOPAGO_ACCESS_TOKEN) return { error: "MercadoPago no está configurado" };
    const res = await fetchImpl("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [
          {
            title: product.name,
            quantity: 1,
            currency_id: product.currency.toUpperCase(),
            unit_price: product.priceCents / 100,
          },
        ],
        external_reference: order.id,
        metadata: { orderId: order.id, productId: product.id },
        back_urls: {
          success: `${baseUrl}/?compra=ok&orden=${order.id}`,
          failure: `${baseUrl}/?compra=cancelada&orden=${order.id}`,
        },
        notification_url: `${baseUrl}/api/payments/webhook/mercadopago`,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.message || "MercadoPago rechazó la preferencia" };
    return { value: { url: data.init_point, providerRef: String(data.id) } };
  }

  return { error: "proveedor de pago desconocido" };
}
