// Prueba del flujo de partida con entrada, contra un PostgreSQL real.
//
// Lo que se comprueba, en este orden:
//   1. Abrir una partida aparta la entrada del anfitrión.
//   2. Cerrarla paga de la custodia: nunca más de lo que se guardó.
//   3. Ganar no multiplica el dinero y perder lo entrega entero.
//   4. Los ataques del cliente fallan: inflar el bote, ganar sin ser
//      participante y cerrar dos veces.
//   5. Cancelar devuelve la entrada.
//
// Requiere DATABASE_URL. Sin ella la prueba se salta, no falla.

import assert from "node:assert/strict";
import { createPool, migrate, LedgerRepository } from "../server/ledger.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("test/rounds.mjs: sin DATABASE_URL, se salta");
  process.exit(0);
}

const pool = createPool({ connectionString: url, max: 4 });
await migrate(pool);

const projectId = `rounds_${Date.now()}`;
const ledger = new LedgerRepository(pool, { projectId, assetId: "MTC" });

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

// Da monedas al usuario emitiéndolas contra el ingreso, igual que una compra.
const fund = (userId, coins) =>
  ledger.mintCoins({ orderId: `fund:${userId}:${coins}`, userId, coins });

console.log("\npartidas con entrada");

// ---------- 1. Abrir aparta la entrada ----------
const host = `host_${Date.now()}`;
await fund(host, 1000);

const opened = await ledger.openRound({
  hostUserId: host,
  buyIn: 100,
  maxPlayers: 3,
  winnerSharePct: 60,
  roundId: `r_${Date.now()}`,
});

await check("abrir la partida aparta la entrada y anuncia el premio real", async () => {
  // El premio sale de la entrada guardada (100), no del bote nominal (300).
  assert.equal(opened.entry, "100", "la custodia es la entrada del anfitrión");
  assert.equal(opened.winnerCredit, "60", "el 60% de 100 es 60");
  assert.equal(opened.rake, "40", "la casa se queda el 40%");
});

await check("la entrada apartada no se puede gastar dos veces", async () => {
  // Disponible = saldo - apartado. Con 1000 y 100 apartados, quedan 900.
  await assert.rejects(
    () =>
      ledger.openRound({
        hostUserId: host,
        buyIn: 1000,
        maxPlayers: 2,
        winnerSharePct: 60,
        roundId: `r2_${Date.now()}`,
      }),
    (err) => err.code === "INSUFFICIENT_FUNDS"
  );
});

// ---------- 2. Cerrar paga de la custodia ----------
await check("ganar devuelve la entrada menos la comisión", async () => {
  const settled = await ledger.settleRound({
    roundId: opened.round.id,
    winnerUserId: host,
    players: 3,
    won: true,
  });
  assert.equal(settled.entry, "100");
  assert.equal(settled.credit, "60");
  assert.equal(settled.rake, "40");
  // Pagó 100 y recibe 60: su saldo baja 40, que es la comisión.
  const after = await ledger.userBalance(host);
  assert.equal(Number(after), 960, `esperaba 960, hay ${after}`);
});

await check("cerrar dos veces no paga dos veces", async () => {
  await assert.rejects(
    () => ledger.settleRound({ roundId: opened.round.id, winnerUserId: host, players: 3, won: true }),
    (err) => err.code === "ROUND_CLOSED"
  );
  assert.equal(Number(await ledger.userBalance(host)), 960);
});

await check("perder entrega la entrada entera", async () => {
  const loser = `loser_${Date.now()}`;
  await fund(loser, 1000);
  const round = await ledger.openRound({
    hostUserId: loser,
    buyIn: 100,
    maxPlayers: 3,
    winnerSharePct: 60,
    roundId: `r_loss_${Date.now()}`,
  });
  const settled = await ledger.settleRound({
    roundId: round.round.id,
    winnerUserId: loser,
    players: 3,
    won: false,
  });
  assert.equal(settled.credit, "0", "al perder no se devuelve nada");
  assert.equal(settled.rake, "100", "todo va a la casa");
  assert.equal(Number(await ledger.userBalance(loser)), 900, "pierde los 100 de la entrada");
});

// ---------- 3. Ataques del cliente ----------
await check("inflar el bote desde el cliente no sirve", async () => {
  // El ataque clásico: mandar 8 jugadores en una partida de 2.
  const victim = `victim_${Date.now()}`;
  await fund(victim, 1000);
  const round = await ledger.openRound({
    hostUserId: victim,
    buyIn: 50,
    maxPlayers: 2,
    winnerSharePct: 60,
    roundId: `r3_${Date.now()}`,
  });
  await assert.rejects(
    () => ledger.settleRound({ roundId: round.round.id, winnerUserId: victim, players: 8, won: true }),
    (err) => err.code === "TOO_MANY_PLAYERS"
  );
  assert.equal(Number(await ledger.userBalance(victim)), 1000, "el saldo no debe cambiar");
});

await check("ganar sin ser el anfitrión no sirve", async () => {
  const a = `a_${Date.now()}`;
  const b = `b_${Date.now()}`;
  await fund(a, 1000);
  await fund(b, 1000);
  const round = await ledger.openRound({
    hostUserId: a,
    buyIn: 50,
    maxPlayers: 2,
    winnerSharePct: 60,
    roundId: `r4_${Date.now()}`,
  });
  await assert.rejects(
    () => ledger.settleRound({ roundId: round.round.id, winnerUserId: b, players: 2, won: true }),
    (err) => err.code === "WINNER_NOT_PARTICIPANT"
  );
});

await check("el resultado debe ser explícito", async () => {
  const c = `c_${Date.now()}`;
  await fund(c, 1000);
  const round = await ledger.openRound({
    hostUserId: c,
    buyIn: 50,
    maxPlayers: 2,
    winnerSharePct: 60,
    roundId: `r5_${Date.now()}`,
  });
  await assert.rejects(
    () => ledger.settleRound({ roundId: round.round.id, winnerUserId: c, players: 2 }),
    (err) => err.code === "BAD_OUTCOME"
  );
});

await check("no se puede abrir una partida sin saldo", async () => {
  await assert.rejects(
    () =>
      ledger.openRound({
        hostUserId: `broke_${Date.now()}`,
        buyIn: 100,
        maxPlayers: 2,
        winnerSharePct: 60,
        roundId: `r6_${Date.now()}`,
      }),
    (err) => err.code === "INSUFFICIENT_FUNDS"
  );
});

await check("la entrada debe ser mayor que cero", async () => {
  await assert.rejects(
    () => ledger.openRound({ hostUserId: host, buyIn: 0, maxPlayers: 2, winnerSharePct: 60 }),
    (err) => err.code === "BAD_BUY_IN"
  );
});

await check("el reparto debe estar entre 0 y 100", async () => {
  await assert.rejects(
    () => ledger.openRound({ hostUserId: host, buyIn: 10, maxPlayers: 2, winnerSharePct: 150 }),
    (err) => err.code === "BAD_SHARE"
  );
});

// ---------- 4. Cancelar devuelve la entrada ----------
await check("cancelar devuelve la entrada", async () => {
  const c = `cancel_${Date.now()}`;
  await fund(c, 1000);
  const round = await ledger.openRound({
    hostUserId: c,
    buyIn: 200,
    maxPlayers: 2,
    winnerSharePct: 60,
    roundId: `r7_${Date.now()}`,
  });
  await ledger.cancelRound({ roundId: round.round.id });
  // Al liberar la reserva, el disponible vuelve a ser 1000.
  const again = await ledger.openRound({
    hostUserId: c,
    buyIn: 1000,
    maxPlayers: 2,
    winnerSharePct: 60,
    roundId: `r8_${Date.now()}`,
  });
  assert.equal(again.entry, "1000", "debe poder usar todo su saldo otra vez");
});

// ---------- 5. El dinero no se crea de la nada ----------
await check("cerrar 100 partidas no crea monedas", async () => {
  // La comprobación más importante: jugar muchas veces no debe aumentar el
  // dinero del sistema. Si el reparto pagara del bote nominal, el saldo
  // crecería sin límite con cada partida ganada.
  const grinder = `grinder_${Date.now()}`;
  await fund(grinder, 1000);
  let spent = 0;
  for (let i = 0; i < 100; i++) {
    const r = await ledger.openRound({
      hostUserId: grinder,
      buyIn: 10,
      maxPlayers: 2,
      winnerSharePct: 60,
      roundId: `grind_${Date.now()}_${i}`,
    });
    await ledger.settleRound({
      roundId: r.round.id,
      winnerUserId: grinder,
      players: 2,
      won: true,
    });
    spent += 4; // pierde el 40% de 10 en cada partida
  }
  const after = Number(await ledger.userBalance(grinder));
  assert.equal(after, 1000 - spent, `esperaba ${1000 - spent}, hay ${after}`);
});

await check("el libro sigue cuadrando a cero", async () => {
  const rec = await ledger.reconcile();
  assert.equal(rec.ok, true, `el libro no cuadra: ${rec.difference}`);
});

await ledger.close();
console.log(`\n${passed} pasan, ${failed} fallan\n`);
process.exit(failed === 0 ? 0 : 1);
