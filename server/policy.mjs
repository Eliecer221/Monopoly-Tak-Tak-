// Autenticación, autorización y límites para operaciones de dinero.
//
// Este módulo NO guarda contraseñas: reutiliza las sesiones de server/auth.mjs.
// Aquí se decide quién puede mover dinero, con qué límites y con qué rastro.
//
// Reglas que impone:
//   1. Sin sesión válida no hay operación.
//   2. Para retirar hace falta KYC verificado, correo verificado y 2FA activo.
//   3. Los límites de retiro son distintos de los de compra, y más estrictos.
//   4. Las operaciones de administrador exigen un token aparte.

import crypto from "node:crypto";

export const WITHDRAWAL_LIMITS = {
  dailyUnits: 20000,
  weeklyUnits: 80000,
  monthlyUnits: 250000,
};

export class PolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PolicyError";
    this.code = code;
  }
}

const deny = (code, message) => {
  throw new PolicyError(code, message);
};

export class FinancialPolicy {
  constructor(db, { adminToken = null } = {}) {
    this.db = db;
    this.users = db.collection("users");
    this.adminToken = adminToken;
  }

  // `actor` debe venir de una sesión validada en el servidor, nunca del cuerpo
  // de la petición.
  async authorize({ actor, action }) {
    if (!actor?.id) deny("UNAUTHENTICATED", "falta una sesión válida");

    if (action === "withdraw") {
      if (actor.kyc?.status !== "verified") {
        deny("KYC_REQUIRED", "el retiro exige KYC verificado");
      }
      if (!actor.emailVerified) {
        deny("EMAIL_REQUIRED", "el retiro exige el correo verificado");
      }
      if (!actor.twoFactor?.enabled) {
        deny("TWO_FACTOR_REQUIRED", "el retiro exige 2FA activo");
      }
      if (actor.selfExcludedUntil && new Date(actor.selfExcludedUntil).getTime() > Date.now()) {
        deny("SELF_EXCLUDED", "la cuenta está autoexcluida");
      }
    }

    if (action === "admin") {
      deny("USE_ADMIN_TOKEN", "las acciones de administrador usan token propio");
    }

    return { allowed: true };
  }

  requireAdmin(token) {
    if (!this.adminToken) deny("ADMIN_DISABLED", "no hay token de administrador configurado");
    const a = Buffer.from(String(token || ""));
    const b = Buffer.from(this.adminToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      deny("FORBIDDEN", "token de administrador inválido");
    }
    return { allowed: true };
  }

  // Límites de retiro sobre lo retirado en la ventana.
  async checkLimits({ actor, amount }) {
    const since = (ms) => new Date(Date.now() - ms).toISOString();
    const { rows } = { rows: await this.db
      .collection("withdrawals")
      .find({ userId: actor.id })
      .toArray() };

    const sum = (fromIso) =>
      rows
        .filter((w) => w.at >= fromIso && w.status !== "rejected")
        .reduce((s, w) => s + (w.amount || 0), 0);

    const day = sum(since(864e5));
    if (day + amount > WITHDRAWAL_LIMITS.dailyUnits) {
      deny("LIMIT_DAILY", `superas el límite diario de retiro (${WITHDRAWAL_LIMITS.dailyUnits})`);
    }
    const week = sum(since(7 * 864e5));
    if (week + amount > WITHDRAWAL_LIMITS.weeklyUnits) {
      deny("LIMIT_WEEKLY", `superas el límite semanal de retiro (${WITHDRAWAL_LIMITS.weeklyUnits})`);
    }
    const month = sum(since(30 * 864e5));
    if (month + amount > WITHDRAWAL_LIMITS.monthlyUnits) {
      deny("LIMIT_MONTHLY", `superas el límite mensual de retiro (${WITHDRAWAL_LIMITS.monthlyUnits})`);
    }
    return { allowed: true };
  }
}
