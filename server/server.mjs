// Servidor de Monopoly TAK TAK: sirve el juego y la clasificación global.
//
// Uso:
//   MONGODB_URI="mongodb+srv://..." node server/server.mjs
//
// La cadena de conexión nunca se guarda en el repositorio: llega por variable
// de entorno. Sin ella, el juego se sirve igual y la API responde 503.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LIMIT = 50;
const MAX_NAME = 16;
const MAX_SCORE = 10_000_000;
const MAX_TURNS = 100_000;
const POSTS_PER_MINUTE = 10;

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
  if (!Number.isInteger(players) || players < 2 || players > 4) {
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(body);
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
} = {}) {
  let client = null;
  let scores = store;
  const hits = new Map();

  async function collection() {
    if (scores) return scores;
    if (!uri) return null;
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    const col = client.db(dbName).collection("scores");
    await col.createIndex({ netWorth: -1 });
    scores = col;
    return scores;
  }

  function rateLimited(ip) {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || now > entry.reset) {
      hits.set(ip, { count: 1, reset: now + 60_000 });
      return false;
    }
    entry.count++;
    return entry.count > POSTS_PER_MINUTE;
  }

  const server = http.createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") return send(res, 204, {});

    // Render usa esta ruta para saber si la instancia está viva.
    if (pathname === "/health") {
      return send(res, 200, { ok: true, leaderboard: Boolean(uri || store) });
    }

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
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) return send(res, 413, { error: "cuerpo demasiado grande" });
      }
      let parsed;
      try {
        parsed = JSON.parse(raw || "{}");
      } catch {
        return send(res, 400, { error: "JSON inválido" });
      }
      const check = validateScore(parsed);
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
  createServer().listen(port, () => {
    console.log(`Monopoly TAK TAK en http://localhost:${port}`);
    console.log(
      process.env.MONGODB_URI
        ? "Clasificación global activada."
        : "Sin MONGODB_URI: la clasificación queda desactivada."
    );
  });
}
