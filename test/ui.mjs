// Pruebas de la interfaz sobre un DOM simulado (jsdom).
// Simula pulsaciones reales de botones para cubrir tablero, acciones,
// administración de propiedades y el modal de tratos.
// Requiere jsdom: npm install --no-save jsdom && node test/ui.mjs

import { JSDOM } from "jsdom";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;

global.window = window;
global.document = window.document;
global.Node = window.Node;
global.HTMLElement = window.HTMLElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.requestAnimationFrame = global.requestAnimationFrame;
Object.defineProperty(window, "localStorage", {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
});

const { Game, resetBoardState } = await import("../js/engine.js");
const { UI } = await import("../js/ui.js");
const { TOKENS, PLAYER_COLORS } = await import("../js/data.js");

const tick = () => new Promise((r) => setTimeout(r, 5));
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// PRNG determinista: hace reproducible la partida de la prueba.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clickByText(selector, text) {
  const node = [...document.querySelectorAll(selector)].find((n) => n.textContent.includes(text));
  if (!node) throw new Error(`No se encontró "${text}" en ${selector}`);
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  return node;
}

resetBoardState();
const game = new Game({
  players: [
    { name: "Tú", token: TOKENS[0], color: PLAYER_COLORS[0], isAI: false },
    { name: "TAK-Bot", token: TOKENS[1], color: PLAYER_COLORS[1], isAI: true },
    { name: "Taki", token: TOKENS[2], color: PLAYER_COLORS[2], isAI: true },
  ],
  startMoney: 1500,
  speed: 9999,
  rng: mulberry32(4242),
});

const ui = new UI(game);
assert(document.querySelectorAll(".space").length === 40, "el tablero debe tener 40 casillas");
assert(document.querySelectorAll(".board-center").length === 1, "falta el centro del tablero");

game.run().catch((e) => {
  console.error("Fallo del motor:", e);
  process.exit(1);
});

await tick();
assert(document.querySelectorAll(".token").length === 3, "deben dibujarse 3 fichas");
assert(document.querySelectorAll(".player-card").length === 3, "deben dibujarse 3 tarjetas de jugador");

// Juega turnos humanos pulsando el botón de tirar dados y resolviendo decisiones.
let clicks = 0;
for (let i = 0; i < 600 && !game.over; i++) {
  const actions = document.getElementById("actions");
  const btn = actions.querySelector(".action-btn:not([disabled])");
  if (!btn) {
    await tick();
    continue;
  }
  const label = btn.textContent;
  btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  clicks++;

  if (label.includes("Administrar")) {
    assert(document.querySelector(".overlay.show"), "el panel de administración debe abrirse");
    clickByText(".modal .primary-btn", "Listo");
  } else if (label.includes("Proponer trato")) {
    assert(document.querySelector(".overlay.show"), "el modal de trato debe abrirse");
    clickByText(".modal .ghost-btn", "Cancelar");
  } else if (label.includes("Ver detalles")) {
    assert(document.querySelector(".overlay.show"), "el detalle del trato debe abrirse");
    clickByText(".modal .primary-btn", "Cerrar");
  } else {
    await tick();
  }
}

assert(clicks > 10, "deberían haberse pulsado varios botones");
assert(game.over, "la partida debería terminar");
console.log(`✓ Interfaz: ${clicks} pulsaciones, partida terminada con ${game.activePlayers().length} superviviente(s)`);

// Comprueba el modal de detalle de propiedad.
resetBoardState();
const g2 = new Game({
  players: [
    { name: "A", token: TOKENS[0], color: PLAYER_COLORS[0], isAI: true },
    { name: "B", token: TOKENS[1], color: PLAYER_COLORS[1], isAI: true },
  ],
  startMoney: 1500,
  speed: 9999,
});
const ui2 = new UI(g2);
document.querySelector('.space[data-index="1"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
assert(document.querySelector(".overlay.show"), "el detalle de propiedad debe abrirse");
assert(document.querySelector(".rent-table"), "el detalle debe mostrar la tabla de alquileres");
clickByText(".modal .primary-btn", "Cerrar");
console.log("✓ Interfaz: detalle de propiedad y alquileres");

console.log("\n✅ Pruebas de interfaz superadas");
process.exit(0);
