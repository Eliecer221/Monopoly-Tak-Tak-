// Pruebas del servidor: validación de puntuaciones, límites y API de
// clasificación. Usa un almacén en memoria, sin tocar ninguna base de datos
// real ni requerir red.

import { createServer, validateScore, clampLimit } from "../server/server.mjs";
import net from "node:net";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Almacén en memoria que imita la colección de MongoDB.
function memoryStore() {
  const rows = [];
  return {
    rows,
    createIndex: async () => {},
    insertOne: async (doc) => {
      rows.push(doc);
      return { insertedId: rows.length };
    },
    find: (_filter, _opts) => {
      const sorted = [...rows];
      return {
        sort: (spec) => {
          const [field, dir] = Object.entries(spec)[0];
          sorted.sort((a, b) => (dir < 0 ? b[field] - a[field] : a[field] - b[field]));
          return { limit: (n) => ({ toArray: async () => sorted.slice(0, n) }) };
        },
      };
    },
  };
}

async function request(base, path, options) {
  const res = await fetch(`${base}${path}`, options);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const post = (payload) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

// Petición HTTP cruda: `fetch` normaliza la ruta antes de enviarla, así que no
// sirve para comprobar travesía de rutas ni rutas con codificación.
function rawRequest(port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.on("data", (chunk) => (data += chunk));
    socket.on("error", reject);
    socket.on("end", () => resolve(Number(data.split(" ")[1])));
  });
}

function main() {
  // --- Validación pura ---
  assert(validateScore({ name: "Ana", netWorth: 1200, turns: 40, players: 3 }).value.name === "Ana", "puntuación válida rechazada");
  assert(validateScore({ name: "", netWorth: 10, turns: 1, players: 2 }).error, "nombre vacío aceptado");
  assert(validateScore({ name: "Ana", netWorth: -5, turns: 1, players: 2 }).error, "patrimonio negativo aceptado");
  assert(validateScore({ name: "Ana", netWorth: 10, turns: 1.5, players: 2 }).error, "turnos no enteros aceptados");
  assert(validateScore({ name: "Ana", netWorth: 10, turns: 1, players: 5 }).error, "5 jugadores aceptados");
  assert(validateScore({ name: "x".repeat(50), netWorth: 10, turns: 1, players: 2 }).value.name.length === 16, "nombre no recortado");
  assert(clampLimit("999") === 50, "límite alto no acotado");
  assert(clampLimit("0") === 1, "límite bajo no acotado");
  assert(clampLimit("abc") === 10, "límite por defecto incorrecto");
  console.log("✓ Validación: entradas válidas e inválidas se clasifican bien");

  return (async () => {
    const store = memoryStore();
    const server = createServer({ store });
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      // Clasificación vacía
      let res = await request(base, "/api/leaderboard");
      assert(res.status === 200 && res.body.scores.length === 0, "clasificación inicial no está vacía");

      // Rechazos
      res = await request(base, "/api/scores", post({ name: "", netWorth: 5, turns: 1, players: 2 }));
      assert(res.status === 400, "puntuación sin nombre aceptada");
      res = await request(base, "/api/scores", post({ name: "Ana", netWorth: 5, turns: 1, players: 9 }));
      assert(res.status === 400, "número de jugadores inválido aceptado");
      res = await request(base, "/api/scores", { method: "POST", body: "{no json" });
      assert(res.status === 400, "JSON inválido aceptado");

      // Inserción y orden
      for (const [name, netWorth, turns] of [["Ana", 900, 50], ["Luis", 2400, 30], ["Marta", 1500, 20]]) {
        res = await request(base, "/api/scores", post({ name, netWorth, turns, players: 3 }));
        assert(res.status === 201, `no se guardó la puntuación de ${name}`);
      }
      res = await request(base, "/api/leaderboard?limit=2");
      assert(res.status === 200, "no se pudo leer la clasificación");
      assert(res.body.scores.length === 2, "el límite no se aplicó");
      assert(res.body.scores[0].name === "Luis", "el orden por patrimonio es incorrecto");
      assert(res.body.scores[0].netWorth === 2400, "el patrimonio guardado es incorrecto");
      assert(!("_id" in res.body.scores[0]), "se filtró el _id interno");

      // El juego se sirve por HTTP
      res = await request(base, "/");
      assert(res.status === 200, "no se sirve index.html");
      assert(String(res.body).includes("MONOPOLY"), "index.html servido no es el juego");

      // Rutas y archivos sensibles: nada fuera del proyecto ni archivos ocultos.
      // Las rutas con "../" sin codificar las normaliza el propio servidor
      // dentro del proyecto, así que la prueba usa la forma codificada.
      const port = server.address().port;
      assert((await rawRequest(port, "/..%2fpackage.json")) === 403, "travesía de rutas permitida");
      assert((await rawRequest(port, "/..%2f..%2fetc%2fpasswd")) === 403, "escape al sistema permitido");
      assert((await rawRequest(port, "/.env")) === 403, "un archivo .env se sirvió públicamente");
      assert((await rawRequest(port, "/.git/config")) === 403, "el directorio .git se sirvió públicamente");

      // Métodos no permitidos
      res = await request(base, "/api/scores", { method: "GET" });
      assert(res.status === 405, "GET sobre /api/scores permitido");
      console.log("✓ API: validación, inserción, orden, límites y servido de archivos");

      // Sin backend configurado la API avisa en vez de fallar
      const off = createServer({ uri: "" });
      await new Promise((r) => off.listen(0, r));
      const offBase = `http://127.0.0.1:${off.address().port}`;
      res = await request(offBase, "/api/leaderboard");
      assert(res.status === 503, "sin base de datos la API debería responder 503");
      res = await request(offBase, "/");
      assert(res.status === 200, "el juego debe servirse aunque no haya base de datos");
      await new Promise((r) => off.close(r));
      console.log("✓ Sin base de datos: el juego se sirve y la API responde 503");
    } finally {
      await new Promise((r) => server.close(r));
    }

    console.log("\n✅ Pruebas del servidor superadas");
  })();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
