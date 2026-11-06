// Cliente de Airtm.
//
// ESTADO: DESHABILITADO POR DEFECTO. No hay endpoints inventados.
//
// Airtm no publica una API de cobros abierta y sus términos prohíben el juego
// con apuestas. Para usarlo hacen falta tres cosas que NO están en este
// repositorio:
//   1. El producto contratado con Airtm y su documentación oficial.
//   2. Las credenciales de ese producto.
//   3. La autorización por escrito de Airtm para el caso de uso.
//
// Hasta entonces, cada método lanza PROVIDER_NOT_CONFIGURED. Nunca devuelve un
// pago exitoso simulado: fingir un pago es peor que fallar.
//
// Las rutas reales se añaden en `ENDPOINTS` cuando se conozcan, y solo entonces.

import crypto from "node:crypto";

export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new ProviderError(code, message);
};

// Se rellena SOLO con rutas de la documentación oficial del producto
// contratado. Vacío a propósito: no se inventan endpoints.
export const ENDPOINTS = Object.freeze({
  // createPayout: "/ruta/oficial/...",
  // getOperation: "/ruta/oficial/.../",
  // createDeposit: "/ruta/oficial/...",
});

export function airtmConfig(env = process.env) {
  const environment = env.AIRTM_ENVIRONMENT || "disabled";
  return Object.freeze({
    environment,
    baseUrl: env.AIRTM_BASE_URL || null,
    hasKey: Boolean(env.AIRTM_API_KEY),
    hasSecret: Boolean(env.AIRTM_API_SECRET),
    enabled: environment === "sandbox" || environment === "production",
  });
}

// ---------- firma de notificaciones ----------
// Airtm firma sus notificaciones. El esquema exacto se toma de la documentación
// del producto contratado. Aquí se implementa el patrón habitual de HMAC con
// marca de tiempo y comparación en tiempo constante, que es lo que debe
// verificarse; el nombre del encabezado y el formato se ajustan al contrato.
export function verifyNotificationSignature({ rawBody, header, secret, toleranceSeconds = 300, nowMs = Date.now() }) {
  if (!secret) return { ok: false, reason: "no hay secreto configurado" };
  if (!header) return { ok: false, reason: "falta la firma" };

  const parts = Object.fromEntries(
    String(header)
      .split(",")
      .map((p) => p.split("=").map((s) => s.trim()))
      .filter((p) => p.length === 2)
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1 || parts.s;
  if (!Number.isFinite(timestamp) || !signature) {
    return { ok: false, reason: "firma mal formada" };
  }
  if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) {
    return { ok: false, reason: "firma caducada" };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: "firma inválida" };
  }
  return { ok: true };
}

// ---------- transporte ----------
export function createAirtmTransport(env = process.env, { fetchImpl = fetch } = {}) {
  const config = airtmConfig(env);

  if (!config.enabled) {
    fail("PROVIDER_NOT_CONFIGURED", "Airtm no está habilitado");
  }
  if (!config.baseUrl || !config.hasKey || !config.hasSecret) {
    fail("PROVIDER_NOT_CONFIGURED", "faltan credenciales de Airtm");
  }

  const base = new URL(config.baseUrl);
  if (base.protocol !== "https:") fail("INVALID_CONFIGURATION", "Airtm exige HTTPS");

  const authorization =
    "Basic " + Buffer.from(`${env.AIRTM_API_KEY}:${env.AIRTM_API_SECRET}`).toString("base64");

  async function request({ method, path, body }) {
    if (!["GET", "POST"].includes(method)) fail("INVALID_REQUEST", "método no permitido");
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      fail("INVALID_REQUEST", "ruta inválida");
    }
    const url = new URL(path, base.origin);
    if (url.origin !== base.origin) fail("INVALID_REQUEST", "destino externo rechazado");

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: authorization,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Un fallo de red NO significa que el pago falló: hay que consultar.
      fail("OUTCOME_UNKNOWN", "resultado desconocido: consultar antes de reintentar");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      fail("OUTCOME_UNKNOWN", "respuesta no interpretable: requiere conciliación");
    }

    if (!response.ok) fail("PROVIDER_ERROR", `Airtm respondió ${response.status}`);
    return data;
  }

  return Object.freeze({ environment: config.environment, request, config });
}

// ---------- proveedor ----------
// Cerrado por defecto. Sustituir por la implementación del producto contratado,
// sin devolver nunca un éxito ficticio.
export class DisabledAirtmProvider {
  get name() {
    return "airtm-disabled";
  }

  get enabled() {
    return false;
  }

  async createDeposit() {
    fail("PROVIDER_NOT_CONFIGURED", "depósitos de Airtm no habilitados");
  }

  async createPayout() {
    fail("PROVIDER_NOT_CONFIGURED", "retiros de Airtm no habilitados");
  }

  async getOperation() {
    fail("PROVIDER_NOT_CONFIGURED", "Airtm no habilitado");
  }
}

export function createAirtmProvider(env = process.env, options = {}) {
  if (!airtmConfig(env).enabled) return new DisabledAirtmProvider();
  // Con el entorno habilitado, aún falta el producto contratado. Se deja
  // explícito para no dar la impresión de que ya funciona.
  fail(
    "INTEGRATION_REQUIRED",
    "Airtm está habilitado, pero falta la implementación del producto contratado"
  );
}
