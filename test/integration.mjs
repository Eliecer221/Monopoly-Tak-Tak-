// Prueba de integración real: interfaz + servidor + almacén de puntuaciones.
// No hay mocks: se arranca el servidor HTTP, la interfaz envía la puntuación
// por red y se comprueba que la clasificación se guarda y se muestra.

import { JSDOM } from "jsdom";
import fs from "node:fs";
import crypto from "node:crypto";
import { createServer } from "../server/server.mjs";
import { createMemoryDb } from "../server/db.mjs";

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
const STRIPE_WEBHOOK_SECRET = "whsec_integracion";
// `fetch` falso solo para la llamada saliente a Stripe: el resto del flujo
// (HTTP, cuentas, webhook y acreditación) es código real.
const stripeCalls = [];
const fakeFetch = async (url, options) => {
  stripeCalls.push({ url, options });
  if (url.includes("api.stripe.com")) {
    return { ok: true, json: async () => ({ id: "cs_live_1", url: "https://checkout.stripe.com/pay/cs_live_1" }) };
  }
  return { ok: false, json: async () => ({}) };
};
const server = createServer({
  store,
  db: createMemoryDb(),
  env: { STRIPE_SECRET_KEY: "sk_test_int", STRIPE_WEBHOOK_SECRET },
  fetchImpl: fakeFetch,
});
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
const storage = new Map();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  configurable: true,
});

const { Game, resetBoardState } = await import("../js/engine.js");
const { UI } = await import("../js/ui.js");
const { TOKENS, PLAYER_COLORS } = await import("../js/data.js");
const {
  apiEnabled,
  fetchLeaderboard,
  signup,
  checkout,
  me,
  fetchCatalog,
  fetchTransactions,
  setToken,
  getToken,
} = await import("../js/api.js");

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

// ---------- cuentas, tienda y pagos reales, de extremo a extremo ----------
// Se usa el cliente real (js/api.js) contra el servidor real.

const created = await signup({ email: "jefa@ejemplo.com", password: "clavefuerte1", name: "Jefa" });
assert(created.token && created.user.id, "el registro no devolvió sesión");
assert(created.user.wallet.coins === 500, "el usuario nuevo no recibió monedas de bienvenida");
setToken(created.token);
assert(getToken() === created.token, "el token no se guardó en el navegador");
console.log("✓ Integración: registro real y token guardado en el navegador");

const cat = await fetchCatalog();
assert(cat.products.length >= 6, "el catálogo no llega al cliente");
assert(cat.payments.stripe === true, "el cliente no ve Stripe activo");

const coinsBefore = (await me()).user.wallet.coins;
const order = await checkout({ productId: "coins_500", provider: "stripe" });
assert(order.url.includes("stripe.com"), "no se obtuvo la URL de la pasarela");
assert(stripeCalls.some((c) => c.url.includes("api.stripe.com")), "no se llamó a Stripe");
console.log("✓ Integración: la compra abre la pasarela de pago real");

// El pago se confirma por webhook firmado; hasta entonces el saldo no cambia.
assert((await me()).user.wallet.coins === coinsBefore, "el saldo cambió antes de confirmarse el pago");

const event = JSON.stringify({
  type: "checkout.session.completed",
  data: { object: { client_reference_id: order.orderId, payment_intent: "pi_int_1" } },
});
const ts = Math.floor(Date.now() / 1000);
const sig = `t=${ts},v1=${crypto.createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(`${ts}.${event}`).digest("hex")}`;
const hook = await fetch(`http://127.0.0.1:${port}/api/payments/webhook/stripe`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "stripe-signature": sig },
  body: event,
});
assert(hook.status === 200, "el webhook válido fue rechazado");
const coinsAfter = (await me()).user.wallet.coins;
assert(coinsAfter === coinsBefore + 500, `las monedas no se acreditaron: ${coinsBefore} → ${coinsAfter}`);

// Repetir el webhook no puede duplicar el saldo.
await fetch(`http://127.0.0.1:${port}/api/payments/webhook/stripe`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "stripe-signature": sig },
  body: event,
});
assert((await me()).user.wallet.coins === coinsAfter, "un webhook repetido duplicó el saldo");
console.log("✓ Integración: pago confirmado por webhook firmado, acreditado una sola vez");

const hist = await fetchTransactions(10);
assert(hist.transactions.length === 1, "el historial de compras está mal");
assert(hist.transactions[0].amountCents === 199, "el importe registrado es incorrecto");
console.log("✓ Integración: la compra queda en el historial del usuario");

// La interfaz de cuenta pinta la cartera en la cabecera.
const { AccountUI } = await import("../js/account.js");
const account = new AccountUI();
await account.refresh();
account.renderChip();
const chip = document.querySelector("#account-chip");
assert(chip && chip.textContent.includes("Jefa"), "la cabecera no muestra al usuario");
assert(chip.textContent.includes("1.000") || chip.textContent.includes("1,000"), "la cabecera no muestra el saldo");
console.log("✓ Integración: la cabecera muestra usuario y cartera");

await new Promise((r) => server.close(r));
console.log("\n✅ Pruebas de integración superadas");
process.exit(0);
