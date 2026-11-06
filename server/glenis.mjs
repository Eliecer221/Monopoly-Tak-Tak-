// GLENIS: la asistente de IA que valida pagos, acredita y vigila los retiros.
//
// No es un adorno. Es la que decide, con reglas claras y rastro de todo:
//   - Compras: lee el comprobante, comprueba que el monto cuadre y que el
//     destinatario sea la cuenta madre. Si hay duda, no acredita: lo manda a
//     revisión del administrador. Si hay fraude evidente, rechaza.
//   - Retiros: no autoriza el pago por sí sola. Arma el expediente (destino,
//     KYC, 2FA, límites, duplicados) y lo deja listo para que el administrador
//     decida. Eso es control, no un botón que suelta dinero.
//
// Regla de oro: GLENIS propone, el humano decide lo irreversible. Y todo lo que
// decide queda escrito en el registro de decisiones.

import crypto from "node:crypto";
import { callGroqText, textProviderFromEnv } from "./ai-receipts.mjs";

export const GLENIS_NAME = "GLENIS";
export const GLENIS_ROLE = "Asistente de pagos y control de Monopoly TAK TAK";

// Umbrales de decisión. Ajustables sin tocar la lógica.
export const GLENIS_THRESHOLDS = {
  approveAt: 0.85,
  rejectAt: 0.35,
};

// Con más de este número de comprobantes en un día, GLENIS deja de aprobar sola.
export const GLENIS_MAX_AUTO_APPROVALS_PER_DAY = 5;

export function glenisEnabled(env = process.env) {
  return env.GLENIS_ENABLED !== "0";
}

// Registro de decisiones. Cada fila dice quién decidió, con qué confianza y por
// qué. Sin esto no hay control.
export class GlenisLog {
  constructor(db) {
    this.collection = db.collection("glenis_log");
  }

  async record({ actor = "glenis", action, target = null, decision, score = null, reasons = [], detail = {} }) {
    const entry = {
      id: crypto.randomUUID(),
      actor,
      action,
      target,
      decision,
      score,
      reasons: reasons.slice(0, 12),
      detail,
      at: new Date().toISOString(),
    };
    await this.collection.insertOne(entry);
    return entry;
  }

  async recent(limit = 50) {
    const rows = await this.collection.find({}).sort({ at: -1 }).limit(limit).toArray();
    return rows.map(({ _id, ...r }) => r);
  }

  async summary() {
    const rows = await this.collection.find({}).toArray();
    const count = (fn) => rows.filter(fn).length;
    return {
      total: rows.length,
      approved: count((r) => r.decision === "approved"),
      rejected: count((r) => r.decision === "rejected"),
      manual: count((r) => r.decision === "manual_review" || r.decision === "pending"),
      withdrawalsFlagged: count((r) => r.action === "withdrawal.review"),
    };
  }
}

// Expediente de un retiro. GLENIS no paga: reúne pruebas y señala riesgos para
// que el administrador decida con todo a la vista.
export async function buildWithdrawalCase({
  withdrawal,
  user,
  totals = { day: 0, week: 0, month: 0 },
  limits = {},
  priorWithdrawals = [],
}) {
  const risks = [];
  let score = 1;

  if (user?.kyc?.status !== "verified") {
    risks.push("KYC sin verificar");
    score -= 0.5;
  }
  if (!user?.emailVerified) {
    risks.push("correo sin verificar");
    score -= 0.3;
  }
  if (!user?.twoFactor?.enabled) {
    risks.push("2FA desactivado");
    score -= 0.3;
  }

  const day = Number(totals.day || 0);
  const gross = Number(withdrawal.gross || 0);
  if (limits.dailyUnits && day + gross > limits.dailyUnits) {
    risks.push(`supera el límite diario (${day + gross} > ${limits.dailyUnits})`);
    score -= 0.4;
  }

  // Mismo destino muchas veces el mismo día: posible cuenta comprometida.
  const sameDay = priorWithdrawals.filter(
    (w) => w.email === withdrawal.email && w.status !== "rejected"
  ).length;
  if (sameDay >= 3) {
    risks.push(`${sameDay} retiros al mismo destino hoy`);
    score -= 0.2;
  }

  score = Math.max(0, Math.min(1, score));
  return {
    id: withdrawal.id,
    userId: withdrawal.userId,
    email: withdrawal.email,
    gross,
    fee: withdrawal.fee,
    net: withdrawal.net,
    score,
    risks,
    // Nunca paga solo: el administrador decide.
    recommendation: risks.length ? "revisar" : "parece correcto",
    needsHuman: true,
  };
}

// GLENIS explica un expediente en una frase, en lenguaje llano. Si no hay
// proveedor de texto, devuelve un resumen de reglas: nunca se queda muda.
export async function explainWithdrawal({ case: kase, env = process.env, fetchImpl = fetch }) {
  const fallback = kase.risks.length
    ? `Revisa: ${kase.risks.join(", ")}.`
    : "Sin señales de riesgo. Comprueba el destino antes de pagar.";
  const provider = textProviderFromEnv(env);
  if (!provider || provider.name !== "groq") return { text: fallback, provider: provider?.name || null };
  const prompt =
    `Eres GLENIS, la asistente de control de pagos de Monopoly TAK TAK. ` +
    `Explica en dos frases, en español claro y sin tecnicismos, este retiro para el administrador. ` +
    `No digas que ya está pagado: la decisión es del administrador.\n` +
    JSON.stringify({ destinatario: kase.email, monedas: kase.gross, neto: kase.net, riesgos: kase.risks, confianza: kase.score });
  const result = await callGroqText({ prompt, apiKey: provider.apiKey, fetchImpl });
  if (result.error) return { text: fallback, provider: "groq", error: result.error };
  return { text: result.value.trim(), provider: "groq" };
}

export function glenisStatus(env = process.env) {
  const text = textProviderFromEnv(env);
  return {
    name: GLENIS_NAME,
    role: GLENIS_ROLE,
    thresholds: GLENIS_THRESHOLDS,
    textProvider: text ? text.name : null,
  };
}
