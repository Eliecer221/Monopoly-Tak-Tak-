// Cartas de Suerte y Caja Comunal de Monopoly TAK TAK.
// 16 de cada mazo, con eventos satíricos inspirados en la realidad reciente
// de Venezuela. Es humor político; no es información periodística.
//
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
  { text: "¡Sale Maduro! Se despeja el camino: avanzas hasta PDVSA.", effect: { kind: "move", to: 37, passGo: true } },
  { text: "Operación del 3 de enero: te llevan detenido sin avisar. Vas a la cárcel.", effect: { kind: "jail" } },
  { text: "Delcy Rodríguez asume como presidenta interina: cobras $200 de 'gestión'.", effect: { kind: "money", amount: 200 } },
  { text: "María Corina Machado vuelve al país: el pueblo celebra y cada rival te paga $50.", effect: { kind: "collectEach", amount: 50 } },
  { text: "Henrique Capriles te da la mano y te presta $75.", effect: { kind: "money", amount: 75 } },
  { text: "Acuerdo petrolero con Estados Unidos: recibes $300 de inversión.", effect: { kind: "money", amount: 300 } },
  { text: "El Magnate Trumpista ofrece un 'deal perfecto': pagas $100 en asesores.", effect: { kind: "money", amount: -100 } },
  { text: "Apagón de 12 horas: pagas $80 por planta eléctrica y velas.", effect: { kind: "money", amount: -80 } },
  { text: "Dólar BCV vs paralelo: la brecha te cuesta $60.", effect: { kind: "money", amount: -60 } },
  { text: "Llegó la remesa: recibes $150 vía Zelle.", effect: { kind: "money", amount: 150 } },
  { text: "Devaluación sorpresa: tu dinero vale menos, pierdes $120.", effect: { kind: "money", amount: -120 } },
  { text: "Escasez de comida: pagas $90 en el mercado del barrio.", effect: { kind: "money", amount: -90 } },
  { text: "Te nombran ministro por un día: cobras $120 y una foto.", effect: { kind: "money", amount: 120 } },
  { text: "La luz vuelve y con ella el internet: avanzas hasta Cantv.", effect: { kind: "move", to: 19, passGo: true } },
  { text: "Carta de salida libre de la cárcel. ¡Guárdala para la próxima!", effect: { kind: "jailfree" } },
  { text: "Te devuelven el IVA de tus compras: recibes $45.", effect: { kind: "money", amount: 45 } },
];

export const CHEST_CARDS = [
  { text: "Caja Comunal: el CLAP llega tarde pero llega. Recibes $100.", effect: { kind: "money", amount: 100 } },
  { text: "Se va el agua otra vez: pagas $70 por un camión cisterna.", effect: { kind: "money", amount: -70 } },
  { text: "Colectivo de vecinos te ayuda: cada rival te aporta $40.", effect: { kind: "collectEach", amount: 40 } },
  { text: "Bonos de la patria: recibes $150 pero nadie sabe en qué moneda.", effect: { kind: "money", amount: 150 } },
  { text: "Deuda pública con trabajadores: pagas $150 de retroactivos.", effect: { kind: "money", amount: -150 } },
  { text: "Remesas récord: tu familia en Miami te envía $200.", effect: { kind: "money", amount: 200 } },
  { text: "Mercado paralelo de divisas: pierdes $80 en la transacción.", effect: { kind: "money", amount: -80 } },
  { text: "Carta de salida libre de la cárcel. ¡Guárdala!", effect: { kind: "jailfree" } },
  { text: "Redada y revisión: vas directo a la cárcel. ¡Sin cobrar salida!", effect: { kind: "jail" } },
  { text: "Corte de luz en el hospital: pagas $110 de emergencia.", effect: { kind: "money", amount: -110 } },
  { text: "Te venden harina a precio de oro: pagas $60.", effect: { kind: "money", amount: -60 } },
  { text: "Reencuentro familiar: recibes $50 y un abrazo en el aeropuerto.", effect: { kind: "money", amount: 50 } },
  { text: "Inversión extranjera en tu zona: recibes $250.", effect: { kind: "money", amount: 250 } },
  { text: "Reparación de tus edificios: pagas $40 por casa y $115 por hotel.", effect: { kind: "repairs", house: 40, hotel: 115 } },
  { text: "Impuesto sorpresa del municipio: paga $90.", effect: { kind: "money", amount: -90 } },
  { text: "Avanzas hasta SALIDA y cobras el bono de $200.", effect: { kind: "move", to: 0, passGo: true } },
];
