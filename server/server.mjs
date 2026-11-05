// Servidor de Monopoly TAK TAK: sirve el juego, la clasificación, las cuentas
// de usuario y la tienda con pagos reales.
//
// Uso:
//   MONGODB_URI="mongodb+srv://..." \
//   STRIPE_SECRET_KEY="sk_live_..." STRIPE_WEBHOOK_SECRET="whsec_..." \
//   node server/server.mjs
//
// Ninguna credencial se guarda en el repositorio: todas llegan por entorno.
// Sin MONGODB_URI el juego se sirve igual y las cuentas quedan desactivadas.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { createMemoryDb, createMongoDb, ensureIndexes } from "./db.mjs";
import { Accounts, publicUser } from "./auth.mjs";
import { Store, catalog, productById } from "./store.mjs";
import {
  PROVIDERS,
  createCheckout,
  paymentsConfigured,
  verifyMercadoPagoSignature,
  verifyStripeSignature,
} from "./payments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LIMIT = 50;
const MAX_NAME = 16;
const MAX_SCORE = 10_000_000;
const MAX_TURNS = 100_000;
const POSTS_PER_MINUTE = 10;
const MAX_BODY = 16 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

export function clampLimit(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

export function validateScore(body) {
  if (!body || typeof body !== "object") return { error: "cuerpo inválido" };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME) : "";
  const netWorth = Number(body.netWorth);
  const turns = Number(body.turns);
  const players = Number(body.players);
  if (!name) return { error: "nombre requerido" };
  if (!Number.isFinite(netWorth) || netWorth < 0 || netWorth > MAX_SCORE) {
    return { error: "patrimonio inválido" };
  }
  if (!Number.isInteger(turns) || turns < 0 || turns > MAX_TURNS) {
    return { error: "turnos inválidos" };
  }
  if (!Number.isInteger(players) || players < 2 || players > 8) {
    return { error: "jugadores inválidos" };
  }
  return { value: { name, netWorth: Math.round(netWorth), turns, players } };
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) return { error: "cuerpo demasiado grande" };
  }
  try {
    return { raw, value: JSON.parse(raw || "{}") };
  } catch {
    return { error: "JSON inválido" };
  }
}

async function serveStatic(res, urlPath) {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  const target = path.resolve(ROOT, rel);
  const segments = path.relative(ROOT, target).split(path.sep);
  // Bloquea salir del proyecto (../) y sirve solo archivos no ocultos:
  // .git, .env y demás nunca deben exponerse.
  if (!path.relative(ROOT, target) || segments.some((s) => s.startsWith("."))) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("Prohibido");
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado");
  }
}

export function createServer({
  uri = process.env.MONGODB_URI || "",
  dbName = process.env.MONGODB_DB || "monopoly_taktak",
  store = null,
  db = null,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  let client = null;
  let scores = store;
  const hits = new Map();
  // Modo de desarrollo: datos en memoria, se pierden al reiniciar. Sirve para
  // probar cuentas y tienda en local sin montar Atlas. Nunca en producción.
  let database =
    db || (env.TAKTAK_MEMORY_DB === "1" ? createMemoryDb() : null);

  async function getDb() {
    if (database) return database;
    if (!uri) return null;
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    database = createMongoDb(client, dbName);
    await ensureIndexes(database);
    return database;
  }

  async function collection() {
    if (scores) return scores;
    const d = await getDb();
    if (!d) return null;
    const col = d.collection("scores");
    await col.createIndex({ netWorth: -1 });
    scores = col;
    return scores;
  }

  async function accounts() {
    const d = await getDb();
    return d ? new Accounts(d) : null;
  }

  async function shop() {
    const d = await getDb();
    return d ? new Store(d) : null;
  }

  function rateLimited(ip, limit = POSTS_PER_MINUTE) {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now > entry.reset) {
      hits.set(ip, { count: 1, reset: now + 60_000 });
      return false;
    }
    entry.count++;
    return entry.count > limit;
  }

  async function requireUser(req, res) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const acc = await accounts();
    if (!acc) {
      send(res, 503, { error: "cuentas no configuradas" });
      return null;
    }
    const user = await acc.userForToken(token);
    if (!user) {
      send(res, 401, { error: "sesión inválida o expirada" });
      return null;
    }
    return { user, acc, token };
  }

  const server = http.createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") return send(res, 204, {});

    // Render usa esta ruta para saber si la instancia está viva.
    if (pathname === "/health") {
      const pay = paymentsConfigured(env);
      return send(res, 200, {
        ok: true,
        leaderboard: Boolean(uri || store),
        accounts: Boolean(database || uri),
        memory: Boolean(database && !uri),
        payments: { stripe: pay.stripe, mercadopago: pay.mercadopago },
      });
    }

    // ---------- clasificación ----------
    if (pathname === "/api/leaderboard") {
      if (req.method !== "GET") return send(res, 405, { error: "método no permitido" });
      try {
        const col = await collection();
        if (!col) return send(res, 503, { error: "clasificación no configurada" });
        const limit = clampLimit(searchParams.get("limit"));
        const rows = await col
          .find({}, { projection: { _id: 0, name: 1, netWorth: 1, turns: 1, players: 1 } })
          .sort({ netWorth: -1, turns: 1 })
          .limit(limit)
          .toArray();
        return send(res, 200, { scores: rows });
      } catch {
        return send(res, 500, { error: "error al consultar la clasificación" });
      }
    }

    if (pathname === "/api/scores") {
      if (req.method !== "POST") return send(res, 405, { error: "método no permitido" });
      const ip = req.socket.remoteAddress || "desconocida";
      if (rateLimited(ip)) return send(res, 429, { error: "demasiadas peticiones" });
      const parsed = await readBody(req);
      if (parsed.error) {
        return send(res, parsed.error.includes("grande") ? 413 : 400, { error: parsed.error });
      }
      const check = validateScore(parsed.value);
      if (check.error) return send(res, 400, { error: check.error });
      try {
        const col = await collection();
        if (!col) return send(res, 503, { error: "clasificación no configurada" });
        await col.insertOne({ ...check.value, at: new Date() });
        return send(res, 201, { ok: true });
      } catch {
        return send(res, 500, { error: "no se pudo guardar la puntuación" });
      }
    }

    // ---------- cuentas ----------
    if (pathname === "/api/auth/signup" && req.method === "POST") {
      const ip = req.socket.remoteAddress || "desconocida";
      if (rateLimited(ip, 20)) return send(res, 429, { error: "demasiadas peticiones" });
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const acc = await accounts();
      if (!acc) return send(res, 503, { error: "cuentas no configuradas" });
      const result = await acc.signup(parsed.value);
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 201, result.value);
    }

    if (pathname === "/api/auth/login" && req.method === "POST") {
      const ip = req.socket.remoteAddress || "desconocida";
      if (rateLimited(ip, 20)) return send(res, 429, { error: "demasiadas peticiones" });
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const acc = await accounts();
      if (!acc) return send(res, 503, { error: "cuentas no configuradas" });
      const result = await acc.login(parsed.value);
      if (result.error) return send(res, 401, { error: result.error });
      return send(res, 200, result.value);
    }

    if (pathname === "/api/auth/me" && req.method === "GET") {
      const session = await requireUser(req, res);
      if (!session) return;
      return send(res, 200, { user: publicUser(session.user) });
    }

    if (pathname === "/api/auth/logout" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      await session.acc.logout(session.token);
      return send(res, 200, { ok: true });
    }

    // ---------- tienda ----------
    if (pathname === "/api/store/catalog" && req.method === "GET") {
      return send(res, 200, { products: catalog(), payments: paymentsConfigured(env) });
    }

    if (pathname === "/api/store/checkout" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const { productId, provider } = parsed.value || {};
      if (!PROVIDERS.includes(provider)) return send(res, 400, { error: "proveedor inválido" });
      const product = productById(productId);
      if (!product) return send(res, 400, { error: "producto desconocido" });

      const s = await shop();
      const order = await s.createOrder(session.user, product, provider);
      const proto = req.headers["x-forwarded-proto"] || "http";
      const baseUrl = `${proto}://${req.headers.host || "localhost"}`;
      const checkout = await createCheckout({ provider, order, product, baseUrl, env, fetchImpl });
      if (checkout.error) return send(res, 502, { error: checkout.error });
      await s.markPendingRef(order.id, checkout.value.providerRef);
      return send(res, 201, { url: checkout.value.url, orderId: order.id });
    }

    if (pathname === "/api/store/orders" && req.method === "GET") {
      const session = await requireUser(req, res);
      if (!session) return;
      const s = await shop();
      const orders = await s.orders
        .find({ userId: session.user.id })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
      return send(res, 200, { orders: orders.map(({ _id, ...rest }) => rest) });
    }

    if (pathname === "/api/store/transactions" && req.method === "GET") {
      const session = await requireUser(req, res);
      if (!session) return;
      const s = await shop();
      const rows = await s.listTransactions(session.user.id, clampLimit(searchParams.get("limit")));
      return send(res, 200, { transactions: rows });
    }

    // ---------- webhooks de pago ----------
    // Solo se acredita saldo con la firma del proveedor verificada.
    if (pathname === "/api/payments/webhook/stripe" && req.method === "POST") {
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const ok = verifyStripeSignature(
        parsed.raw,
        req.headers["stripe-signature"],
        env.STRIPE_WEBHOOK_SECRET
      );
      if (!ok) return send(res, 400, { error: "firma inválida" });
      const event = parsed.value;
      if (event?.type !== "checkout.session.completed") return send(res, 200, { ignored: true });
      const session = event.data?.object || {};
      const orderId = session.client_reference_id || session.metadata?.orderId;
      const s = await shop();
      if (!s || !orderId) return send(res, 200, { ignored: true });
      const result = await s.creditOrder(orderId, session.payment_intent || session.id);
      if (result.error) return send(res, 200, { ignored: true });
      return send(res, 200, { ok: true });
    }

    if (pathname === "/api/payments/webhook/mercadopago" && req.method === "POST") {
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const body = parsed.value || {};
      const dataId = body.data?.id || searchParams.get("data.id") || body.id;
      const ok = verifyMercadoPagoSignature({
        dataId,
        requestId: req.headers["x-request-id"],
        header: req.headers["x-signature"],
        secret: env.MERCADOPAGO_WEBHOOK_SECRET,
      });
      if (!ok) return send(res, 400, { error: "firma inválida" });
      if (body.type !== "payment" && body.action !== "payment.created") {
        return send(res, 200, { ignored: true });
      }
      // El pago se consulta al proveedor: el webhook solo avisa, no confirma.
      if (!env.MERCADOPAGO_ACCESS_TOKEN) return send(res, 200, { ignored: true });
      const resPay = await fetchImpl(`https://api.mercadopago.com/v1/payments/${dataId}`, {
        headers: { Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}` },
      });
      const payment = await resPay.json().catch(() => ({}));
      if (payment?.status !== "approved") return send(res, 200, { ignored: true });
      const orderId = payment.external_reference || payment.metadata?.orderId;
      const s = await shop();
      if (!s || !orderId) return send(res, 200, { ignored: true });
      const result = await s.creditOrder(orderId, String(payment.id));
      if (result.error) return send(res, 200, { ignored: true });
      return send(res, 200, { ok: true });
    }

    if (req.method === "GET" || req.method === "HEAD") return serveStatic(res, pathname);
    return send(res, 405, { error: "método no permitido" });
  });

  server.on("close", () => client?.close().catch(() => {}));
  return server;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const pay = paymentsConfigured();
  createServer().listen(port, () => {
    console.log(`Monopoly TAK TAK en http://localhost:${port}`);
    console.log(
      process.env.MONGODB_URI
        ? "Clasificación global y cuentas activadas."
        : "Sin MONGODB_URI: clasificación y cuentas desactivadas."
    );
    console.log(
      `Pagos reales: Stripe ${pay.stripe ? "activo" : "apagado"}, MercadoPago ${
        pay.mercadopago ? "activo" : "apagado"
      }`
    );
  });
}
