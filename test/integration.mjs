// Prueba de integración real: interfaz + servidor + almacén de puntuaciones.
// No hay mocks: se arranca el servidor HTTP, la interfaz envía la puntuación
// por red y se comprueba que la clasificación se guarda y se muestra.

import { JSDOM } from "jsdom";
import fs from "node:fs";
import { createServer } from "../server/server.mjs";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Almacén en memoria con la misma forma que la colección de MongoDB.
function memoryStore() {
  const rows = [];
  return {
    rows,
    createIndex: async () => {},
    insertOne: async (doc) => {
      rows.push(doc);
      return { insertedId: rows.length };
    },
    find: () => ({
      sort: () => ({
        limit: (n) => ({
          toArray: async () =>
            [...rows].sort((a, b) => b.netWorth - a.netWorth).slice(0, n),
        }),
      }),
    }),
  };
}

const store = memoryStore();
const server = createServer({ store });
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

// La interfaz debe creer que se sirve por HTTP y saber dónde está la API.
const dom = new JSDOM(fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"), {
  runScripts: "outside-only",
  pretendToBeVisual: true,
  url: `http://127.0.0.1:${port}/`,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.Node = window.Node;
global.HTMLElement = window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.requestAnimationFrame = global.requestAnimationFrame;
window.TAKTAK_API_BASE = `http://127.0.0.1:${port}`;
Object.defineProperty(window, "localStorage", {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
});

const { Game, resetBoardState } = await import("../js/engine.js");
const { UI } = await import("../js/ui.js");
const { TOKENS, PLAYER_COLORS } = await import("../js/data.js");
const { apiEnabled, fetchLeaderboard } = await import("../js/api.js");

assert(apiEnabled(), "la API debería estar activa con un backend configurado");

resetBoardState();
const game = new Game({
  players: [
    { name: "Eliecer", token: TOKENS[0], color: PLAYER_COLORS[0], isAI: false },
    { name: "TAK-Bot", token: TOKENS[1], color: PLAYER_COLORS[1], isAI: true },
  ],
  startMoney: 1500,
  speed: 9999,
});
const ui = new UI(game);

const human = game.players[0];
ui.showWinner(human);

// Espera a que la puntuación viaje por la red y se pinte la clasificación.
const deadline = Date.now() + 4000;
while (Date.now() < deadline && !document.querySelector(".leaderboard-list li")) {
  await new Promise((r) => setTimeout(r, 50));
}

const rows = await fetchLeaderboard(10);
assert(rows.length === 1, `debería haber 1 puntuación, hay ${rows.length}`);
assert(rows[0].name === "Eliecer", "el nombre guardado es incorrecto");
assert(rows[0].netWorth === game.netWorth(human), "el patrimonio guardado es incorrecto");
assert(rows[0].players === 2, "el número de jugadores guardado es incorrecto");

const item = document.querySelector(".leaderboard-list li");
assert(item, "la clasificación no se pintó en el modal del ganador");
assert(item.textContent.includes("Eliecer"), "la clasificación no muestra al ganador");
console.log("✓ Integración: la puntuación viaja por HTTP, se guarda y se muestra en el modal");

// Un ganador IA no debe enviar nada a la clasificación.
const before = store.rows.length;
resetBoardState();
const g2 = new Game({
  players: [
    { name: "Ana", token: TOKENS[0], color: PLAYER_COLORS[0], isAI: true },
    { name: "Luis", token: TOKENS[1], color: PLAYER_COLORS[1], isAI: true },
  ],
  startMoney: 1500,
  speed: 9999,
});
const ui2 = new UI(g2);
ui2.showWinner(g2.players[0]);
await new Promise((r) => setTimeout(r, 300));
assert(store.rows.length === before, "una victoria de la IA no debería enviar puntuación");
console.log("✓ Integración: la victoria de la IA no contamina la clasificación");

await new Promise((r) => server.close(r));
console.log("\n✅ Pruebas de integración superadas");
process.exit(0);
