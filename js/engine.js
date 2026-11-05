// Motor de reglas de Monopoly TAK TAK.
// El motor es agnóstico de la interfaz: emite eventos y espera decisiones
// de los jugadores humanos a través de promesas.

import {
  BOARD,
  COLOR_GROUPS,
  RAILROAD_RENTS,
  GO_REWARD,
  JAIL_FINE,
  JAIL_POSITION,
  START_MONEY,
  MAGNATE,
  groupProperties,
} from "./data.js";
import { CHANCE_CARDS, CHEST_CARDS } from "./cards.js";
import { shuffle, sleep } from "./utils.js";

class Emitter {
  constructor() {
    this._listeners = new Map();
  }
  on(evt, fn) {
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(fn);
    return () => this._listeners.get(evt).delete(fn);
  }
  emit(evt, payload) {
    for (const fn of this._listeners.get(evt) || []) fn(payload);
    for (const fn of this._listeners.get("*") || []) fn({ evt, payload });
  }
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export class Game extends Emitter {
  constructor(config = {}) {
    super();
    this.startMoney = config.startMoney ?? START_MONEY;
    this.speed = config.speed ?? 1; // multiplicador de velocidad de animación
    this.turnCount = 0;
    this.over = false;
    this.pending = null;
    this.rng = config.rng ?? Math.random;
    this.chanceDeck = shuffle(CHANCE_CARDS, this.rng);
    this.chestDeck = shuffle(CHEST_CARDS, this.rng);
    this.log = [];
    const roster = config.players || [];
    if (roster.length < MIN_PLAYERS || roster.length > MAX_PLAYERS) {
      throw new Error(`La partida necesita entre ${MIN_PLAYERS} y ${MAX_PLAYERS} jugadores.`);
    }
    // Bote simulado: solo contabilidad interna, no mueve dinero real.
    this.pot = {
      buyIn: config.buyIn ?? 0,
      contributions: 0,
      housePercent: 40,
    };
    this.magnateNextTurn = MAGNATE.everyTurns;
    this.players = roster.map((p, idx) => ({
      id: idx,
      name: p.name || `Jugador ${idx + 1}`,
      token: p.token || "🎩",
      color: p.color || "#ffd23f",
      isAI: !!p.isAI,
      money: this.startMoney,
      position: 0,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      bankrupt: false,
      properties: [],
      doublesStreak: 0,
      skipTurns: 0,
    }));
    this.currentIndex = 0;
    this.lastRoll = null;
    this.phase = "idle";
    this.activeSpace = null;
    this.pendingStack = [];
  }

  // ---------- consultas ----------
  get current() {
    return this.players[this.currentIndex];
  }

  activePlayers() {
    return this.players.filter((p) => !p.bankrupt);
  }

  space(index) {
    return BOARD[((index % 40) + 40) % 40];
  }

  ownedBy(player) {
    return player.properties.map((i) => this.space(i));
  }

  ownsGroup(player, group) {
    const props = groupProperties(group);
    return props.length > 0 && props.every((s) => player.properties.includes(s.i));
  }

  countType(player, type) {
    return player.properties.filter((i) => this.space(i).type === type).length;
  }

  isMortgaged(index) {
    const s = this.space(index);
    return !!s.mortgaged;
  }

  houses(index) {
    return this.space(index).houses || 0;
  }

  // ---------- dinero ----------
  addMoney(player, amount) {
    player.money += amount;
    this.emit("update");
  }

  transfer(from, to, amount) {
    if (amount <= 0) return;
    from.money -= amount;
    if (to) to.money += amount;
    this.emit("update");
  }

  logEvent(text, kind = "info") {
    const entry = { text, kind, turn: this.turnCount };
    this.log.push(entry);
    if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
    this.emit("log", entry);
  }

  toast(text) {
    this.emit("toast", text);
  }

  // ---------- bote simulado ----------
  // Todo el dinero del bote es contabilidad interna de la partida: el juego no
  // procesa pagos reales. Ver las advertencias legales en RULES.md.
  contribute(amount) {
    const value = Math.max(0, Math.round(Number(amount) || 0));
    if (!value) return this.pot;
    this.pot.contributions += value;
    this.emit("pot", this.pot);
    return this.pot;
  }

  potTotal() {
    return this.pot.contributions;
  }

  // Reparto al terminar: el ganador se lleva el 60% y la casa el 40%.
  payout() {
    const total = this.potTotal();
    const house = Math.round(total * (this.pot.housePercent / 100));
    return { total, house, winner: total - house };
  }

  // ---------- decisiones ----------
  // Las decisiones se apilan para permitir flujos anidados (por ejemplo,
  // proponer un trato mientras se espera a que el jugador termine el turno).
  ask(decision) {
    return new Promise((resolve) => {
      this.pendingStack.push({ ...decision, resolve });
      this.pending = this.pendingStack[this.pendingStack.length - 1];
      this.emit("decision", this.pending);
    });
  }

  decide(value) {
    const p = this.pendingStack.pop();
    if (!p) return;
    this.pending = this.pendingStack[this.pendingStack.length - 1] || null;
    p.resolve(value);
    this.emit("decision-cleared", p);
    if (this.pending) this.emit("decision", this.pending);
  }

  cancelDecision() {
    const p = this.pendingStack.pop();
    if (!p) return;
    this.pending = this.pendingStack[this.pendingStack.length - 1] || null;
    p.resolve(null);
    this.emit("decision-cleared", p);
    if (this.pending) this.emit("decision", this.pending);
  }

  async pause(ms) {
    if (this.speed >= 1000) return;
    await sleep(ms / this.speed);
  }

  // ---------- ciclo principal ----------
  async run() {
    this.emit("start");
    this.logEvent(`Comienza la partida con ${this.players.length} jugadores.`, "info");
    while (!this.over) {
      await this.playTurn(this.current);
      if (this.over) break;
      this.advanceTurn();
    }
  }

  advanceTurn() {
    let guard = 0;
    do {
      this.currentIndex = (this.currentIndex + 1) % this.players.length;
      guard++;
    } while (this.current.bankrupt && guard < this.players.length + 1);
    this.turnCount++;
    this.current.doublesStreak = 0;
    this.emit("turn", this.current);
  }

  async playTurn(player) {
    if (player.bankrupt) return;
    if (player.skipTurns > 0) {
      player.skipTurns--;
      this.logEvent(`${player.name} pierde el turno.`, "bad");
      this.toast(`${player.name} pierde el turno`);
      await this.pause(300);
      return;
    }
    this.emit("turn", player);
    await this.maybeMagnate(player);
    if (this.over) return;
    let rolls = 0;

    while (true) {
      if (player.inJail) {
        const freed = await this.handleJail(player);
        if (!freed) break;
      }

      if (!player.isAI) {
        this.phase = "ready";
        this.emit("phase", this.phase);
        await this.ask({ type: "roll", player, text: "Tira los dados para moverte." });
      }

      const { d1, d2 } = this.rollDice();
      const total = d1 + d2;
      const isDouble = d1 === d2;
      this.emit("dice", { d1, d2, total, player });

      if (isDouble) {
        rolls++;
        if (rolls === 3) {
          this.logEvent(`${player.name} saca 3 dobles seguidos y va a la cárcel.`, "bad");
          this.toast("¡Tres dobles! A la cárcel.");
          await this.sendToJail(player);
          break;
        }
      }

      await this.movePlayer(player, total);
      if (this.over) return;
      await this.resolveLanding(player, total, 0);
      if (this.over) return;

      const again = await this.endOfRollPhase(player, isDouble);
      if (!again) break;
    }
    await this.checkGameOver();
  }

  async endOfRollPhase(player, canRollAgain) {
    this.phase = "manage";
    this.emit("phase", this.phase);
    if (player.isAI) {
      await this.pause(320);
      await this.aiManage(player);
      return canRollAgain && !player.inJail;
    }
    const choice = await this.ask({
      type: "end-turn",
      player,
      canRollAgain,
      text: canRollAgain
        ? "Sacaste dobles: puedes tirar otra vez o terminar el turno."
        : "Administra tus propiedades y termina el turno.",
    });
    if (choice === "roll-again" && canRollAgain) return true;
    return false;
  }

  rollDice() {
    const d1 = 1 + Math.floor(this.rng() * 6);
    const d2 = 1 + Math.floor(this.rng() * 6);
    this.lastRoll = { d1, d2, total: d1 + d2 };
    return { d1, d2 };
  }

  async movePlayer(player, steps) {
    const from = player.position;
    const target = from + steps;
    for (let p = from + 1; p <= target; p++) {
      const idx = p % 40;
      player.position = idx;
      if (idx === 0) {
        this.addMoney(player, GO_REWARD);
        this.logEvent(`${player.name} pasa por SALIDA y cobra $200.`, "good");
        this.toast(`${player.name} cobra $200 por pasar por SALIDA`);
      }
      this.emit("move", { player, index: idx });
      await this.pause(90);
    }
  }

  async teleport(player, index, passGo) {
    const from = player.position;
    if (passGo && index < from) {
      this.addMoney(player, GO_REWARD);
      this.logEvent(`${player.name} pasa por SALIDA y cobra $200.`, "good");
    }
    player.position = index;
    this.emit("move", { player, index });
    await this.pause(240);
  }

  async sendToJail(player) {
    player.position = JAIL_POSITION;
    player.inJail = true;
    player.jailTurns = 0;
    player.doublesStreak = 0;
    this.emit("move", { player, index: JAIL_POSITION });
    this.logEvent(`${player.name} va a la cárcel.`, "bad");
    await this.pause(320);
  }

  // ---------- cárcel ----------
  async handleJail(player) {
    player.jailTurns++;
    const canPay = player.money >= JAIL_FINE;

    if (player.isAI) {
      await this.pause(300);
      if (player.jailCards > 0) {
        player.jailCards--;
        player.inJail = false;
        this.logEvent(`${player.name} usa una carta para salir de la cárcel.`, "good");
        return true;
      }
      if (canPay && (player.jailTurns >= 2 || player.money > 400)) {
        this.transfer(player, null, JAIL_FINE);
        player.inJail = false;
        player.jailTurns = 0;
        this.logEvent(`${player.name} paga $50 y sale de la cárcel.`, "info");
        return true;
      }
      const { d1, d2 } = this.rollDice();
      this.emit("dice", { d1, d2, total: d1 + d2, player });
      if (d1 === d2) {
        player.inJail = false;
        player.jailTurns = 0;
        this.logEvent(`${player.name} saca dobles y sale de la cárcel.`, "good");
        await this.movePlayer(player, d1 + d2);
        if (!this.over) await this.resolveLanding(player, d1 + d2, 0);
        return false;
      }
      if (player.jailTurns >= 3) {
        if (canPay) {
          this.transfer(player, null, JAIL_FINE);
          player.inJail = false;
          player.jailTurns = 0;
          this.logEvent(`${player.name} paga $50 tras 3 intentos y sale.`, "info");
          await this.movePlayer(player, d1 + d2);
          if (!this.over) await this.resolveLanding(player, d1 + d2, 0);
          return false;
        }
        this.declareBankrupt(player, null);
        return false;
      }
      this.logEvent(`${player.name} no saca dobles y sigue en la cárcel.`, "bad");
      return false;
    }

    // humano
    const options = [];
    if (canPay) options.push({ value: "pay", label: "Pagar $50 y salir" });
    if (player.jailCards > 0) options.push({ value: "card", label: "Usar carta de salida libre" });
    options.push({ value: "roll", label: "Intentar sacar dobles" });

    const choice = await this.ask({
      type: "jail",
      player,
      options,
      text: `Estás en la cárcel (intento ${player.jailTurns}/3). ¿Qué haces?`,
    });

    if (choice === "pay") {
      this.transfer(player, null, JAIL_FINE);
      player.inJail = false;
      player.jailTurns = 0;
      this.logEvent(`${player.name} paga $50 y sale de la cárcel.`, "info");
      return true;
    }
    if (choice === "card") {
      player.jailCards--;
      player.inJail = false;
      player.jailTurns = 0;
      this.logEvent(`${player.name} usa una carta para salir de la cárcel.`, "good");
      return true;
    }

    const { d1, d2 } = this.rollDice();
    this.emit("dice", { d1, d2, total: d1 + d2, player });
    if (d1 === d2) {
      player.inJail = false;
      player.jailTurns = 0;
      this.logEvent(`${player.name} saca dobles y sale de la cárcel.`, "good");
      await this.movePlayer(player, d1 + d2);
      if (!this.over) await this.resolveLanding(player, d1 + d2, 0);
      return false;
    }
    if (player.jailTurns >= 3) {
      if (player.money >= JAIL_FINE) {
        this.transfer(player, null, JAIL_FINE);
        player.inJail = false;
        player.jailTurns = 0;
        this.logEvent(`${player.name} paga $50 tras 3 intentos y sale.`, "info");
        await this.movePlayer(player, d1 + d2);
        if (!this.over) await this.resolveLanding(player, d1 + d2, 0);
      } else {
        this.declareBankrupt(player, null);
      }
      return false;
    }
    this.logEvent(`${player.name} no saca dobles y sigue en la cárcel.`, "bad");
    return false;
  }

  // ---------- casillas ----------
  // El costo de una crisis sube con el turno: la cosa empeora con el tiempo.
  crisisAmount(space, player) {
    const base = space.amount || 50;
    const escala = 1 + Math.floor(this.turnCount / 40) * 0.25;
    return Math.round(base * escala);
  }

  // ---------- El Magnate Trumpista ----------
  // Cada MAGNATE.everyTurns turnos aparece a ofrecer un trato al jugador
  // actual. Es el personaje central del juego: acepta o rechaza.
  async maybeMagnate(player) {
    if (this.turnCount < this.magnateNextTurn) return;
    this.magnateNextTurn += MAGNATE.everyTurns;
    const deal = MAGNATE.deals[Math.floor(this.rng() * MAGNATE.deals.length)];
    this.emit("magnate", { player, deal });
    this.logEvent(`${MAGNATE.icon} ${MAGNATE.name} aparece ante ${player.name}.`, "info");

    let accepts;
    if (player.isAI) {
      await this.pause(400);
      // La IA acepta si el trato no la deja sin fondos.
      accepts = deal.accept.amount >= 0 || player.money > Math.abs(deal.accept.amount) + 200;
    } else {
      accepts = await this.ask({
        type: "magnate",
        player,
        deal,
        text: deal.text,
        options: [
          { value: "accept", label: "Aceptar el deal" },
          { value: "reject", label: "Rechazar" },
        ],
      });
      accepts = accepts === "accept";
    }

    if (accepts) {
      this.logEvent(deal.acceptText, "good");
      const amount = deal.accept.amount;
      if (amount >= 0) this.addMoney(player, amount);
      else await this.charge(player, -amount, null, "deal del magnate");
    } else {
      this.logEvent(deal.rejectText, "bad");
      // Rechazar tiene consecuencia: en algunos tratos se pierde el turno.
      if (deal.rejectLoseTurn) player.skipTurns = (player.skipTurns || 0) + 1;
    }
  }

  async resolveLanding(player, diceTotal, depth) {
    const s = this.space(player.position);
    this.activeSpace = s.i;
    this.emit("land", { player, space: s });
    await this.pause(200);

    switch (s.type) {
      case "go":
      case "jail":
      case "parking":
        break;
      case "tax":
        this.logEvent(`${player.name} paga ${s.name} ($${s.amount}).`, "bad");
        await this.charge(player, s.amount, null, `impuesto ${s.name}`);
        break;
      case "crisis": {
        const amount = this.crisisAmount(s, player);
        this.logEvent(`${player.name} cae en crisis: ${s.name} (paga $${amount}).`, "bad");
        this.toast(`Crisis: ${s.name}`);
        await this.charge(player, amount, null, `crisis ${s.name}`);
        break;
      }
      case "gotojail":
        await this.sendToJail(player);
        break;
      case "chance":
        await this.drawCard(player, "chance", depth);
        break;
      case "chest":
        await this.drawCard(player, "chest", depth);
        break;
      case "property":
      case "railroad":
        await this.landOnOwnable(player, s, diceTotal);
        break;
      default:
        break;
    }
  }

  async drawCard(player, kind, depth) {
    const deckKey = kind === "chance" ? "chanceDeck" : "chestDeck";
    const label = kind === "chance" ? "Suerte" : "Caja Comunal";
    if (!this[deckKey].length) {
      this[deckKey] = shuffle(kind === "chance" ? CHANCE_CARDS : CHEST_CARDS, this.rng);
    }
    const card = this[deckKey].shift();
    this[deckKey].push(card);
    this.logEvent(`${player.name} saca ${label}: ${card.text}`, "info");
    this.emit("card", { player, kind, card });
    if (!player.isAI) {
      await this.ask({ type: "card", player, kind, card, text: card.text });
    } else {
      await this.pause(500);
    }
    await this.applyCardEffect(player, card.effect, depth);
  }

  async applyCardEffect(player, effect, depth) {
    switch (effect.kind) {
      case "money":
        if (effect.amount >= 0) this.addMoney(player, effect.amount);
        else await this.charge(player, -effect.amount, null, "carta");
        break;
      case "jail":
        await this.sendToJail(player);
        break;
      case "jailfree":
        player.jailCards++;
        break;
      case "back": {
        const target = (player.position - effect.steps + 40) % 40;
        await this.teleport(player, target, false);
        if (depth < 3) await this.resolveLanding(player, this.lastRoll?.total ?? 0, depth + 1);
        break;
      }
      case "move":
        await this.teleport(player, effect.to, !!effect.passGo);
        if (depth < 3) await this.resolveLanding(player, this.lastRoll?.total ?? 0, depth + 1);
        break;
      case "repairs": {
        let cost = 0;
        for (const idx of player.properties) {
          const h = this.houses(idx);
          if (h === 5) cost += effect.hotel;
          else cost += effect.house * h;
        }
        if (cost > 0) {
          this.logEvent(`${player.name} paga $${cost} por reparaciones.`, "bad");
          await this.charge(player, cost, null, "reparaciones");
        } else {
          this.logEvent(`${player.name} no tiene construcciones que reparar.`, "info");
        }
        break;
      }
      case "collectEach": {
        let got = 0;
        for (const other of this.activePlayers()) {
          if (other === player) continue;
          const take = Math.min(effect.amount, other.money);
          this.transfer(other, player, take);
          got += take;
        }
        this.logEvent(`${player.name} recibe $${got} de los demás jugadores.`, "good");
        break;
      }
      case "payEach": {
        let paid = 0;
        for (const other of this.activePlayers()) {
          if (other === player) continue;
          const ok = await this.charge(player, effect.amount, other, "pago");
          if (ok) paid += effect.amount;
        }
        this.logEvent(`${player.name} paga $${paid} a los demás jugadores.`, "bad");
        break;
      }
      default:
        break;
    }
  }

  async landOnOwnable(player, s, diceTotal) {
    const owner = this.players.find((p) => p.properties.includes(s.i));
    if (!owner) {
      await this.offerPurchase(player, s);
      return;
    }
    if (owner === player) {
      this.logEvent(`${player.name} cae en su propia propiedad (${s.name}).`, "info");
      return;
    }
    if (s.mortgaged) {
      this.logEvent(`${s.name} está hipotecada: no se paga alquiler.`, "info");
      return;
    }
    const rent = this.calcRent(s, owner, diceTotal);
    this.logEvent(`${player.name} paga $${rent} de alquiler a ${owner.name} por ${s.name}.`, "bad");
    this.toast(`Alquiler de $${rent} por ${s.name}`);
    await this.charge(player, rent, owner, `alquiler de ${s.name}`);
  }

  calcRent(s, owner, diceTotal) {
    if (s.type === "property") {
      const h = this.houses(s.i);
      if (h > 0) return s.rent[h];
      const base = s.rent[0];
      return this.ownsGroup(owner, s.group) ? base * 2 : base;
    }
    if (s.type === "railroad") {
      const count = owner.properties.filter((i) => this.space(i).type === "railroad").length;
      return RAILROAD_RENTS[Math.min(count, 4) - 1] ?? 25;
    }
    return 0;
  }

  // ---------- compra y subasta ----------
  async offerPurchase(player, s) {
    if (player.money < s.price) {
      this.logEvent(`${player.name} no puede pagar ${s.name} ($${s.price}).`, "info");
      await this.auction(s);
      return;
    }
    let wants = false;
    if (player.isAI) {
      await this.pause(400);
      wants = this.aiWantsProperty(player, s);
    } else {
      const answer = await this.ask({
        type: "buy",
        player,
        space: s,
        text: `¿Comprar ${s.name} por $${s.price}?`,
        options: [
          { value: "buy", label: `Comprar por $${s.price}` },
          { value: "pass", label: "No comprar (se subasta)" },
        ],
      });
      wants = answer === "buy";
    }
    if (wants) {
      this.transfer(player, null, s.price);
      this.grantProperty(player, s.i);
      this.logEvent(`${player.name} compra ${s.name} por $${s.price}.`, "good");
      this.toast(`${player.name} compra ${s.name}`);
    } else {
      await this.auction(s);
    }
  }

  grantProperty(player, index) {
    if (!player.properties.includes(index)) player.properties.push(index);
    this.emit("update");
  }

  async auction(s) {
    const participants = this.activePlayers().filter((p) => p.money > 0);
    if (participants.length === 0) return;
    let bid = 0;
    let highBidder = null;
    let active = [...participants];

    this.emit("auction-start", { space: s, participants: active });

    let round = 0;
    while (active.length > 1 && round < 12) {
      round++;
      for (const p of [...active]) {
        if (active.length <= 1) break;
        let raise = null;
        if (p.isAI) {
          raise = this.aiBid(p, s, bid);
        } else {
          raise = await this.ask({
            type: "auction",
            player: p,
            space: s,
            currentBid: bid,
            highBidder,
            text: `Subasta de ${s.name}. Puja actual: $${bid}${highBidder ? ` (${highBidder.name})` : ""}.`,
            options: this.bidOptions(p, bid),
          });
        }
        if (raise === null || raise === "pass" || raise <= bid || raise > p.money) {
          active = active.filter((x) => x !== p);
          this.emit("auction-update", { space: s, bid, highBidder, active });
          if (highBidder === null && active.length === 1) {
            // el último que queda se lleva la propiedad al precio mínimo
            break;
          }
        } else {
          bid = raise;
          highBidder = p;
          this.emit("auction-update", { space: s, bid, highBidder, active });
        }
      }
    }

    if (highBidder && bid > 0 && bid <= highBidder.money) {
      this.transfer(highBidder, null, bid);
      this.grantProperty(highBidder, s.i);
      this.logEvent(`${highBidder.name} gana la subasta de ${s.name} por $${bid}.`, "good");
      this.toast(`${highBidder.name} gana ${s.name} por $${bid}`);
    } else {
      this.logEvent(`Nadie puja por ${s.name}: queda en el banco.`, "info");
    }
    this.emit("auction-end", { space: s, winner: highBidder, price: bid });
  }

  bidOptions(player, bid) {
    const opts = [];
    for (const inc of [10, 25, 50, 100]) {
      const value = bid + inc;
      if (value <= player.money) opts.push({ value, label: `Subir a $${value}` });
    }
    opts.push({ value: "pass", label: "Retirarse" });
    return opts;
  }

  // ---------- pagos y bancarrota ----------
  async charge(player, amount, creditor, reason) {
    if (amount <= 0) return true;
    if (player.money >= amount) {
      this.transfer(player, creditor || null, amount);
      return true;
    }
    const raised = await this.raiseFunds(player, amount);
    if (raised) {
      this.transfer(player, creditor || null, amount);
      return true;
    }
    this.declareBankrupt(player, creditor);
    return false;
  }

  async raiseFunds(player, amount) {
    if (player.isAI) {
      return this.aiRaiseFunds(player, amount);
    }
    this.emit("need-funds", { player, amount });
    const result = await this.ask({
      type: "funds",
      player,
      amount,
      text: `Necesitas $${amount} y tienes $${player.money}. Hipoteca o vende construcciones para reunir el dinero.`,
      options: [{ value: "bankrupt", label: "Declararme en bancarrota" }],
    });
    if (result === "bankrupt") return false;
    if (player.money >= amount) return true;
    return player.money >= amount;
  }

  aiRaiseFunds(player, amount) {
    let guard = 0;
    while (player.money < amount && guard < 100) {
      guard++;
      const sellable = player.properties
        .filter((i) => this.houses(i) > 0)
        .sort((a, b) => this.houses(b) - this.houses(a));
      if (sellable.length) {
        this.sellHouse(player, sellable[0], true);
        continue;
      }
      const mortgageable = player.properties
        .filter((i) => !this.isMortgaged(i))
        .sort((a, b) => this.space(a).price - this.space(b).price);
      if (mortgageable.length) {
        this.mortgage(player, mortgageable[0], true);
        continue;
      }
      break;
    }
    return player.money >= amount;
  }

  declareBankrupt(player, creditor) {
    player.bankrupt = true;
    this.logEvent(`${player.name} se declara en bancarrota.`, "bad");
    this.toast(`${player.name} queda en bancarrota`);
    const props = [...player.properties];
    for (const idx of props) {
      const s = this.space(idx);
      s.houses = 0;
      if (creditor) {
        this.grantProperty(creditor, idx);
      } else {
        s.mortgaged = false;
      }
    }
    player.properties = [];
    if (creditor) {
      const cash = Math.max(0, player.money);
      this.transfer(player, creditor, cash);
    }
    player.money = 0;
    player.inJail = false;
    this.emit("bankrupt", player);
    this.emit("update");
  }

  async checkGameOver() {
    const alive = this.activePlayers();
    if (alive.length <= 1) {
      this.over = true;
      this.phase = "over";
      const winner = alive[0] || null;
      if (winner) this.logEvent(`¡${winner.name} gana la partida!`, "good");
      const reparto = this.payout();
      if (reparto.total > 0) {
        this.logEvent(
          `Reparto del bote: $${reparto.winner} al ganador (60%) y $${reparto.house} a la casa (40%).`,
          "info"
        );
      }
      this.emit("gameover", { winner, payout: reparto });
      this.emit("phase", this.phase);
    }
  }

  // ---------- construcción e hipotecas ----------
  canBuild(player, index) {
    const s = this.space(index);
    if (s.type !== "property" || !player.properties.includes(index)) return false;
    if (!this.ownsGroup(player, s.group)) return false;
    const group = groupProperties(s.group);
    if (group.some((g) => g.mortgaged)) return false;
    const h = this.houses(index);
    if (h >= 5) return false;
    const minHouses = Math.min(...group.map((g) => this.houses(g.i)));
    if (h > minHouses) return false;
    return player.money >= s.houseCost;
  }

  buildHouse(player, index) {
    if (!this.canBuild(player, index)) return false;
    const s = this.space(index);
    this.transfer(player, null, s.houseCost);
    s.houses = this.houses(index) + 1;
    this.logEvent(
      `${player.name} construye ${s.houses === 5 ? "un hotel" : `una casa (${s.houses})`} en ${s.name}.`,
      "info"
    );
    this.emit("update");
    return true;
  }

  canSellHouse(player, index) {
    const s = this.space(index);
    if (s.type !== "property" || !player.properties.includes(index)) return false;
    const h = this.houses(index);
    if (h <= 0) return false;
    const group = groupProperties(s.group);
    const maxHouses = Math.max(...group.map((g) => this.houses(g.i)));
    return h >= maxHouses;
  }

  sellHouse(player, index, silent) {
    if (!this.canSellHouse(player, index)) return false;
    const s = this.space(index);
    s.houses--;
    const refund = Math.floor(s.houseCost / 2);
    this.addMoney(player, refund);
    if (!silent) {
      this.logEvent(`${player.name} vende una construcción en ${s.name} por $${refund}.`, "info");
    }
    this.emit("update");
    return true;
  }

  canMortgage(player, index) {
    const s = this.space(index);
    if (s.type === "go" || s.type === "jail" || s.type === "parking" || s.type === "gotojail") return false;
    if (s.type === "tax" || s.type === "chance" || s.type === "chest") return false;
    if (!player.properties.includes(index)) return false;
    if (s.mortgaged) return false;
    if (s.type === "property" && groupProperties(s.group).some((g) => this.houses(g.i) > 0)) return false;
    return true;
  }

  mortgage(player, index, silent) {
    if (!this.canMortgage(player, index)) return false;
    const s = this.space(index);
    const value = Math.floor(s.price / 2);
    s.mortgaged = true;
    this.addMoney(player, value);
    if (!silent) this.logEvent(`${player.name} hipoteca ${s.name} por $${value}.`, "info");
    this.emit("update");
    return true;
  }

  unmortgageCost(index) {
    const s = this.space(index);
    return Math.ceil((s.price / 2) * 1.1);
  }

  canUnmortgage(player, index) {
    const s = this.space(index);
    if (!player.properties.includes(index) || !s.mortgaged) return false;
    return player.money >= this.unmortgageCost(index);
  }

  unmortgage(player, index) {
    if (!this.canUnmortgage(player, index)) return false;
    const s = this.space(index);
    const cost = this.unmortgageCost(index);
    this.transfer(player, null, cost);
    s.mortgaged = false;
    this.logEvent(`${player.name} levanta la hipoteca de ${s.name} por $${cost}.`, "info");
    this.emit("update");
    return true;
  }

  netWorth(player) {
    let total = player.money;
    for (const idx of player.properties) {
      const s = this.space(idx);
      total += s.mortgaged ? 0 : Math.floor(s.price / 2);
      total += this.houses(idx) * Math.floor((s.houseCost || 0) / 2);
    }
    return total;
  }
  // ---------- tratos ----------
  canTradeProperty(player, index) {
    if (!player.properties.includes(index)) return false;
    return this.houses(index) === 0;
  }

  // Valor de una propiedad para quien la recibe.
  valueTo(player, index) {
    const s = this.space(index);
    let v = s.price;
    if (s.type === "property") {
      const group = groupProperties(s.group);
      const owned = group.filter((g) => player.properties.includes(g.i)).length;
      if (owned === group.length - 1) v *= 3;
      else if (owned > 0) v *= 1.4;
    } else if (s.type === "railroad") {
      v *= 1 + this.countType(player, "railroad") * 0.35;
    }
    return Math.round(v);
  }

  // Valor de retener una propiedad (lo que cuesta desprenderse de ella).
  holdValue(player, index) {
    const s = this.space(index);
    let v = s.price;
    if (s.type === "property") {
      const group = groupProperties(s.group);
      const owned = group.filter((g) => player.properties.includes(g.i)).length;
      if (owned === group.length) v *= 2.2;
      else if (owned === group.length - 1) v *= 2.8;
      else if (owned > 0) v *= 1.3;
    } else if (s.type === "railroad") {
      v *= 1 + this.countType(player, "railroad") * 0.4;
    }
    return Math.round(v);
  }

  // Ganancia neta para `receiver` si acepta el trato del proponente.
  evaluateTrade(receiver, offer) {
    const receives = (offer.giveProperties || []).reduce((a, i) => a + this.valueTo(receiver, i), 0);
    const gives = (offer.getProperties || []).reduce((a, i) => a + this.holdValue(receiver, i), 0);
    return (offer.giveMoney || 0) + receives - (offer.getMoney || 0) - gives;
  }

  validateTrade(proposer, target, offer) {
    const give = offer.giveProperties || [];
    const get = offer.getProperties || [];
    if (give.length + get.length === 0) return "El trato debe incluir al menos una propiedad";
    for (const i of give) {
      if (!this.canTradeProperty(proposer, i)) return `${proposer.name} no puede entregar ${this.space(i).name}`;
    }
    for (const i of get) {
      if (!this.canTradeProperty(target, i)) return `${target.name} no puede entregar ${this.space(i).name}`;
    }
    if ((offer.giveMoney || 0) > proposer.money) return `${proposer.name} no tiene suficiente efectivo`;
    if ((offer.getMoney || 0) > target.money) return `${target.name} no tiene suficiente efectivo`;
    return null;
  }

  transferProperty(from, to, index) {
    from.properties = from.properties.filter((i) => i !== index);
    this.grantProperty(to, index);
  }

  async proposeTrade(proposer, target, offer) {
    const error = this.validateTrade(proposer, target, offer);
    if (error) {
      this.toast(error);
      return false;
    }
    let accepted = false;
    if (target.isAI) {
      accepted = this.evaluateTrade(target, offer) >= 0;
      await this.pause(300);
    } else {
      const answer = await this.ask({
        type: "trade-offer",
        player: target,
        proposer,
        offer,
        text: `${proposer.name} te propone un trato.`,
        options: [
          { value: "accept", label: "Aceptar" },
          { value: "reject", label: "Rechazar" },
        ],
      });
      accepted = answer === "accept";
    }
    if (!accepted) {
      this.logEvent(`${target.name} rechaza el trato de ${proposer.name}.`, "info");
      return false;
    }
    this.applyTrade(proposer, target, offer);
    return true;
  }

  // Aplica un trato ya aceptado.
  applyTrade(proposer, target, offer) {
    for (const i of offer.giveProperties || []) this.transferProperty(proposer, target, i);
    for (const i of offer.getProperties || []) this.transferProperty(target, proposer, i);
    if (offer.giveMoney) this.transfer(proposer, target, offer.giveMoney);
    if (offer.getMoney) this.transfer(target, proposer, offer.getMoney);
    this.logEvent(`${target.name} acepta el trato de ${proposer.name}.`, "good");
    this.toast("¡Trato cerrado!");
    this.emit("update");
  }



  // ---------- IA ----------
  aiWantsProperty(player, s) {
    if (player.money < s.price) return false;
    const reserve = Math.max(80, player.money * 0.15);
    if (player.money - s.price < reserve) {
      // aun así compra si completa grupo y es barato
      if (!(s.type === "property" && this.ownsGroupExcept(player, s))) return false;
    }
    if (s.type === "property") {
      if (this.ownsGroupExcept(player, s)) return true;
      const group = groupProperties(s.group);
      const owned = group.filter((g) => player.properties.includes(g.i)).length;
      return owned >= 1 || s.price <= 160;
    }
    return true;
  }

  ownsGroupExcept(player, s) {
    const group = groupProperties(s.group);
    return group.filter((g) => g.i !== s.i).every((g) => player.properties.includes(g.i));
  }

  aiBid(player, s, currentBid) {
    const base = s.price || 150;
    const maxWilling = Math.floor(Math.min(player.money * 0.7, base * 1.15));
    const next = currentBid + (currentBid < base ? 25 : 10);
    if (next <= maxWilling) return next;
    return "pass";
  }

  // Busca un trato que le complete un grupo y lo propone.
  aiTryTrade(player) {
    for (const group of Object.keys(COLOR_GROUPS)) {
      const props = groupProperties(group);
      const missing = props.filter((s) => !player.properties.includes(s.i));
      if (missing.length !== 1) continue;
      const target = this.players.find(
        (p) => !p.bankrupt && p !== player && p.properties.includes(missing[0].i)
      );
      if (!target) continue;
      const cash = Math.min(Math.round(missing[0].price * 3), player.money - 200);
      if (cash <= 0) continue;
      const offer = { giveProperties: [], giveMoney: cash, getProperties: [missing[0].i], getMoney: 0 };
      if (this.evaluateTrade(target, offer) >= 0) return { target, offer };

      // Si el efectivo no basta, ofrece además una propiedad que le sirva al
      // rival, pero nunca una que ponga en riesgo un monopolio propio.
      const sweetener = player.properties
        .filter((i) => this.canTradeProperty(player, i))
        .filter((i) => {
          const s = this.space(i);
          if (s.type === "property") {
            if (s.group === missing[0].group) return false;
            const group = groupProperties(s.group);
            if (group.some((g) => player.properties.includes(g.i))) return false;
          }
          return true;
        })
        .filter((i) => this.valueTo(target, i) > this.holdValue(player, i))
        .sort((a, b) => this.valueTo(target, b) - this.valueTo(target, a))[0];
      if (sweetener !== undefined) {
        const offer2 = {
          giveProperties: [sweetener],
          giveMoney: Math.round(cash / 2),
          getProperties: [missing[0].i],
          getMoney: 0,
        };
        if (this.evaluateTrade(target, offer2) >= 0 && this.validateTrade(player, target, offer2) === null) {
          return { target, offer: offer2 };
        }
      }
    }
    return null;
  }

  async aiManage(player) {
    // 0. Intenta cerrar un trato que le complete un grupo (con enfriamiento).
    if (this.turnCount - (player.lastTradeTurn ?? -99) > 3) {
      const trade = this.aiTryTrade(player);
      if (trade) {
        player.lastTradeTurn = this.turnCount;
        await this.proposeTrade(player, trade.target, trade.offer);
      }
    }
    // 1. Levanta hipotecas si va sobrado de dinero.
    if (player.money > 500) {
      for (const idx of [...player.properties]) {
        if (this.canUnmortgage(player, idx) && player.money > this.unmortgageCost(idx) + 300) {
          this.unmortgage(player, idx);
        }
      }
    }
    // 2. Construye en sus grupos completos mientras tenga colchón.
    let guard = 0;
    let built = true;
    while (built && guard < 40) {
      guard++;
      built = false;
      const candidates = player.properties
        .filter((idx) => this.canBuild(player, idx) && player.money - this.space(idx).houseCost > 250)
        .sort((a, b) => this.space(b).rent[1] - this.space(a).rent[1]);
      if (candidates.length) {
        if (this.buildHouse(player, candidates[0])) built = true;
      }
    }
  }

  // ---------- serialización ----------
  toJSON() {
    return {
      startMoney: this.startMoney,
      turnCount: this.turnCount,
      over: this.over,
      currentIndex: this.currentIndex,
      players: this.players,
      spaces: BOARD.map((s) => ({
        i: s.i,
        mortgaged: !!s.mortgaged,
        houses: s.houses || 0,
      })),
      log: this.log.slice(-200),
      chanceDeck: this.chanceDeck.map((c) => c.text),
      chestDeck: this.chestDeck.map((c) => c.text),
      pot: this.pot,
      magnateNextTurn: this.magnateNextTurn,
    };
  }

  static fromJSON(data, config = {}) {
    const game = new Game({ players: data.players, startMoney: data.startMoney, ...config });
    game.players = data.players.map((p) => ({ ...p, properties: [...p.properties] }));
    game.turnCount = data.turnCount;
    game.over = data.over;
    game.currentIndex = data.currentIndex;
    game.log = data.log || [];
    if (data.pot) game.pot = { ...game.pot, ...data.pot };
    if (typeof data.magnateNextTurn === "number") game.magnateNextTurn = data.magnateNextTurn;
    for (const saved of data.spaces || []) {
      const s = BOARD[saved.i];
      s.mortgaged = saved.mortgaged;
      s.houses = saved.houses;
    }
    const order = (deck, all) => {
      const byText = new Map(all.map((c) => [c.text, c]));
      const sorted = (deck || []).map((t) => byText.get(t)).filter(Boolean);
      const rest = all.filter((c) => !sorted.includes(c));
      return [...sorted, ...rest];
    };
    game.chanceDeck = order(data.chanceDeck, CHANCE_CARDS);
    game.chestDeck = order(data.chestDeck, CHEST_CARDS);
    return game;
  }
}

export function resetBoardState() {
  for (const s of BOARD) {
    s.mortgaged = false;
    s.houses = 0;
  }
}
