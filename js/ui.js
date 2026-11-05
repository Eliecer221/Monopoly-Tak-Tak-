// Capa de interfaz. Traduce el estado del motor a DOM y viceversa.

import { BOARD, COLOR_GROUPS, TOKENS, groupProperties, spaceColor } from "./data.js";
import { el, fmt, sleep } from "./utils.js";
import { apiEnabled, fetchLeaderboard, submitScore } from "./api.js";

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export class UI {
  constructor(game) {
    this.game = game;
    this.boardEl = document.getElementById("board");
    this.spaceEls = new Map();
    this.tokenEls = new Map();
    this.manageOpen = false;
    this.bindStatic();
    this.renderBoard();
    this.wireGame();
    this.render();
  }

  bindStatic() {
    document.getElementById("btn-rules").addEventListener("click", () => this.openOverlay("rules-overlay"));
    document.getElementById("btn-clear-log").addEventListener("click", () => {
      document.getElementById("log").innerHTML = "";
    });
    for (const btn of document.querySelectorAll("[data-close]")) {
      btn.addEventListener("click", (e) => e.target.closest(".overlay").classList.remove("show"));
    }
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "modal-overlay") this.closeModal();
    });
    window.addEventListener("resize", () => this.positionTokens());
  }

  openOverlay(id) {
    document.getElementById(id).classList.add("show");
  }

  // ---------- tablero ----------
  renderBoard() {
    this.boardEl.innerHTML = "";
    const center = el("div", { class: "board-center" }, [
      el("div", { class: "board-logo", html: "MONOPOLY<br/>TAK TAK<small>EDICIÓN CIUDAD</small>" }),
      el("div", { class: "deck-row" }, [
        el("span", { class: "deck-chip", text: "📦 Arca Común" }),
        el("span", { class: "deck-chip", text: "❓ Suerte" }),
      ]),
    ]);
    this.boardEl.append(center);

    for (const s of BOARD) {
      const node = this.buildSpace(s);
      this.spaceEls.set(s.i, node);
      this.boardEl.append(node);
    }
    requestAnimationFrame(() => this.positionTokens());
  }

  buildSpace(s) {
    const node = el("div", {
      class: "space" + (["go", "jail", "parking", "gotojail"].includes(s.type) ? " corner" : ""),
      "data-index": s.i,
      "data-side": s.side,
    });
    const { row, col } = this.gridPosition(s.i);
    node.style.gridRow = `${row}`;
    node.style.gridColumn = `${col}`;

    if (["property", "railroad", "utility"].includes(s.type)) {
      const bar = el("div", { class: "color-bar" });
      bar.style.background = spaceColor(s);
      node.append(bar);
    }

    const inner = el("div", { class: "space-inner" });
    if (["go", "jail", "parking", "gotojail", "chance", "chest", "tax", "utility"].includes(s.type)) {
      inner.append(el("div", { class: "space-icon", text: s.icon || "🏙️" }));
    }
    inner.append(el("div", { class: "space-name", text: s.name }));
    if (s.price) inner.append(el("div", { class: "space-price", text: `$${s.price}` }));
    if (s.type === "tax") inner.append(el("div", { class: "space-price", text: `$${s.amount}` }));
    node.append(inner);

    node.addEventListener("click", () => this.showPropertyDetail(s.i));
    return node;
  }

  gridPosition(i) {
    if (i <= 10) return { row: 11, col: 11 - i };
    if (i <= 20) return { row: 11 - (i - 10), col: 1 };
    if (i <= 30) return { row: 1, col: 1 + (i - 20) };
    return { row: 1 + (i - 30), col: 11 };
  }

  positionTokens() {
    for (const p of this.game.players) {
      const tok = this.tokenEls.get(p.id);
      const space = this.spaceEls.get(p.position);
      if (!tok || !space) continue;
      const onSame = this.game.players.filter((q) => q.position === p.position);
      const slot = onSame.indexOf(p);
      const offsetX = (slot % 2) * 11 - 5;
      const offsetY = Math.floor(slot / 2) * 11 - 5;
      tok.style.left = `${space.offsetLeft + space.offsetWidth / 2 + offsetX - 10}px`;
      tok.style.top = `${space.offsetTop + space.offsetHeight / 2 + offsetY - 10}px`;
    }
  }

  createTokens() {
    for (const t of this.tokenEls.values()) t.remove();
    this.tokenEls.clear();
    for (const p of this.game.players) {
      const tok = el("div", { class: "token", text: p.token });
      tok.style.background = p.color;
      this.boardEl.append(tok);
      this.tokenEls.set(p.id, tok);
    }
    requestAnimationFrame(() => this.positionTokens());
  }

  // ---------- estado ----------
  render() {
    const g = this.game;
    const cur = g.current;

    document.getElementById("turn-name").textContent = cur ? `${cur.token} ${cur.name}` : "—";

    for (const [id, tok] of this.tokenEls) {
      tok.classList.toggle("active", cur && id === cur.id);
    }

    // jugadores
    const playersEl = document.getElementById("players");
    playersEl.innerHTML = "";
    for (const p of g.players) {
      const card = el("div", {
        class: "player-card" + (cur && p.id === cur.id ? " active" : "") + (p.bankrupt ? " bankrupt" : ""),
      });
      card.style.setProperty("--pc", p.color);
      const head = el("div", { class: "player-head" }, [
        el("span", { class: "player-token", text: p.token }),
        el("span", { class: "player-name", text: p.name }),
        el("span", { class: "player-tag", text: p.isAI ? "IA" : "Humano" }),
      ]);
      card.append(head);
      card.append(el("div", { class: "player-money", text: fmt(p.money) }));
      const meta = el("div", { class: "player-meta" }, [
        el("span", { text: `${p.properties.length} propiedades` }),
        el("span", { text: `Patrimonio ${fmt(g.netWorth(p))}` }),
      ]);
      if (p.inJail) meta.append(el("span", { text: "🚔 En la cárcel" }));
      if (p.jailCards > 0) meta.append(el("span", { text: `🃏 ×${p.jailCards}` }));
      if (p.bankrupt) meta.append(el("span", { text: "💀 En bancarrota" }));
      card.append(meta);

      const props = el("div", { class: "player-props" });
      for (const idx of p.properties) {
        const s = g.space(idx);
        const dot = el("div", { class: "prop-dot" + (s.mortgaged ? " mortgaged" : ""), title: s.name });
        dot.style.background = spaceColor(s);
        props.append(dot);
      }
      card.append(props);
      playersEl.append(card);
    }

    // tablero
    for (const s of BOARD) {
      const node = this.spaceEls.get(s.i);
      const owner = g.players.find((p) => p.properties.includes(s.i));
      node.classList.toggle("owned", !!owner);
      node.classList.toggle("highlight", g.activeSpace === s.i);
      if (owner) node.style.setProperty("--owner-color", owner.color);
      else node.style.removeProperty("--owner-color");

      let flag = node.querySelector(".mortgaged-flag");
      if (s.mortgaged && !flag) {
        node.append(el("div", { class: "mortgaged-flag", text: "HIPOTECADA" }));
      } else if (!s.mortgaged && flag) {
        flag.remove();
      }

      let houses = node.querySelector(".houses");
      const count = s.houses || 0;
      if (count > 0) {
        const text = count === 5 ? "🏨" : "🏠".repeat(count);
        if (!houses) node.append(el("div", { class: "houses", text }));
        else houses.textContent = text;
      } else if (houses) {
        houses.remove();
      }
    }

    this.renderActions();
    this.positionTokens();
  }

  renderActions() {
    const g = this.game;
    const box = document.getElementById("actions");
    box.innerHTML = "";
    const d = g.pending;
    const cur = g.current;

    const addBtn = (label, value, opts = {}) => {
      const btn = el("button", { class: "action-btn" + (opts.primary ? " primary" : ""), type: "button" });
      btn.append(el("span", { text: label }));
      if (opts.hint) btn.append(el("span", { class: "hint", text: opts.hint }));
      if (opts.disabled) btn.disabled = true;
      else btn.addEventListener("click", () => g.decide(value));
      box.append(btn);
      return btn;
    };

    if (g.over) {
      box.append(el("div", { class: "deck-chip", text: "Partida terminada" }));
      return;
    }

    if (!d) {
      box.append(el("div", { class: "deck-chip", text: "Esperando…" }));
      return;
    }

    switch (d.type) {
      case "roll":
        addBtn("🎲 Tirar los dados", "roll", { primary: true, hint: `${cur.token} ${cur.name}` });
        break;
      case "buy":
        for (const o of d.options) addBtn(o.label, o.value, { primary: o.value === "buy" });
        break;
      case "jail":
        d.options.forEach((o, i) => addBtn(o.label, o.value, { primary: i === 0 }));
        break;
      case "card":
        addBtn("Continuar", "ok", { primary: true });
        break;
      case "auction":
        for (const o of d.options) {
          addBtn(o.label, o.value, { primary: typeof o.value === "number" });
        }
        break;
      case "end-turn": {
        addBtn("🏗️ Administrar propiedades", "__manage", { hint: fmt(cur.money) });
        const manageBtn = box.lastChild;
        manageBtn.addEventListener("click", () => this.openManage());
        const tradeBtn = addBtn("🤝 Proponer trato", "__trade");
        tradeBtn.addEventListener("click", () => this.openTrade());
        if (d.canRollAgain) addBtn("🎲 Tirar otra vez (dobles)", "roll-again", { primary: true });
        addBtn("Terminar turno", "end");
        break;
      }
      case "funds": {
        addBtn("🏗️ Administrar propiedades", "__manage", { hint: `Faltan ${fmt(d.amount - cur.money)}` });
        box.lastChild.addEventListener("click", () => this.openManage());
        addBtn(`Ya reuní ${fmt(d.amount)}`, "ok", { primary: true, disabled: cur.money < d.amount });
        addBtn("Declararme en bancarrota", "bankrupt");
        break;
      }
      case "trade-offer": {
        addBtn("✅ Aceptar trato", "accept", { primary: true });
        addBtn("❌ Rechazar", "reject");
        const detail = el("button", { class: "action-btn", type: "button", text: "Ver detalles del trato" });
        detail.addEventListener("click", () => this.showTradeOffer(d));
        box.append(detail);
        break;
      }
      default:
        addBtn("Continuar", "ok", { primary: true });
    }
  }

  // ---------- conexión con el motor ----------
  wireGame() {
    const g = this.game;
    g.on("start", () => this.createTokens());
    g.on("update", () => this.render());
    g.on("turn", () => this.render());
    g.on("move", () => {
      this.positionTokens();
      this.render();
    });
    g.on("land", ({ space }) => {
      this.render();
      const node = this.spaceEls.get(space.i);
      if (node) node.classList.add("highlight");
      setTimeout(() => node && node.classList.remove("highlight"), 700);
    });
    g.on("dice", ({ d1, d2, total, player }) => this.animateDice(d1, d2, total, player));
    g.on("log", (entry) => this.appendLog(entry));
    g.on("toast", (text) => this.toast(text));
    g.on("decision", () => this.renderActions());
    g.on("decision-cleared", () => this.renderActions());
    g.on("phase", () => this.renderActions());
    g.on("card", ({ player, kind, card }) => {
      if (!player.isAI) this.showCard(kind, card, player);
    });
    g.on("gameover", ({ winner }) => this.showWinner(winner));
    g.on("bankrupt", () => this.render());
  }

  async animateDice(d1, d2, total, player) {
    const e1 = document.getElementById("die1");
    const e2 = document.getElementById("die2");
    e1.classList.add("rolling");
    e2.classList.add("rolling");
    document.getElementById("dice-total").textContent = "…";
    await sleep(360 / (this.game.speed || 1));
    e1.classList.remove("rolling");
    e2.classList.remove("rolling");
    e1.textContent = DICE_FACES[d1 - 1];
    e2.textContent = DICE_FACES[d2 - 1];
    document.getElementById("dice-total").textContent = `${total}`;
    if (player) this.toast(`${player.name} saca ${d1} + ${d2} = ${total}`);
  }

  appendLog(entry) {
    const list = document.getElementById("log");
    list.prepend(el("li", { class: entry.kind, text: entry.text }));
    while (list.children.length > 120) list.lastChild.remove();
  }

  toast(text) {
    const t = document.getElementById("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove("show"), 1900);
  }

  // ---------- modales ----------
  openModal(content) {
    const box = document.getElementById("modal-content");
    box.innerHTML = "";
    box.append(content);
    document.getElementById("modal-overlay").classList.add("show");
  }

  closeModal() {
    document.getElementById("modal-overlay").classList.remove("show");
  }

  showCard(kind, card, player) {
    const content = el("div", {}, [
      el("h2", { class: "modal-title", text: kind === "chance" ? "❓ Suerte" : "📦 Arca Común" }),
      el("div", { class: "card-draw" }, [
        el("div", { class: "card-kind", text: player ? player.name : "" }),
        el("div", { class: "card-text", text: card.text }),
      ]),
    ]);
    const actions = el("div", { class: "modal-actions" }, []);
    const btn = el("button", { class: "primary-btn", type: "button", text: "Aceptar" });
    btn.addEventListener("click", () => this.closeModal());
    actions.append(btn);
    content.append(actions);
    this.openModal(content);
  }

  showPropertyDetail(index) {
    const g = this.game;
    const s = g.space(index);
    const owner = g.players.find((p) => p.properties.includes(index));

    const body = el("div", {});
    if (["property", "railroad", "utility"].includes(s.type)) {
      const card = el("div", { class: "prop-card" });
      const bar = el("div", { class: "pc-bar" });
      bar.style.background = spaceColor(s);
      card.append(bar);
      const inner = el("div", { class: "pc-body" });
      inner.append(el("h3", { text: s.name }));
      if (s.type === "property") {
        inner.append(el("div", { class: "player-meta", text: `Grupo ${COLOR_GROUPS[s.group].name} · Precio $${s.price} · Casa $${s.houseCost}` }));
      } else {
        inner.append(el("div", { class: "player-meta", text: `Precio $${s.price}` }));
      }
      card.append(inner);
      body.append(card);

      if (s.type === "property") {
        const table = el("table", { class: "rent-table" });
        const labels = ["Alquiler base", "1 casa", "2 casas", "3 casas", "4 casas", "Hotel"];
        const h = g.houses(index);
        s.rent.forEach((r, i) => {
          const tr = el("tr", { class: i === h ? "current" : "" }, [
            el("td", { text: labels[i] }),
            el("td", { text: fmt(r) }),
          ]);
          table.append(tr);
        });
        body.append(table);
      } else if (s.type === "railroad") {
        const table = el("table", { class: "rent-table" });
        [25, 50, 100, 200].forEach((r, i) => {
          table.append(el("tr", {}, [el("td", { text: `${i + 1} estación(es)` }), el("td", { text: fmt(r) })]));
        });
        body.append(table);
      } else if (s.type === "utility") {
        body.append(el("div", { class: "player-meta", text: "Alquiler: 4× dados (10× si posees ambas compañías)." }));
      }
    } else {
      body.append(el("h2", { class: "modal-title", text: s.name }));
      if (s.type === "tax") body.append(el("p", { class: "modal-sub", text: `Paga ${fmt(s.amount)} al banco.` }));
      if (s.type === "go") body.append(el("p", { class: "modal-sub", text: "Cobra $200 cada vez que pasas." }));
      if (s.type === "jail") body.append(el("p", { class: "modal-sub", text: "Solo de visita… o cumpliendo condena." }));
      if (s.type === "parking") body.append(el("p", { class: "modal-sub", text: "Descanso gratis." }));
      if (s.type === "gotojail") body.append(el("p", { class: "modal-sub", text: "Directo a la cárcel sin cobrar salida." }));
      if (s.type === "chance" || s.type === "chest") body.append(el("p", { class: "modal-sub", text: "Roba una carta y sigue las instrucciones." }));
    }

    if (owner) {
      body.append(el("div", { class: "player-meta", text: `Propiedad de ${owner.token} ${owner.name}${s.mortgaged ? " (hipotecada)" : ""}` }));
    } else if (["property", "railroad", "utility"].includes(s.type)) {
      body.append(el("div", { class: "player-meta", text: "Disponible en el banco" }));
    }

    const actions = el("div", { class: "modal-actions" }, []);
    const close = el("button", { class: "primary-btn", type: "button", text: "Cerrar" });
    close.addEventListener("click", () => this.closeModal());
    actions.append(close);

    if (owner === g.current && !g.over) {
      const manage = el("button", { class: "ghost-btn", type: "button", text: "Administrar" });
      manage.addEventListener("click", () => this.openManage());
      actions.prepend(manage);
    }

    body.append(actions);
    this.openModal(body);
  }

  openManage() {
    const g = this.game;
    const player = g.current;
    const content = el("div", {});
    content.append(el("h2", { class: "modal-title", text: `🏗️ ${player.name}` }));
    content.append(el("p", { class: "modal-sub", text: `Efectivo disponible: ${fmt(player.money)}` }));

    if (!player.properties.length) {
      content.append(el("div", { class: "deck-chip", text: "Todavía no tienes propiedades." }));
    }

    const list = el("div", { class: "choice-list" });
    for (const idx of [...player.properties].sort((a, b) => a - b)) {
      const s = g.space(idx);
      const row = el("div", { class: "pc-row" });
      const dot = el("div", { class: "prop-dot" });
      dot.style.background = spaceColor(s);
      row.append(dot);
      const info = el("div", { style: "flex:1;min-width:0" }, [
        el("div", { class: "player-name", text: s.name }),
        el("div", {
          class: "player-meta",
          text: s.mortgaged
            ? "Hipotecada"
            : s.type === "property"
            ? `${g.houses(idx) === 5 ? "Hotel" : `${g.houses(idx)} casa(s)`} · Grupo ${COLOR_GROUPS[s.group].name}`
            : "Sin construcciones",
        }),
      ]);
      row.append(info);

      const btnBox = el("div", { class: "segmented" });

      if (g.canBuild(player, idx)) {
        const b = el("button", { type: "button", text: `+ Casa ($${s.houseCost})` });
        b.addEventListener("click", () => {
          g.buildHouse(player, idx);
          this.openManage();
        });
        btnBox.append(b);
      }
      if (g.canSellHouse(player, idx)) {
        const b = el("button", { type: "button", text: `− Casa (+$${Math.floor(s.houseCost / 2)})` });
        b.addEventListener("click", () => {
          g.sellHouse(player, idx);
          this.openManage();
        });
        btnBox.append(b);
      }
      if (g.canMortgage(player, idx)) {
        const b = el("button", { type: "button", text: `Hipotecar (+$${Math.floor(s.price / 2)})` });
        b.addEventListener("click", () => {
          g.mortgage(player, idx);
          this.openManage();
        });
        btnBox.append(b);
      }
      if (g.canUnmortgage(player, idx)) {
        const b = el("button", { type: "button", text: `Levantar (−$${g.unmortgageCost(idx)})` });
        b.addEventListener("click", () => {
          g.unmortgage(player, idx);
          this.openManage();
        });
        btnBox.append(b);
      }
      row.append(btnBox);
      list.append(row);
    }
    content.append(list);

    const actions = el("div", { class: "modal-actions" }, []);
    const close = el("button", { class: "primary-btn", type: "button", text: "Listo" });
    close.addEventListener("click", () => {
      this.closeModal();
      this.renderActions();
    });
    actions.append(close);
    content.append(actions);
    this.openModal(content);
  }

  // ---------- tratos ----------
  openTrade() {
    const g = this.game;
    const me = g.current;
    const others = g.activePlayers().filter((p) => p !== me);
    if (!others.length) {
      this.toast("No hay otros jugadores con quien negociar");
      return;
    }
    const state = {
      target: others[0],
      giveProperties: new Set(),
      getProperties: new Set(),
      giveMoney: 0,
      getMoney: 0,
    };
    const render = () => this.renderTradeModal(state, render);
    render();
  }

  renderTradeModal(state, rerender) {
    const g = this.game;
    const me = g.current;
    const target = state.target;

    const content = el("div", {});
    content.append(el("h2", { class: "modal-title", text: "🤝 Proponer trato" }));
    content.append(el("p", { class: "modal-sub", text: `Tu efectivo: ${fmt(me.money)} · ${target.name}: ${fmt(target.money)}` }));

    const targetRow = el("div", { class: "pc-row" });
    targetRow.append(el("span", { class: "pc-token", text: target.token }));
    const sel = el("select", {});
    for (const p of g.activePlayers().filter((x) => x !== me)) {
      const opt = el("option", { value: p.id, text: `${p.token} ${p.name}` });
      if (p === target) opt.selected = true;
      sel.append(opt);
    }
    sel.addEventListener("change", () => {
      state.target = g.players.find((p) => p.id === Number(sel.value));
      state.getProperties.clear();
      rerender();
    });
    targetRow.append(sel);
    content.append(targetRow);

    const grid = el("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px" });

    const makeColumn = (title, owner, set, moneyKey) => {
      const col = el("div", {});
      col.append(el("div", { class: "player-meta", style: "margin-bottom:6px", text: `${title} (${owner.name})` }));
      const list = el("div", { class: "choice-list" });
      const tradeable = owner.properties.filter((i) => g.canTradeProperty(owner, i));
      if (!tradeable.length) list.append(el("div", { class: "deck-chip", text: "Sin propiedades" }));
      for (const idx of tradeable.sort((a, b) => a - b)) {
        const s = g.space(idx);
        const row = el("label", { class: "pc-row", style: "cursor:pointer" });
        const cb = el("input", { type: "checkbox" });
        cb.checked = set.has(idx);
        cb.addEventListener("change", () => {
          if (cb.checked) set.add(idx);
          else set.delete(idx);
          rerender();
        });
        row.append(cb);
        const dot = el("div", { class: "prop-dot" });
        dot.style.background = spaceColor(s);
        row.append(dot);
        row.append(el("span", { class: "player-name", text: s.name }));
        row.append(el("span", { class: "hint", text: fmt(s.price) }));
        list.append(row);
      }
      col.append(list);
      const moneyRow = el("div", { class: "pc-row", style: "margin-top:6px" });
      moneyRow.append(el("span", { class: "player-name", text: "Efectivo" }));
      const input = el("input", { type: "number", min: "0", step: "10", value: state[moneyKey], style: "flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid var(--line);border-radius:9px;color:var(--text);padding:8px 10px" });
      input.addEventListener("input", () => {
        state[moneyKey] = Math.max(0, Number(input.value) || 0);
        rerender();
      });
      moneyRow.append(input);
      col.append(moneyRow);
      return col;
    };

    grid.append(makeColumn("Recibes de", target, state.getProperties, "getMoney"));
    grid.append(makeColumn("Entregas a", me, state.giveProperties, "giveMoney"));
    content.append(grid);

    // resumen
    const offer = this.buildOffer(state);
    const error = g.validateTrade(me, target, offer);
    const summary = el("div", { class: "player-meta", style: "margin-top:10px" });
    if (error) summary.append(el("span", { text: `⚠️ ${error}` }));
    else summary.append(el("span", { text: "Trato válido. El otro jugador deberá aceptarlo." }));
    content.append(summary);

    const actions = el("div", { class: "modal-actions" }, []);
    const cancel = el("button", { class: "ghost-btn", type: "button", text: "Cancelar" });
    cancel.addEventListener("click", () => this.closeModal());
    actions.append(cancel);
    const send = el("button", { class: "primary-btn", type: "button", text: "Enviar propuesta" });
    send.disabled = !!error;
    send.addEventListener("click", async () => {
      this.closeModal();
      await g.proposeTrade(me, target, offer);
      this.render();
      this.renderActions();
    });
    actions.append(send);
    content.append(actions);

    this.openModal(content);
  }

  buildOffer(state) {
    return {
      giveProperties: [...state.giveProperties],
      getProperties: [...state.getProperties],
      giveMoney: state.giveMoney,
      getMoney: state.getMoney,
    };
  }

  showTradeOffer(d) {
    const g = this.game;
    const { proposer, offer } = d;
    const content = el("div", {});
    content.append(el("h2", { class: "modal-title", text: `Trato de ${proposer.name}` }));
    const list = (title, props, money) => {
      const box = el("div", { style: "margin-bottom:10px" });
      box.append(el("div", { class: "player-meta", text: title }));
      if (!props.length && !money) box.append(el("div", { class: "deck-chip", text: "Nada" }));
      for (const idx of props) box.append(el("div", { class: "player-name", text: `• ${g.space(idx).name}` }));
      if (money) box.append(el("div", { class: "player-name", text: `• ${fmt(money)} en efectivo` }));
      return box;
    };
    content.append(list("Recibes", offer.giveProperties || [], offer.giveMoney || 0));
    content.append(list("Entregas", offer.getProperties || [], offer.getMoney || 0));
    const actions = el("div", { class: "modal-actions" }, []);
    const close = el("button", { class: "primary-btn", type: "button", text: "Cerrar" });
    close.addEventListener("click", () => this.closeModal());
    actions.append(close);
    content.append(actions);
    this.openModal(content);
  }

  showWinner(winner) {
    const content = el("div", { class: "winner-box" }, []);
    content.append(el("div", { class: "winner-token", text: winner ? winner.token : "🏆" }));
    content.append(el("h2", { text: winner ? `¡${winner.name} gana!` : "Partida terminada" }));
    content.append(el("p", { text: winner ? `Patrimonio final: ${fmt(this.game.netWorth(winner))}` : "No queda ningún jugador." }));

    // Clasificación global: solo si el jugador humano ganó y hay backend.
    const humanWon = winner && !winner.isAI;
    const board = el("div", { class: "leaderboard" });
    content.append(board);

    if (humanWon && apiEnabled()) {
      const status = el("p", { class: "modal-sub", text: "Enviando tu puntuación…" });
      content.append(status);
      // Se consulta la clasificación después de enviar la puntuación: si no,
      // la petición de lectura puede adelantarse y no incluirla.
      submitScore({
        name: winner.name,
        netWorth: Math.round(this.game.netWorth(winner)),
        turns: this.game.turnCount,
        players: this.game.players.length,
      })
        .then(() => (status.textContent = "Puntuación enviada a la clasificación."))
        .catch(() => (status.textContent = "No se pudo enviar la puntuación."))
        .finally(() => this.renderLeaderboard(board));
    }

    const actions = el("div", { class: "modal-actions" }, []);
    const again = el("button", { class: "primary-btn", type: "button", text: "Nueva partida" });
    again.addEventListener("click", () => window.location.reload());
    actions.append(again);
    content.append(actions);
    this.openModal(content);

    if (apiEnabled() && !humanWon) this.renderLeaderboard(board);
  }

  async renderLeaderboard(container) {
    try {
      const rows = await fetchLeaderboard(10);
      container.innerHTML = "";
      container.append(el("h3", { class: "modal-sub", text: "🏆 Mejores partidas" }));
      if (!rows.length) {
        container.append(el("p", { class: "modal-sub", text: "Todavía no hay puntuaciones." }));
        return;
      }
      const list = el("ol", { class: "leaderboard-list" });
      for (const row of rows) {
        list.append(
          el("li", {
            text: `${row.name} — ${fmt(row.netWorth)} · ${row.turns} turnos · ${row.players} jugadores`,
          })
        );
      }
      container.append(list);
    } catch {
      container.innerHTML = "";
      container.append(el("p", { class: "modal-sub", text: "Clasificación no disponible." }));
    }
  }
}

export function tokenList() {
  return TOKENS;
}

export { groupProperties };
