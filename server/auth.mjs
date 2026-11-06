// Cuentas de usuario reales: registro, login, sesiones y perfil.
// Las contraseñas se guardan con scrypt y sal por usuario, nunca en claro.

import crypto from "node:crypto";
import { generateBackupCodes, generateSecret, otpauthUrl, verifyTotp } from "./totp.mjs";

const SCRYPT_KEYLEN = 64;
const SESSION_DAYS = 30;

export function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return { salt, hash };
}

export function verifyPassword(password, salt, expected) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function validateSignup(body) {
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");
  const name = String(body?.name || "").trim().slice(0, 24);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "correo inválido" };
  if (password.length < 8) return { error: "la contraseña necesita 8 caracteres o más" };
  if (!name) return { error: "nombre requerido" };
  return { value: { email, password, name } };
}

export class Accounts {
  constructor(db) {
    this.db = db;
    this.users = db.collection("users");
    this.sessions = db.collection("sessions");
  }

  async signup(body) {
    const check = validateSignup(body);
    if (check.error) return check;
    const { email, password, name } = check.value;
    const existing = await this.users.findOne({ email });
    if (existing) return { error: "ese correo ya está registrado" };

    const { salt, hash } = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      email,
      name,
      salt,
      hash,
      createdAt: new Date().toISOString(),
      wallet: { coins: 500, gems: 5, dice: 0 },
      stats: { gamesPlayed: 0, gamesWon: 0, bestNetWorth: 0 },
      purchases: 0,
      spentCents: 0,
      spentLog: [],
      entitlement: "free",
      // Cumplimiento: sin correo verificado y KYC aprobado no se compra ni retira.
      emailVerified: false,
      phoneVerified: false,
      kyc: { status: "none" },
      twoFactor: { enabled: false, secret: null, backupCodes: [] },
    };
    await this.users.insertOne(user);
    const token = await this.startSession(user.id);
    return { value: { user: publicUser(user), token } };
  }

  async login(body) {
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");
    const user = await this.users.findOne({ email });
    // Mismo mensaje para correo inexistente y contraseña mala: no filtrar
    // qué correos están registrados.
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      return { error: "correo o contraseña incorrectos" };
    }
    const token = await this.startSession(user.id);
    return { value: { user: publicUser(user), token } };
  }

  async startSession(userId) {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    await this.sessions.insertOne({ token, userId, expiresAt });
    return token;
  }

  async userForToken(token) {
    if (!token) return null;
    const session = await this.sessions.findOne({ token });
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) return null;
    return this.users.findOne({ id: session.userId });
  }

  async logout(token) {
    await this.sessions.updateOne({ token }, { $set: { expiresAt: new Date(0).toISOString() } });
  }

  // ---------- verificación de correo y teléfono ----------

  // Código de 6 dígitos con caducidad de 15 minutos. En producción se envía por
  // correo o SMS; aquí se devuelve solo en modo desarrollo.
  async startVerification(user, channel) {
    const code = String(crypto.randomInt(100000, 999999));
    await this.users.updateOne(
      { id: user.id },
      {
        $set: {
          [`${channel}Code`]: code,
          [`${channel}CodeExpires`]: new Date(Date.now() + 15 * 60000).toISOString(),
        },
      }
    );
    return { value: { channel, sent: true } };
  }

  async confirmVerification(user, channel, code) {
    const fresh = await this.users.findOne({ id: user.id });
    const expected = fresh?.[`${channel}Code`];
    const expires = fresh?.[`${channel}CodeExpires`];
    if (!expected || !expires) return { error: "no hay un código pendiente" };
    if (new Date(expires).getTime() < Date.now()) return { error: "el código caducó" };
    if (String(code || "").trim() !== String(expected)) return { error: "código incorrecto" };
    await this.users.updateOne(
      { id: user.id },
      { $set: { [`${channel}Verified`]: true }, $unset: { [`${channel}Code`]: "", [`${channel}CodeExpires`]: "" } }
    );
    return { value: { verified: true } };
  }

  // ---------- 2FA ----------

  async setupTwoFactor(user) {
    const secret = generateSecret();
    await this.users.updateOne({ id: user.id }, { $set: { twoFactor: { enabled: false, secret, backupCodes: [] } } });
    return { value: { secret, otpauth: otpauthUrl({ secret, account: user.email }) } };
  }

  async enableTwoFactor(user, code) {
    const fresh = await this.users.findOne({ id: user.id });
    const secret = fresh?.twoFactor?.secret;
    if (!secret) return { error: "primero genera el secreto" };
    if (!verifyTotp(secret, code)) return { error: "código de 2FA incorrecto" };
    const backupCodes = generateBackupCodes();
    await this.users.updateOne(
      { id: user.id },
      { $set: { twoFactor: { enabled: true, secret, backupCodes } } }
    );
    return { value: { enabled: true, backupCodes } };
  }

  async disableTwoFactor(user) {
    await this.users.updateOne({ id: user.id }, { $set: { twoFactor: { enabled: false, secret: null, backupCodes: [] } } });
    return { value: { enabled: false } };
  }
}

// El secreto de 2FA y los hashes nunca salen de aquí.
export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    wallet: user.wallet,
    stats: user.stats,
    purchases: user.purchases || 0,
    entitlement: user.entitlement || "free",
    emailVerified: Boolean(user.emailVerified),
    phoneVerified: Boolean(user.phoneVerified),
    kyc: user.kyc || { status: "none" },
    twoFactorEnabled: Boolean(user.twoFactor?.enabled),
    selfExcludedUntil: user.selfExcludedUntil || null,
  };
}
