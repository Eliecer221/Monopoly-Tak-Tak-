// Punto de entrada: pantalla de configuración, arranque y guardado.

import { Game, resetBoardState } from "./engine.js";
import { UI } from "./ui.js";
import { AccountUI } from "./account.js";
import { TOKENS, TOKEN_NAMES, PLAYER_COLORS, AI_NAMES } from "./data.js";
import { el } from "./utils.js";

const STORAGE_KEY = "monopoly-tak-tak-save-v1";

const setup = {
  count: 2,
  money: 1500,
  buyIn: 0,
  players: [],
};

function defaultPlayers(count) {
  return Array.from({ length: count }, (_, i) => ({
    name: i === 0 ? "Tú" : AI_NAMES[i - 1] || `Jugador ${i + 1}`,
    token: TOKENS[i],
    color: PLAYER_COLORS[i],
    isAI: i !== 0,
  }));
}

function renderPlayerConfig() {
  setup.players = defaultPlayers(setup.count);
  const box = document.getElementById("player-config");
  box.innerHTML = "";
  setup.players.forEach((p, i) => {
    const row = el("div", { class: "pc-row" });
    row.append(el("span", { class: "pc-token", text: p.token, title: TOKEN_NAMES[i] }));
    const name = el("input", { type: "text", value: p.name, maxlength: "16" });
    name.addEventListener("input", () => (setup.players[i].name = name.value || `Jugador ${i + 1}`));
    row.append(name);
    const sel = el("select", {});
    for (const [value, label] of [["human", "Humano"], ["ai", "IA"]]) {
      const opt = el("option", { value, text: label });
      if ((value === "ai") === p.isAI) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      setup.players[i].isAI = sel.value === "ai";
      if (setup.players[i].isAI && !setup.players[i].name.trim()) setup.players[i].name = AI_NAMES[i - 1] || "TAK-Bot";
    });
    row.append(sel);
    box.append(row);
  });
}

function bindSetup() {
  const countBox = document.getElementById("player-count");
  countBox.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-count]");
    if (!btn) return;
    for (const b of countBox.children) b.classList.toggle("active", b === btn);
    setup.count = Number(btn.dataset.count);
    renderPlayerConfig();
  });

  const moneyBox = document.getElementById("start-money");
  moneyBox.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-money]");
    if (!btn) return;
    for (const b of moneyBox.children) b.classList.toggle("active", b === btn);
    setup.money = Number(btn.dataset.money);
  });

  const buyInBox = document.getElementById("buy-in");
  buyInBox.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-buyin]");
    if (!btn) return;
    for (const b of buyInBox.children) b.classList.toggle("active", b === btn);
    setup.buyIn = Number(btn.dataset.buyin);
  });

  document.getElementById("btn-start").addEventListener("click", () => {
    document.getElementById("setup-overlay").classList.remove("show");
    startGame({ players: setup.players, startMoney: setup.money, buyIn: setup.buyIn });
  });

  document.getElementById("btn-new").addEventListener("click", () => {
    if (confirm("¿Empezar una partida nueva? Se perderá el progreso actual.")) {
      window.location.reload();
    }
  });

  document.getElementById("btn-save").addEventListener("click", () => {
    if (!window.game) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(window.game.toJSON()));
    window.ui.toast("Partida guardada en este navegador");
  });

  document.getElementById("btn-load").addEventListener("click", () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.ui?.toast("No hay partida guardada");
      return;
    }
    try {
      const data = JSON.parse(raw);
      document.getElementById("setup-overlay").classList.remove("show");
      resetBoardState();
      const game = Game.fromJSON(data);
      boot(game);
      window.ui.toast("Partida cargada");
    } catch (err) {
      console.error(err);
      window.ui?.toast("No se pudo cargar la partida");
    }
  });
}

function startGame(config) {
  resetBoardState();
  const game = new Game(config);
  // El buy-in forma el bote inicial: cada jugador aporta lo mismo.
  const perPlayer = config.buyIn || 0;
  if (perPlayer > 0) game.contribute(perPlayer * config.players.length);
  boot(game);
}

function boot(game) {
  window.game = game;
  try {
    const ui = new UI(game);
    window.ui = ui;
    game.run().catch((err) => {
      console.error("Error en el motor:", err);
      showFatal(err);
    });
  } catch (err) {
    console.error("Error al iniciar la interfaz:", err);
    showFatal(err);
  }
}

function showFatal(err) {
  const box = document.createElement("pre");
  box.style.cssText =
    "position:fixed;inset:auto 12px 12px 12px;max-height:40vh;overflow:auto;z-index:999;background:#2a0d12;color:#ffc9ce;padding:14px;border-radius:12px;font-size:12px;border:1px solid #ff5f6d";
  box.textContent = `Error: ${err && err.message}\n\n${err && err.stack}`;
  document.body.append(box);
}

// expuesto para las pruebas automatizadas
window.TakTak = { Game, UI, AccountUI, resetBoardState, startGame, boot };

bindSetup();
renderPlayerConfig();

// Cuentas y tienda: se inicializan siempre; si no hay backend, avisan al usarse.
window.account = new AccountUI();

// Al volver de la pasarela de pago (?compra=ok) se refresca la cartera.
const params = new URLSearchParams(window.location.search);
if (params.get("compra")) {
  const estado = params.get("compra");
  window.account.refresh().then(() => {
    window.ui?.toast(
      estado === "ok"
        ? "Pago recibido. Tu saldo se acredita al confirmarse."
        : "Compra cancelada."
    );
  });
}
