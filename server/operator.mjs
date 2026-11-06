// Identificador de cobro del operador.
//
// Es la dirección pública donde el operador recibe su parte. NO es un secreto:
// se muestra al pagador, como un número de cuenta. Nunca metas aquí
// contraseñas, tokens ni claves.
//
// Ojo con la lógica del 10%: el código NO transfiere la parte de la casa. El
// reparto solo decide cuánto se le paga al ganador; lo que no se paga al ganador
// se queda donde ya estaba, que es la cuenta del operador. Por eso el 10% no
// necesita ninguna transferencia: se queda por defecto.
//
// El riesgo no es cobrar de menos, es pagar de más. Por eso cada retiro lo
// aprueba una persona.

// Un identificador de cobro es alfanumérico con puntos, guiones o guiones bajos.
// No admite espacios ni símbolos de URL, para que no se cuele un enlace con
// parámetros ni un intento de inyección.
const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;

export function operatorPayout(env = process.env) {
  const handle = String(env.OPERATOR_PAYOUT_HANDLE || "").trim();
  const channel = String(env.OPERATOR_PAYOUT_CHANNEL || "airtm").trim();

  return Object.freeze({
    handle,
    channel,
    // Válido solo si tiene forma de identificador. Un valor raro se marca como
    // inválido en vez de usarse a ciegas.
    valid: HANDLE_RE.test(handle),
  });
}

// Comprueba la configuración de cobro y explica qué falta.
export function checkOperatorPayout(env = process.env) {
  const payout = operatorPayout(env);
  const problems = [];
  if (!payout.handle) problems.push("falta OPERATOR_PAYOUT_HANDLE");
  else if (!payout.valid) problems.push("OPERATOR_PAYOUT_HANDLE no tiene forma de identificador");
  if (!["airtm", "zinli"].includes(payout.channel)) {
    problems.push(`canal de cobro desconocido: ${payout.channel}`);
  }
  return { ...payout, ok: problems.length === 0, problems };
}
