// Cuentas de usuario reales: registro, login, sesiones y perfil.
// Las contraseñas se guardan con scrypt y sal por usuario, nunca en claro.

import crypto from "node:crypto";

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
      entitlement: "free",
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
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    wallet: user.wallet,
    stats: user.stats,
    purchases: user.purchases || 0,
    entitlement: user.entitlement || "free",
  };
}
