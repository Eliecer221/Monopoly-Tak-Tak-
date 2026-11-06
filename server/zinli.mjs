// Zinli: pago manual de compras y retiro al correo verificado del usuario.
//
// Zinli no ofrece una API pública de cobros, así que el flujo es manual:
//   1. La app muestra los datos de Zinli de la plataforma.
//   2. El usuario paga desde su propia cuenta y sube el comprobante.
//   3. La IA valida el comprobante.
//   4. Solo entonces se acreditan las monedas.
//
// El retiro va al correo verificado del usuario, nunca a uno que él escriba en
// el momento: así se evita que una cuenta robada desvíe el dinero.

import crypto from "node:crypto";

export function zinliPayTo(env = process.env) {
  return {
    email: env.ZINLI_RECEIVER_EMAIL || "",
    phone: env.ZINLI_RECEIVER_PHONE || "",
    holder: env.ZINLI_RECEIVER_NAME || "",
    note: "Envía el monto exacto y sube el comprobante. Revisa que el destinatario coincida.",
  };
}

export function zinliConfigured(env = process.env) {
  return Boolean(env.ZINLI_RECEIVER_EMAIL || env.ZINLI_RECEIVER_PHONE);
}

export const WITHDRAWAL_STATES = ["requested", "processing", "paid", "rejected"];

// Mínimo de retiro y comisión. La comisión es transparente: se muestra antes
// de confirmar.
export const MIN_WITHDRAWAL_COINS = 1000;
export const WITHDRAWAL_FEE_PCT = 5;

export function withdrawalQuote(coins) {
  const gross = Math.floor(Number(coins) || 0);
  if (gross < MIN_WITHDRAWAL_COINS) {
    return { error: `el mínimo de retiro es ${MIN_WITHDRAWAL_COINS} monedas` };
  }
  const fee = Math.round((gross * WITHDRAWAL_FEE_PCT) / 100);
  return { value: { gross, fee, net: gross - fee } };
}

export class Zinli {
  constructor(db) {
    this.db = db;
    this.withdrawals = db.collection("withdrawals");
    this.users = db.collection("users");
    this.transactions = db.collection("transactions");
  }

  // Solicita un retiro. Exige correo verificado y KYC aprobado.
  async requestWithdrawal(user, coins) {
    if (user.kyc?.status !== "verified") {
      return { error: "necesitas completar el KYC antes de retirar" };
    }
    if (!user.emailVerified) {
      return { error: "verifica tu correo antes de retirar" };
    }
    const quote = withdrawalQuote(coins);
    if (quote.error) return quote;
    if ((user.wallet?.coins || 0) < quote.value.gross) {
      return { error: "no tienes suficientes monedas" };
    }
    const record = {
      id: crypto.randomUUID(),
      userId: user.id,
      // El destino se congela al pedirlo: es el correo verificado del usuario.
      email: user.email,
      gross: quote.value.gross,
      fee: quote.value.fee,
      net: quote.value.net,
      status: "requested",
      at: new Date().toISOString(),
    };
    await this.withdrawals.insertOne(record);
    // Las monedas se retienen de inmediato para que no se puedan gastar dos veces.
    await this.users.updateOne(
      { id: user.id },
      { $set: { wallet: { ...user.wallet, coins: user.wallet.coins - quote.value.gross } } }
    );
    return { value: record };
  }

  async decide(id, status, note = "") {
    if (!WITHDRAWAL_STATES.includes(status)) return { error: "estado inválido" };
    const w = await this.withdrawals.findOne({ id });
    if (!w) return { error: "retiro desconocido" };
    if (w.status === "paid" || w.status === "rejected") return { error: "el retiro ya está cerrado" };
    await this.withdrawals.updateOne(
      { id },
      { $set: { status, note, decidedAt: new Date().toISOString() } }
    );
    // Si se rechaza, las monedas vuelven al usuario.
    if (status === "rejected") {
      const user = await this.users.findOne({ id: w.userId });
      if (user) {
        await this.users.updateOne(
          { id: user.id },
          { $set: { wallet: { ...user.wallet, coins: (user.wallet?.coins || 0) + w.gross } } }
        );
      }
    }
    if (status === "paid") {
      await this.transactions.insertOne({
        id: crypto.randomUUID(),
        userId: w.userId,
        kind: "withdrawal",
        coins: w.gross,
        net: w.net,
        email: w.email,
        at: new Date().toISOString(),
      });
    }
    return { value: { status } };
  }
}

// ---------- monedas y bote ----------

export const POT_WINNER_SHARE = 0.6;
export const POT_HOUSE_SHARE = 0.4;

// Reparto del bote: 60% al ganador, 40% a la casa. El redondeo se ajusta para
// que la suma de las partes sea exactamente el bote, sin monedas perdidas.
export function splitPot(pot) {
  const total = Math.max(0, Math.floor(Number(pot) || 0));
  const winner = Math.round(total * POT_WINNER_SHARE);
  return { total, winner, house: total - winner };
}

export function validateBuyIn(coins) {
  const n = Number(coins);
  if (!Number.isInteger(n) || n < 0) return { error: "buy-in inválido" };
  if (n > 100000) return { error: "buy-in demasiado alto" };
  return { value: n };
}
