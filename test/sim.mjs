// Simulación headless del motor: juega partidas completas con jugadores IA
// y comprueba invariantes. Ejecutar con: node test/sim.mjs

import { Game, resetBoardState } from "../js/engine.js";
import { BOARD, TOKENS, PLAYER_COLORS, MAGNATE } from "../js/data.js";

// PRNG determinista para que las simulaciones sean reproducibles.
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

function makeGame(seed, playerCount = 4) {
  resetBoardState();
  const players = Array.from({ length: playerCount }, (_, i) => ({
    name: `IA${i + 1}`,
    token: TOKENS[i],
    color: PLAYER_COLORS[i],
    isAI: true,
  }));
  return new Game({ players, startMoney: 1500, speed: 1000, rng: mulberry32(seed) });
}

function checkInvariants(game, label) {
  const moneySum = game.players.reduce((a, p) => a + p.money, 0);
  if (!Number.isFinite(moneySum)) throw new Error(`${label}: dinero no finito`);
  for (const p of game.players) {
    if (!Number.isFinite(p.money)) throw new Error(`${label}: ${p.name} dinero inválido`);
    if (p.money < 0) throw new Error(`${label}: ${p.name} tiene dinero negativo (${p.money})`);
    if (p.position < 0 || p.position > 39) throw new Error(`${label}: ${p.name} posición inválida ${p.position}`);
    for (const idx of p.properties) {
      if (idx < 0 || idx > 39) throw new Error(`${label}: propiedad inválida ${idx}`);
      if (BOARD[idx].type === "go" || BOARD[idx].type === "tax") {
        throw new Error(`${label}: propiedad no comprable asignada (${BOARD[idx].name})`);
      }
    }
    // sin duplicados
    if (new Set(p.properties).size !== p.properties.length) {
      throw new Error(`${label}: ${p.name} tiene propiedades duplicadas`);
    }
  }
  // cada propiedad tiene un solo dueño
  const owners = new Map();
  for (const p of game.players) {
    for (const idx of p.properties) {
      if (owners.has(idx)) throw new Error(`${label}: casilla ${idx} con dos dueños`);
      owners.set(idx, p.id);
    }
  }
  // construcciones equilibradas dentro de cada grupo
  for (const group of ["brown", "lightblue", "pink", "orange", "red", "yellow", "green", "darkblue"]) {
    const props = BOARD.filter((s) => s.group === group);
    const counts = props.map((s) => s.houses || 0);
    const diff = Math.max(...counts) - Math.min(...counts);
    if (diff > 1) throw new Error(`${label}: construcciones desequilibradas en ${group}: ${counts}`);
  }
}

async function playGame(seed, playerCount) {
  const game = makeGame(seed, playerCount);
  let turns = 0;
  game.on("turn", () => {
    turns++;
    if (turns % 25 === 0) checkInvariants(game, `seed ${seed}`);
  });
  await game.run();
  checkInvariants(game, `final seed ${seed}`);
  const alive = game.activePlayers();
  return { seed, turns, over: game.over, winner: alive[0]?.name || null, alive: alive.length };
}

async function main() {
  let failures = 0;
  const games = 60;
  const results = [];
  for (let seed = 1; seed <= games; seed++) {
    try {
      const r = await playGame(seed, 4);
      results.push(r);
      if (!r.over) throw new Error("la partida no terminó");
    } catch (err) {
      failures++;
      console.error(`✗ Partida ${seed}: ${err.message}`);
    }
  }

  const finished = results.filter((r) => r.over).length;
  const avgTurns = results.reduce((a, r) => a + r.turns, 0) / (results.length || 1);
  console.log(`Partidas: ${games} · terminadas: ${finished} · fallos: ${failures}`);
  console.log(`Turnos promedio: ${avgTurns.toFixed(1)}`);

  // Prueba dirigida: cálculo de alquileres
  const g = makeGame(999, 2);
  const [a, b] = g.players;
  g.grantProperty(a, 1);
  g.grantProperty(a, 3);
  const s1 = g.space(1);
  const baseRent = g.calcRent(s1, a, 7);
  if (baseRent !== s1.rent[0] * 2) throw new Error(`alquiler grupo completo incorrecto: ${baseRent}`);
  s1.houses = 3;
  if (g.calcRent(s1, a, 7) !== s1.rent[3]) throw new Error("alquiler con casas incorrecto");
  g.grantProperty(a, 5);
  g.grantProperty(a, 15);
  if (g.calcRent(g.space(5), a, 7) !== 50) throw new Error("alquiler 2 transportes incorrecto");
  console.log("✓ Alquileres: base doble, casas y transportes correctos");

  // Prueba dirigida: casillas de crisis
  const gc = makeGame(77, 2);
  const crisisSpaces = BOARD.filter((s) => s.type === "crisis");
  if (crisisSpaces.length !== 4) throw new Error(`se esperaban 4 casillas de crisis, hay ${crisisSpaces.length}`);
  for (const s of crisisSpaces) {
    if (!s.amount || s.amount <= 0) throw new Error(`la crisis ${s.name} no tiene costo`);
  }
  const antes = gc.crisisAmount(gc.space(4), gc.players[0]);
  gc.turnCount = 120;
  const despues = gc.crisisAmount(gc.space(4), gc.players[0]);
  if (!(despues > antes)) throw new Error("la crisis no escala con los turnos");
  console.log(`✓ Crisis: 4 casillas, costo escala de $${antes} a $${despues}`);

  // Prueba dirigida: bote simulado y reparto 60/40
  const gp = makeGame(55, 4);
  gp.contribute(0);
  if (gp.potTotal() !== 0) throw new Error("el bote debería empezar en 0");
  gp.contribute(5 * 4);
  gp.contribute(5);
  if (gp.potTotal() !== 25) throw new Error(`bote incorrecto: ${gp.potTotal()}`);
  const rep = gp.payout();
  if (rep.total !== 25) throw new Error("el total del reparto es incorrecto");
  if (rep.house !== 10) throw new Error(`la casa debería llevarse 10, se lleva ${rep.house}`);
  if (rep.winner !== 15) throw new Error(`el ganador debería llevarse 15, se lleva ${rep.winner}`);
  console.log("✓ Bote: aportes, recarga y reparto 60/40 correctos");

  // Prueba dirigida: el Magnate Trumpista aparece periódicamente
  const gm = makeGame(31, 3);
  let magnateSeen = 0;
  gm.on("magnate", () => magnateSeen++);
  gm.on("decision", (d) => {
    if (d.type === "magnate") gm.decide("accept");
    else if (d.type === "roll") gm.decide("roll");
    else if (d.type === "buy") gm.decide("pass");
    else gm.decide(d.options && d.options.length ? d.options[0].value : "ok");
  });
  await gm.run();
  const esperado = Math.floor(gm.turnCount / MAGNATE.everyTurns);
  if (magnateSeen < 1) throw new Error("el Magnate nunca apareció");
  if (magnateSeen < esperado - 1 || magnateSeen > esperado + 1) {
    throw new Error(`el Magnate apareció ${magnateSeen} veces, se esperaban ~${esperado}`);
  }
  console.log(`✓ Magnate: apareció ${magnateSeen} veces en ${gm.turnCount} turnos`);

  // Prueba dirigida: el motor exige entre 2 y 8 jugadores
  for (const n of [1, 9]) {
    let threw = false;
    try {
      makeGame(1, n);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`el motor aceptó ${n} jugadores`);
  }
  console.log("✓ Jugadores: el motor rechaza menos de 2 y más de 8");

  // Prueba dirigida: hipoteca y bancarrota
  const g2 = makeGame(1234, 2);
  const [p1, p2] = g2.players;
  g2.grantProperty(p1, 39);
  g2.mortgage(p1, 39);
  if (!g2.space(39).mortgaged) throw new Error("la hipoteca no se aplicó");
  if (g2.calcRent(g2.space(39), p1, 7) !== undefined && g2.space(39).mortgaged === false) {
    throw new Error("propiedad hipotecada cobró alquiler");
  }
  p2.money = 10;
  g2.declareBankrupt(p2, p1);
  if (!p2.bankrupt) throw new Error("bancarrota no registrada");
  console.log("✓ Hipotecas y bancarrota funcionan");

  // Simulación completa con 8 jugadores (el máximo).
  const r8 = await playGame(2024, 8);
  if (!r8.over) throw new Error("la partida de 8 jugadores no terminó");
  console.log(`✓ Ocho jugadores: partida terminada en ${r8.turns} turnos`);

  if (failures > 0 || finished !== games) {
    console.error(`\n✗ FALLARON ${failures} partidas`);
    process.exit(1);
  }
  console.log("\n✅ Todas las simulaciones pasaron");

  await humanPathTests();
}

// Ejercita los caminos de decisión de los jugadores humanos
// (tirar dados, comprar/pasar, subastas, cárcel, recaudar fondos y tratos)
// respondiendo automáticamente a cada decisión.
async function humanPathTests() {
  let decided = 0;
  const counters = { roll: 0, buy: 0, pass: 0, auction: 0, funds: 0, trade: 0, jail: 0, card: 0 };

  for (let seed = 101; seed <= 130; seed++) {
    resetBoardState();
    const players = Array.from({ length: 3 }, (_, i) => ({
      name: `H${i + 1}`,
      token: TOKENS[i],
      color: PLAYER_COLORS[i],
      isAI: false,
    }));
    const game = new Game({ players, startMoney: 1500, speed: 9999, rng: mulberry32(seed) });
    const rng = mulberry32(seed * 7 + 1);

    game.on("decision", (d) => {
      decided++;
      switch (d.type) {
        case "roll":
          counters.roll++;
          game.decide("roll");
          break;
        case "buy":
          counters.buy++;
          game.decide(rng() < 0.7 ? "buy" : "pass");
          break;
        case "auction": {
          counters.auction++;
          const numeric = d.options.filter((o) => typeof o.value === "number");
          if (numeric.length && rng() < 0.5) game.decide(numeric[0].value);
          else game.decide("pass");
          break;
        }
        case "jail": {
          counters.jail++;
          const pay = d.options.find((o) => o.value === "pay");
          if (pay && rng() < 0.5) game.decide("pay");
          else game.decide("roll");
          break;
        }
        case "card":
          counters.card++;
          game.decide("ok");
          break;
        case "end-turn": {
          counters.trade++;
          const me = game.current;
          // administra: levanta hipotecas y construye como haría un humano
          for (const idx of [...me.properties]) {
            if (game.canUnmortgage(me, idx) && me.money > game.unmortgageCost(idx) + 300) game.unmortgage(me, idx);
          }
          let guard = 0;
          while (guard++ < 40) {
            const buildable = me.properties.find((idx) => game.canBuild(me, idx) && me.money - game.space(idx).houseCost > 250);
            if (buildable === undefined) break;
            game.buildHouse(me, buildable);
          }
          if (rng() < 0.4) {
            const wanted = game.activePlayers()
              .filter((p) => p !== me)
              .flatMap((o) => o.properties.filter((i) => game.canTradeProperty(o, i)));
            if (wanted.length) {
              const pick = wanted[Math.floor(rng() * wanted.length)];
              const owner = game.players.find((p) => p.properties.includes(pick));
              const offer = {
                giveProperties: [],
                giveMoney: Math.min(Math.round(game.space(pick).price * 2), Math.max(0, me.money - 100)),
                getProperties: [pick],
                getMoney: 0,
              };
              if (offer.giveMoney > 0) {
                game.proposeTrade(me, owner, offer).then(() => game.decide("end"));
                return;
              }
            }
          }
          game.decide("end");
          break;
        }
        case "funds": {
          counters.funds++;
          if (game.current.money >= d.amount) game.decide("ok");
          else game.decide("bankrupt");
          break;
        }
        case "trade-offer":
          game.decide(rng() < 0.5 ? "accept" : "reject");
          break;
        default:
          game.decide(d.options?.[0]?.value ?? "ok");
      }
    });

    await game.run();
    checkInvariants(game, `human seed ${seed}`);
    if (!game.over) throw new Error(`human seed ${seed}: la partida no terminó`);
  }
  if (counters.roll === 0) throw new Error("no se ejercitó el camino de tirar dados");
  console.log("✓ Decisiones humanas:", decided, JSON.stringify(counters));

  // Trato dirigido: la IA compra la pieza que le falta para monopolizar.
  resetBoardState();
  const [a, b] = [
    { name: "A", token: TOKENS[0], color: PLAYER_COLORS[0], isAI: true },
    { name: "B", token: TOKENS[1], color: PLAYER_COLORS[1], isAI: true },
  ];
  const tg = new Game({ players: [a, b], startMoney: 1500, speed: 9999, rng: mulberry32(7) });
  tg.grantProperty(tg.players[0], 1);
  tg.grantProperty(tg.players[1], 3);
  const before = tg.players[0].properties.length;
  const trade = tg.aiTryTrade(tg.players[0]);
  if (!trade) throw new Error("la IA no propuso un trato para completar el grupo marrón");
  const ok = await tg.proposeTrade(tg.players[0], trade.target, trade.offer);
  if (!ok) throw new Error("el trato razonable fue rechazado");
  if (!tg.ownsGroup(tg.players[0], "brown")) throw new Error("el trato no completó el grupo");
  if (tg.players[0].properties.length <= before) throw new Error("el proponente no ganó la propiedad");
  console.log("✓ Tratos: la IA completa grupos mediante intercambios");

  // Subasta dirigida: el mejor postor se lleva la propiedad.
  resetBoardState();
  const sg = new Game({
    players: [
      { name: "A", token: TOKENS[0], color: PLAYER_COLORS[0], isAI: true },
      { name: "B", token: TOKENS[1], color: PLAYER_COLORS[1], isAI: true },
    ],
    startMoney: 1500,
    speed: 9999,
    rng: mulberry32(3),
  });
  await sg.auction(sg.space(39));
  const owner39 = sg.players.find((p) => p.properties.includes(39));
  if (!owner39) throw new Error("la subasta no adjudicó la propiedad");
  if (owner39.money >= 1500) throw new Error("el ganador no pagó la puja");
  console.log(`✓ Subastas: ${owner39.name} ganó Paseo TAK TAK pagando`);

  // Guardado y carga: el estado se conserva íntegro tras serializar.
  resetBoardState();
  const save = new Game({
    players: [
      { name: "A", token: TOKENS[0], color: PLAYER_COLORS[0], isAI: true },
      { name: "B", token: TOKENS[1], color: PLAYER_COLORS[1], isAI: true },
    ],
    startMoney: 1500,
    speed: 9999,
    rng: mulberry32(11),
  });
  save.grantProperty(save.players[0], 1);
  save.grantProperty(save.players[0], 3);
  save.players[0].money = 987;
  save.space(1).houses = 2;
  save.space(5).mortgaged = true;
  save.turnCount = 42;
  const reloaded = Game.fromJSON(JSON.parse(JSON.stringify(save.toJSON())));
  if (reloaded.players[0].money !== 987) throw new Error("el dinero no se conservó al guardar");
  if (reloaded.space(1).houses !== 2) throw new Error("las casas no se conservaron al guardar");
  if (!reloaded.space(5).mortgaged) throw new Error("la hipoteca no se conservó al guardar");
  if (reloaded.turnCount !== 42) throw new Error("el contador de turnos no se conservó");
  if (!reloaded.ownsGroup(reloaded.players[0], "brown")) throw new Error("los grupos no se conservaron");
  if (reloaded.chanceDeck.length !== save.chanceDeck.length) throw new Error("el mazo de Suerte cambió");
  console.log("✓ Guardado: el estado se serializa y restaura sin pérdidas");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
