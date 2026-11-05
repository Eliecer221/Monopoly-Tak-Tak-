// Cartas de Suerte y Arca Común.
// Cada carta: { text, effect }
// effect puede ser:
//   { kind: "money", amount }        -> suma/resta dinero (amount negativo resta)
//   { kind: "move", to }             -> teletransporta a una casilla (sin cobrar salida)
//   { kind: "move", to, passGo: true } -> avanza hasta la casilla cobrando salida
//   { kind: "jail" }                 -> te lleva a la cárcel
//   { kind: "jailfree" }             -> guarda carta para salir de la cárcel
//   { kind: "back", steps }          -> retrocede N casillas
//   { kind: "repairs", house, hotel} -> paga por casa/hotel
//   { kind: "collectEach", amount }  -> cada rival te paga amount
//   { kind: "payEach", amount }      -> pagas amount a cada rival

export const CHANCE_CARDS = [
  { text: "¡Adelante! Avanza hasta SALIDA y cobra $200.", effect: { kind: "move", to: 0, passGo: true } },
  { text: "Avanzas hasta Paseo TAK TAK. ¡Cuidado!", effect: { kind: "move", to: 39, passGo: true } },
  { text: "Retrocede 3 casillas.", effect: { kind: "back", steps: 3 } },
  { text: "Avanzas hasta Av. TAK.", effect: { kind: "move", to: 1, passGo: true } },
  { text: "El banco te paga dividendos: $50.", effect: { kind: "money", amount: 50 } },
  { text: "Multa por exceso de velocidad: paga $15.", effect: { kind: "money", amount: -15 } },
  { text: "Vas directo a la cárcel. ¡Sin cobrar salida!", effect: { kind: "jail" } },
  { text: "Obras en tus propiedades: paga $25 por casa y $100 por hotel.", effect: { kind: "repairs", house: 25, hotel: 100 } },
  { text: "Ganas un concurso de crucigramas: $100.", effect: { kind: "money", amount: 100 } },
  { text: "Te devuelven impuestos: $20.", effect: { kind: "money", amount: 20 } },
  { text: "Avanzas hasta la Estación Este.", effect: { kind: "move", to: 25, passGo: true } },
  { text: "Tu edificio se revaloriza: recibe $150.", effect: { kind: "money", amount: 150 } },
  { text: "Pagas honorarios médicos: $50.", effect: { kind: "money", amount: -50 } },
  { text: "Avanzas hasta Av. Mitre.", effect: { kind: "move", to: 21, passGo: true } },
  { text: "Carta de salida libre de la cárcel. ¡Guárdala!", effect: { kind: "jailfree" } },
  { text: "Paga la factura del médico: $100.", effect: { kind: "money", amount: -100 } },
];

export const CHEST_CARDS = [
  { text: "¡Error del banco a tu favor! Recibe $200.", effect: { kind: "money", amount: 200 } },
  { text: "Paga gastos de colegio: $50.", effect: { kind: "money", amount: -50 } },
  { text: "Recibe intereses de tu cuenta: $25.", effect: { kind: "money", amount: 25 } },
  { text: "Herencia inesperada: $100.", effect: { kind: "money", amount: 100 } },
  { text: "Impuesto sobre la renta: paga $100.", effect: { kind: "money", amount: -100 } },
  { text: "Ganas un premio de belleza: $10.", effect: { kind: "money", amount: 10 } },
  { text: "Carta de salida libre de la cárcel. ¡Guárdala!", effect: { kind: "jailfree" } },
  { text: "Vas directo a la cárcel. ¡Sin cobrar salida!", effect: { kind: "jail" } },
  { text: "Es tu cumpleaños: cada rival te regala $50.", effect: { kind: "collectEach", amount: 50 } },
  { text: "Seguro de vida vencido: recibe $100.", effect: { kind: "money", amount: 100 } },
  { text: "Pagas gastos de hospital: $100.", effect: { kind: "money", amount: -100 } },
  { text: "Pagas gastos de consultorio: $50.", effect: { kind: "money", amount: -50 } },
  { text: "Ventas en tu tienda: recibe $50.", effect: { kind: "money", amount: 50 } },
  { text: "Reparaciones de tus propiedades: paga $40 por casa y $115 por hotel.", effect: { kind: "repairs", house: 40, hotel: 115 } },
  { text: "Devuelves un préstamo con intereses: $150.", effect: { kind: "money", amount: -150 } },
  { text: "Avanzas hasta SALIDA y cobra $200.", effect: { kind: "move", to: 0, passGo: true } },
];
