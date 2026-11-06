// KYC, límites de compra y juego responsable.
//
// El KYC es obligatorio antes de comprar monedas: sin identidad verificada no
// se puede cargar saldo ni retirarlo. Los límites y la autoexclusión son
// requisitos de juego responsable, no adornos.

import crypto from "node:crypto";

export const KYC_STATES = ["none", "pending", "verified", "rejected"];

// Límites por defecto. Un usuario verificado puede tener límites más altos,
// nunca ilimitados: el juego responsable exige un techo.
export const DEFAULT_LIMITS = {
  dailyCents: 5000,
  weeklyCents: 20000,
  monthlyCents: 60000,
};

export const VERIFIED_LIMITS = {
  dailyCents: 20000,
  weeklyCents: 80000,
  monthlyCents: 250000,
};

export function limitsFor(user) {
  return user?.kyc?.status === "verified" ? VERIFIED_LIMITS : DEFAULT_LIMITS;
}

function dayStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Suma lo gastado en la ventana pedida a partir del historial de compras.
export function spentIn(user, windowMs, now = Date.now()) {
  const from = now - windowMs;
  return (user.spentLog || [])
    .filter((e) => new Date(e.at).getTime() >= from)
    .reduce((sum, e) => sum + (e.amountCents || 0), 0);
}

export function checkPurchaseAllowed(user, amountCents, now = Date.now()) {
  if (user.selfExcludedUntil && new Date(user.selfExcludedUntil).getTime() > now) {
    return { error: "cuenta autoexcluida: no se permiten compras" };
  }
  if (user.kyc?.status !== "verified") {
    return { error: "necesitas completar el KYC antes de comprar monedas" };
  }
  const limits = limitsFor(user);
  const sinceDay = now - dayStart(now);
  const spentDay = spentIn(user, sinceDay, now);
  if (spentDay + amountCents > limits.dailyCents) {
    return { error: `superas el límite diario de $${(limits.dailyCents / 100).toFixed(2)}` };
  }
  const spentWeek = spentIn(user, 7 * 864e5, now);
  if (spentWeek + amountCents > limits.weeklyCents) {
    return { error: `superas el límite semanal de $${(limits.weeklyCents / 100).toFixed(2)}` };
  }
  const spentMonth = spentIn(user, 30 * 864e5, now);
  if (spentMonth + amountCents > limits.monthlyCents) {
    return { error: `superas el límite mensual de $${(limits.monthlyCents / 100).toFixed(2)}` };
  }
  return { value: true };
}

// Heurística de calidad del documento. En producción esto lo hace un proveedor
// de KYC; aquí se comprueba que el archivo tenga tamaño y tipo plausibles y se
// deja constancia de que la decisión final es humana o del proveedor.
export function validateKycSubmission(body) {
  const docType = String(body?.docType || "");
  const allowed = ["cedula", "pasaporte", "licencia"];
  if (!allowed.includes(docType)) return { error: "tipo de documento inválido" };
  const number = String(body?.docNumber || "").replace(/\s+/g, "");
  if (number.length < 5 || number.length > 20) return { error: "número de documento inválido" };
  const docImage = String(body?.docImage || "");
  const selfie = String(body?.selfie || "");
  if (!docImage.startsWith("data:image/") || docImage.length < 2000) {
    return { error: "foto del documento ausente o ilegible" };
  }
  if (!selfie.startsWith("data:image/") || selfie.length < 2000) {
    return { error: "selfie ausente o ilegible" };
  }
  if (!body?.consent) return { error: "falta el consentimiento para verificar la identidad" };
  return {
    value: {
      docType,
      docNumber: number,
      docImageHash: crypto.createHash("sha256").update(docImage).digest("hex"),
      selfieHash: crypto.createHash("sha256").update(selfie).digest("hex"),
    },
  };
}

export class Kyc {
  constructor(db) {
    this.db = db;
    this.users = db.collection("users");
    this.kyc = db.collection("kyc");
  }

  async submit(user, body) {
    const check = validateKycSubmission(body);
    if (check.error) return check;
    const record = {
      id: crypto.randomUUID(),
      userId: user.id,
      ...check.value,
      status: "pending",
      at: new Date().toISOString(),
    };
    await this.kyc.insertOne(record);
    await this.users.updateOne(
      { id: user.id },
      { $set: { kyc: { status: "pending", submittedAt: record.at } } }
    );
    return { value: { status: "pending" } };
  }

  // La decisión es humana o de un proveedor externo. Aquí se registra.
  async decide(userId, status, reason = "") {
    if (!["verified", "rejected"].includes(status)) return { error: "estado inválido" };
    await this.users.updateOne(
      { id: userId },
      { $set: { kyc: { status, decidedAt: new Date().toISOString(), reason } } }
    );
    return { value: { status } };
  }
}

export function selfExclude(user, days) {
  const n = Math.max(1, Math.min(365, Number(days) || 30));
  const until = new Date(Date.now() + n * 864e5).toISOString();
  return { $set: { selfExcludedUntil: until } };
}
