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

import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { createMemoryDb, createMongoDb, ensureIndexes } from "./db.mjs";
import { Accounts, publicUser } from "./auth.mjs";
import { Store, catalog, productById } from "./store.mjs";
import { Kyc, checkPurchaseAllowed, selfExclude, limitsFor } from "./kyc.mjs";
import { ReceiptValidator } from "./ai-receipts.mjs";
import { Zinli, splitPot, validateBuyIn, withdrawalQuote, zinliConfigured, zinliPayTo, POT_WINNER_SHARE } from "./zinli.mjs";
import { verifyTotp } from "./totp.mjs";
import { createPool, migrate, LedgerRepository } from "./ledger.mjs";
import { OutboxWorker } from "./outbox-worker.mjs";
import { FinancialPolicy } from "./policy.mjs";
import { createAirtmProvider } from "./airtm.mjs";
import { checkOperatorPayout } from "./operator.mjs";
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
  ledger = null,
  policy = null,
  airtm = null,
} = {}) {
  let client = null;
  let scores = store;
  const hits = new Map();

  // Modo de desarrollo: datos en memoria, se pierden al reiniciar. Sirve para
  // probar cuentas y tienda en local sin montar Atlas. Nunca en producción.
  let database =
    db || (env.TAKTAK_MEMORY_DB === "1" ? createMemoryDb() : null);

  // Libro contable con PostgreSQL. Es opcional: sin DATABASE_URL el servidor
  // arranca igual y las rutas de dinero responden 503.
  let ledgerRepo = ledger;
  let outboxWorker = null;
  const ledgerPool = env.DATABASE_URL
    ? createPool({ connectionString: env.DATABASE_URL, max: Number(env.DATABASE_POOL || 8) })
    : null;
  if (ledgerPool && !ledgerRepo) {
    ledgerRepo = new LedgerRepository(ledgerPool, {
      projectId: env.PROJECT_ID || "tak-tak",
      assetId: env.COIN_SYMBOL || "MTC",
    });
  }
  const financialPolicy =
    policy || (database ? new FinancialPolicy(database, { adminToken: env.ADMIN_TOKEN }) : null);
  const airtmProvider = airtm || createAirtmProvider(env);
  // Las partidas con entrada real son dinero real. Quedan APAGADAS por defecto:
  // exigen un flag explícito además del libro contable. Sin él, la ruta responde
  // 503 y el juego funciona igual sin apostar.
  const realMoneyRounds = env.REAL_MONEY_ROUNDS === "1";

  // Emite en el libro las monedas de una compra ya pagada. Si el libro no está
  // configurado, la compra sigue funcionando con el saldo de Mongo.
  async function mintOrderCoins(order, credited) {
    if (!ledgerRepo || credited?.value?.alreadyPaid) return;
    const product = productById(order.productId);
    if (!product?.coins) return;
    try {
      await ledgerRepo.mintCoins({
        orderId: order.id,
        userId: order.userId,
        coins: product.coins,
        reference: order.provider || "",
      });
    } catch { /* el libro es opcional */ }
  }

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

  async function kycService() {
    const d = await getDb();
    return d ? new Kyc(d) : null;
  }

  async function zinliService() {
    const d = await getDb();
    return d ? new Zinli(d) : null;
  }

  async function receipts() {
    const d = await getDb();
    return d ? new ReceiptValidator(d, { env, fetchImpl }) : null;
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
        zinli: zinliConfigured(env),
        aiReceipts: Boolean(env.OPENAI_API_KEY || env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY),
        ledger: Boolean(ledgerRepo),
        realMoneyRounds: realMoneyRounds && Boolean(ledgerRepo),
        operatorPayout: (() => {
          const op = checkOperatorPayout(env);
          // Solo se publica la forma de la configuración, nunca el valor.
          return { channel: op.channel, configured: op.ok };
        })(),
        airtm: { enabled: Boolean(airtmProvider?.enabled), mode: airtmProvider?.name || "desconocido" },
      });
    }

    // ---------- libro contable ----------
    // Requieren DATABASE_URL. Sin él responden 503 y el juego sigue igual.
    if (pathname.startsWith("/api/ledger/")) {
      if (!ledgerRepo || !financialPolicy) {
        return send(res, 503, { error: "libro contable no configurado" });
      }

      // Saldo del usuario según los asientos.
      if (pathname === "/api/ledger/balance" && req.method === "GET") {
        const session = await requireUser(req, res);
        if (!session) return;
        try {
          const amount = await ledgerRepo.userBalance(session.user.id);
          return send(res, 200, {
            userId: session.user.id,
            assetId: ledgerRepo.assetId,
            amount: amount.toString(),
          });
        } catch (err) {
          return send(res, 500, { error: err.message });
        }
      }

      // Solicitud de retiro: política, límites, reserva e idempotencia.
      if (pathname === "/api/ledger/withdraw" && req.method === "POST") {
        const session = await requireUser(req, res);
        if (!session) return;
        const user = session.user;
        const parsed = await readBody(req);
        if (parsed.error) return send(res, 400, { error: parsed.error });
        const body = parsed.value || {};

        const idempotencyKey = String(body.idempotencyKey || "");
        if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(idempotencyKey)) {
          return send(res, 400, { error: "clave de idempotencia inválida" });
        }
        const destinationToken = String(body.destinationToken || "").trim();
        if (destinationToken.length < 3 || destinationToken.length > 250) {
          return send(res, 400, { error: "destino inválido" });
        }
        const amount = Number.parseInt(body.amount, 10);
        if (!Number.isInteger(amount) || amount <= 0) {
          return send(res, 400, { error: "importe inválido" });
        }

        try {
          await financialPolicy.authorize({ actor: user, action: "withdraw" });
          await financialPolicy.checkLimits({ actor: user, amount, ledger: ledgerRepo });
          const result = await ledgerRepo.requestWithdrawalOnce({
            userId: user.id,
            amount,
            fee: Number.parseInt(body.fee || "0", 10) || 0,
            destinationToken,
            idempotencyKey,
          });
          await ledgerRepo.audit({ actorId: user.id, action: "withdraw.request", target: result.withdrawalId });
          return send(res, result.duplicate ? 200 : 201, result);
        } catch (err) {
          const code = err.code || "ERROR";
          const status =
            code === "INSUFFICIENT_FUNDS" ? 400 :
            code === "UNAUTHENTICATED" ? 401 :
            code.startsWith("LIMIT_") || code.includes("REQUIRED") || code === "SELF_EXCLUDED" ? 403 : 500;
          return send(res, status, { error: err.message, code });
        }
      }

      // Conciliación: solo administrador.
      if (pathname === "/api/ledger/reconcile" && req.method === "POST") {
        try {
          financialPolicy.requireAdmin(req.headers["x-admin-token"]);
        } catch (err) {
          return send(res, 403, { error: err.message });
        }
        try {
          const result = await ledgerRepo.reconcile();
          await ledgerRepo.audit({ actorId: "admin", action: "reconcile", detail: { ok: result.ok } });
          return send(res, 200, {
            ...result,
            ledgerTotal: result.ledgerTotal.toString(),
            externalTotal: result.externalTotal.toString(),
            difference: result.difference.toString(),
          });
        } catch (err) {
          return send(res, 500, { error: err.message });
        }
      }

      return send(res, 404, { error: "ruta del libro contable no encontrada" });
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
      // El saldo de bienvenida también entra en el libro. Si falla, no se
      // bloquea el registro: el juego funciona con el saldo de Mongo y el
      // usuario podrá jugar en cuanto el libro esté disponible.
      if (ledgerRepo) {
        try {
          await ledgerRepo.mintCoins({
            orderId: `welcome:${result.value.user.id}`,
            userId: result.value.user.id,
            coins: WELCOME_COINS,
            reference: "saldo de bienvenida",
          });
        } catch { /* el registro no depende del libro */ }
      }
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
      const user = publicUser(session.user);
      // Si hay libro contable, el saldo que ve el juego es el del libro: es la
      // única fuente de verdad del dinero.
      if (ledgerRepo) {
        try {
          const amount = await ledgerRepo.userBalance(session.user.id);
          user.wallet = { ...user.wallet, coins: Number(amount) };
        } catch { /* se mantiene el saldo de Mongo */ }
      }
      return send(res, 200, { user });
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

    // ---------- verificación de correo y teléfono ----------
    if (pathname === "/api/auth/verify/start" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const channel = parsed.value?.channel;
      if (!["email", "phone"].includes(channel)) return send(res, 400, { error: "canal inválido" });
      const result = await session.acc.startVerification(session.user, channel);
      // En desarrollo el código se devuelve para poder probar; en producción se
      // envía por correo o SMS y nunca se incluye en la respuesta.
      const freshUser = (await getDb()).collection("users").findOne({ id: session.user.id });
      const devCode = env.TAKTAK_DEV_CODES === "1" ? await freshUser : null;
      if (env.TAKTAK_DEBUG === "1") console.log("DBG id:", session.user.id, "code:", devCode?.[`${channel}Code`], "keys:", Object.keys(devCode || {}).join(","));
      return send(res, 200, {
        ...result.value,
        ...(env.TAKTAK_DEV_CODES === "1" ? { devCode: devCode?.[`${channel}Code`] } : {}),
      });
    }

    if (pathname === "/api/auth/verify/confirm" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const { channel, code } = parsed.value || {};
      if (!["email", "phone"].includes(channel)) return send(res, 400, { error: "canal inválido" });
      const result = await session.acc.confirmVerification(session.user, channel, code);
      if (result.error) return send(res, 400, { error: result.error });
      const fresh = await (await accounts()).userForToken(session.token);
      return send(res, 200, { ...result.value, user: publicUser(fresh) });
    }

    // ---------- 2FA ----------
    if (pathname === "/api/auth/2fa/setup" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const result = await session.acc.setupTwoFactor(session.user);
      return send(res, 200, result.value);
    }

    if (pathname === "/api/auth/2fa/enable" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const result = await session.acc.enableTwoFactor(session.user, parsed.value?.code);
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 200, result.value);
    }

    if (pathname === "/api/auth/2fa/disable" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const fresh = await (await accounts()).userForToken(session.token);
      // Desactivar el 2FA exige un código válido: si no, una sesión robada
      // podría quitarlo y quedarse con la cuenta.
      if (fresh?.twoFactor?.enabled && !verifyTotp(fresh.twoFactor.secret, parsed.value?.code)) {
        return send(res, 400, { error: "código de 2FA incorrecto" });
      }
      const result = await session.acc.disableTwoFactor(session.user);
      return send(res, 200, result.value);
    }

    // ---------- KYC ----------
    if (pathname === "/api/kyc/submit" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const svc = await kycService();
      if (!svc) return send(res, 503, { error: "KYC no configurado" });
      const result = await svc.submit(session.user, parsed.value);
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 201, result.value);
    }

    if (pathname === "/api/kyc/status" && req.method === "GET") {
      const session = await requireUser(req, res);
      if (!session) return;
      const fresh = await (await accounts()).userForToken(session.token);
      return send(res, 200, { kyc: fresh.kyc || { status: "none" }, limits: limitsFor(fresh) });
    }

    if (pathname === "/api/kyc/decide" && req.method === "POST") {
      // Solo el administrador decide. Se protege con ADMIN_TOKEN.
      const token = req.headers["x-admin-token"];
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return send(res, 403, { error: "no autorizado" });
      }
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const svc = await kycService();
      if (!svc) return send(res, 503, { error: "KYC no configurado" });
      const result = await svc.decide(parsed.value?.userId, parsed.value?.status, parsed.value?.reason);
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 200, result.value);
    }

    // ---------- juego responsable ----------
    if (pathname === "/api/responsible/self-exclude" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const update = selfExclude(session.user, parsed.value?.days);
      await (await getDb()).collection("users").updateOne({ id: session.user.id }, update);
      return send(res, 200, { selfExcludedUntil: update.$set.selfExcludedUntil });
    }

    // ---------- compra de monedas por Zinli ----------
    if (pathname === "/api/zinli/quote" && req.method === "GET") {
      return send(res, 200, { pay: zinliPayTo(env), configured: zinliConfigured(env) });
    }

    if (pathname === "/api/zinli/order" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const product = productById(parsed.value?.productId);
      if (!product) return send(res, 400, { error: "producto desconocido" });
      if (!zinliConfigured(env)) return send(res, 502, { error: "Zinli no está configurado" });
      const allowed = checkPurchaseAllowed(session.user, product.priceCents);
      if (allowed.error) return send(res, 403, { error: allowed.error });
      const s = await shop();
      const order = await s.createOrder(session.user, product, "zinli");
      return send(res, 201, {
        orderId: order.id,
        amountCents: order.amountCents,
        pay: zinliPayTo(env),
      });
    }

    if (pathname === "/api/zinli/receipt" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const { orderId, image, reference } = parsed.value || {};
      if (!image || !String(image).startsWith("data:image/")) {
        return send(res, 400, { error: "sube una captura del comprobante" });
      }
      const s = await shop();
      const order = await s.getOrder(orderId);
      if (!order || order.userId !== session.user.id) return send(res, 404, { error: "orden desconocida" });
      if (order.status === "paid") return send(res, 200, { verdict: "approved", alreadyPaid: true });
      const validator = await receipts();
      if (!validator) return send(res, 503, { error: "validación no configurada" });
      const attemptsToday = await (await getDb()).collection("receipts").countDocuments({
        userId: session.user.id,
        at: { $gte: new Date(Date.now() - 864e5).toISOString() },
      });
      const review = await validator.review({ order, image, declaredReference: reference, user: session.user, attemptsToday });
      if (review.verdict === "approved") {
        const credited = await s.creditOrder(order.id, `zinli:${review.imageHash.slice(0, 16)}`);
        await mintOrderCoins(order, credited);
        return send(res, 200, { verdict: "approved", score: review.score, reasons: review.reasons });
      }
      return send(res, 200, { verdict: review.verdict, score: review.score, reasons: review.reasons });
    }

    // ---------- revisión manual de comprobantes (administrador) ----------
    if (pathname === "/api/admin/receipts" && req.method === "GET") {
      if (!env.ADMIN_TOKEN || req.headers["x-admin-token"] !== env.ADMIN_TOKEN) {
        return send(res, 403, { error: "no autorizado" });
      }
      const d = await getDb();
      const rows = await d
        .collection("receipts")
        .find({ verdict: "manual_review" })
        .sort({ at: -1 })
        .limit(50)
        .toArray();
      return send(res, 200, { receipts: rows.map(({ _id, ...r }) => r) });
    }

    if (pathname === "/api/admin/receipts/decide" && req.method === "POST") {
      if (!env.ADMIN_TOKEN || req.headers["x-admin-token"] !== env.ADMIN_TOKEN) {
        return send(res, 403, { error: "no autorizado" });
      }
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const { orderId, approve } = parsed.value || {};
      const s = await shop();
      const order = await s.getOrder(orderId);
      if (!order) return send(res, 404, { error: "orden desconocida" });
      if (approve) {
        const credited = await s.creditOrder(orderId, "manual:admin");
        await mintOrderCoins(order, credited);
      }
      else await s.orders.updateOne({ id: orderId }, { $set: { status: "rejected" } });
      return send(res, 200, { ok: true, status: approve ? "paid" : "rejected" });
    }

    // ---------- retiros por Zinli ----------
    if (pathname === "/api/zinli/withdrawal" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const svc = await zinliService();
      if (!svc) return send(res, 503, { error: "retiros no configurados" });
      const result = await svc.requestWithdrawal(session.user, parsed.value?.coins);
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 201, result.value);
    }

    if (pathname === "/api/zinli/withdrawal/quote" && req.method === "GET") {
      const result = withdrawalQuote(searchParams.get("coins"));
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 200, result.value);
    }

    if (pathname === "/api/zinli/withdrawals" && req.method === "GET") {
      const session = await requireUser(req, res);
      if (!session) return;
      const d = await getDb();
      const rows = await d
        .collection("withdrawals")
        .find({ userId: session.user.id })
        .sort({ at: -1 })
        .limit(20)
        .toArray();
      return send(res, 200, { withdrawals: rows.map(({ _id, ...w }) => w) });
    }

    if (pathname === "/api/admin/withdrawals/decide" && req.method === "POST") {
      if (!env.ADMIN_TOKEN || req.headers["x-admin-token"] !== env.ADMIN_TOKEN) {
        return send(res, 403, { error: "no autorizado" });
      }
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const svc = await zinliService();
      const result = await svc.decide(parsed.value?.id, parsed.value?.status, parsed.value?.note);
      if (result.error) return send(res, 400, { error: result.error });
      return send(res, 200, result.value);
    }

    // ---------- bote de monedas de la partida ----------
    // ---------- partida con entrada: el servidor fija las reglas ----------
    // El cliente NO decide la entrada, ni los jugadores, ni el ganador. Abre la
    // partida el servidor, con las reglas y la entrada apartada en el libro.
    if (pathname === "/api/rounds/open" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      if (!ledgerRepo) return send(res, 503, { error: "libro contable no configurado" });
      if (!realMoneyRounds) {
        return send(res, 503, { error: "las partidas con dinero real están desactivadas" });
      }
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const buyIn = validateBuyIn(parsed.value?.buyIn);
      if (buyIn.error) return send(res, 400, { error: buyIn.error });
      if (buyIn.value <= 0) return send(res, 400, { error: "la entrada debe ser mayor que cero" });
      const players = Number(parsed.value?.players);
      if (!Number.isInteger(players) || players < 2 || players > 8) {
        return send(res, 400, { error: "la partida necesita de 2 a 8 jugadores" });
      }
      // La comisión la fija el servidor, no el cliente.
      const winnerSharePct = Math.round(POT_WINNER_SHARE * 100);
      try {
        const roundId = `rnd_${crypto.randomUUID()}`;
        const result = await ledgerRepo.openRound({
          hostUserId: session.user.id,
          buyIn: buyIn.value,
          maxPlayers: players,
          winnerSharePct,
          roundId,
        });
        await ledgerRepo.audit({ actorId: session.user.id, action: "round.open", target: roundId });
        return send(res, 201, {
          roundId,
          buyIn: buyIn.value,
          players,
          // Lo único que se guarda de verdad es la entrada del anfitrión.
          entry: result.entry,
          winnerCredit: result.winnerCredit,
          rake: result.rake,
        });
      } catch (err) {
        const code = err.code || "ERROR";
        const status =
          code === "INSUFFICIENT_FUNDS" ? 403 : code.startsWith("BAD_") ? 400 : 500;
        return send(res, status, { error: err.message, code });
      }
    }

    // Cierra la partida. El servidor recalcula todo con las reglas guardadas al
    // abrir: ni el bote ni el reparto salen del cliente.
    if (pathname === "/api/rounds/settle" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      if (!ledgerRepo) return send(res, 503, { error: "libro contable no configurado" });
      if (!realMoneyRounds) {
        return send(res, 503, { error: "las partidas con dinero real están desactivadas" });
      }
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      const roundId = String(parsed.value?.roundId || "");
      if (!roundId) return send(res, 400, { error: "falta la partida" });
      const won = parsed.value?.won;
      if (typeof won !== "boolean") return send(res, 400, { error: "falta el resultado de la partida" });
      try {
        const result = await ledgerRepo.settleRound({
          roundId,
          winnerUserId: session.user.id,
          players: Number(parsed.value?.players),
          won,
        });
        await ledgerRepo.audit({
          actorId: session.user.id,
          action: "round.settle",
          target: roundId,
          detail: { won },
        });
        const amount = await ledgerRepo.userBalance(session.user.id);
        return send(res, 200, { ...result, balance: amount.toString() });
      } catch (err) {
        const code = err.code || "ERROR";
        const status =
          code === "NO_ROUND" ? 404 :
          code === "ROUND_CLOSED" || code === "WINNER_NOT_PARTICIPANT" ? 409 :
          code.startsWith("BAD_") || code === "TOO_MANY_PLAYERS" || code === "PLAYERS_MISMATCH" ? 400 : 500;
        return send(res, status, { error: err.message, code });
      }
    }

    if (pathname === "/api/rounds/cancel" && req.method === "POST") {
      const session = await requireUser(req, res);
      if (!session) return;
      if (!ledgerRepo) return send(res, 503, { error: "libro contable no configurado" });
      if (!realMoneyRounds) {
        return send(res, 503, { error: "las partidas con dinero real están desactivadas" });
      }
      const parsed = await readBody(req);
      if (parsed.error) return send(res, 400, { error: parsed.error });
      try {
        const result = await ledgerRepo.cancelRound({ roundId: String(parsed.value?.roundId || "") });
        return send(res, 200, result);
      } catch (err) {
        return send(res, err.code === "NO_ROUND" ? 404 : 409, { error: err.message, code: err.code });
      }
    }

    if (req.method === "GET" || req.method === "HEAD") return serveStatic(res, pathname);
    return send(res, 405, { error: "método no permitido" });
  });

  server.on("close", () => {
    client?.close().catch(() => {});
    outboxWorker?.stop();
    if (ledgerPool && !ledger) ledgerPool.end().catch(() => {});
  });
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
