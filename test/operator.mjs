// Pruebas del identificador de cobro del operador.
//   node test/operator.mjs

import { operatorPayout, checkOperatorPayout } from "../server/operator.mjs";

const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// Un identificador realista es válido.
{
  const p = operatorPayout({ OPERATOR_PAYOUT_HANDLE: "taktak38847eb2" });
  assert(p.valid === true, "un identificador normal debería ser válido");
  assert(p.handle === "taktak38847eb2", "el identificador no se conservó");
  assert(p.channel === "airtm", "el canal por defecto debería ser airtm");
  console.log("✓ Identificador de cobro válido");
}

// Vacío no es válido, pero tampoco revienta: se avisa.
{
  const p = operatorPayout({});
  assert(p.valid === false, "sin identificador no debería ser válido");
  const check = checkOperatorPayout({});
  assert(check.ok === false, "sin identificador debería avisar");
  assert(check.problems.some((x) => x.includes("OPERATOR_PAYOUT_HANDLE")), "no explicó qué falta");
  console.log("✓ Sin identificador: se avisa en vez de usarse a ciegas");
}

// Valores peligrosos se rechazan: URL completa, espacios, símbolos, inyección.
{
  const malos = [
    "https://airtm.me/taktak38847eb2",
    "airtm.me/taktak",
    "taktak 38847",
    "taktak/../admin",
    "<script>alert(1)</script>",
    "taktak?redirect=evil.com",
    "taktak&x=1",
    "a",
    "x".repeat(80),
  ];
  for (const m of malos) {
    const p = operatorPayout({ OPERATOR_PAYOUT_HANDLE: m });
    assert(p.valid === false, `debería rechazar: ${JSON.stringify(m)}`);
  }
  console.log("✓ Valores peligrosos rechazados: URL completa, espacios, símbolos, inyección");
}

// El canal se valida.
{
  const check = checkOperatorPayout({ OPERATOR_PAYOUT_HANDLE: "taktak1", OPERATOR_PAYOUT_CHANNEL: "paypal" });
  assert(check.ok === false, "un canal desconocido debería avisar");
  assert(check.problems.some((x) => x.includes("canal")), "no avisó del canal");
  const ok = checkOperatorPayout({ OPERATOR_PAYOUT_HANDLE: "taktak1", OPERATOR_PAYOUT_CHANNEL: "zinli" });
  assert(ok.ok === true, "zinli debería ser un canal válido");
  console.log("✓ Canal validado (airtm y zinli)");
}

// El 10% no necesita transferencia: se queda donde ya está.
// Esta prueba fija la propiedad que evita el error caro.
{
  const { splitPot } = await import("../server/zinli.mjs");
  const casos = [10, 100, 999, 12345];
  for (const pot of casos) {
    const { winner, house } = splitPot(pot);
    assert(winner + house === pot, `el reparto no cuadra para ${pot}`);
    // La casa nunca recibe menos del 10% por redondeo a favor del ganador.
    const diez = Math.floor(pot * 0.1);
    assert(house >= diez, `la casa recibiría ${house} de ${pot}, menos del 10% (${diez})`);
  }
  console.log("✓ El 10% se queda por defecto: no hay transferencia que pueda fallar");
}

console.log("\n✅ Pruebas del cobro del operador superadas");
