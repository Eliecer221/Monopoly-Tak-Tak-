// Definición del tablero de Monopoly TAK TAK.
// 40 casillas en el orden clásico: salida en la esquina inferior derecha,
// recorrido en sentido antihorario.
//
// Temática: Venezuela. Las propiedades son empresas, servicios y ministerios
// reales; las casillas de crisis representan apagones, escasez y el mercado
// cambiario. Todo es sátira y no constituye asesoría de ningún tipo.

export const COLOR_GROUPS = {
  brown: { name: "Barrio", color: "#8d5524", size: 2 },
  lightblue: { name: "Alimentos y Servicios", color: "#74c0e8", size: 3 },
  pink: { name: "Agua y Salud", color: "#e7508f", size: 3 },
  orange: { name: "Electricidad y Telecom", color: "#f08a24", size: 3 },
  red: { name: "Industria Pesada", color: "#e0393e", size: 3 },
  yellow: { name: "Cemento", color: "#f2c53d", size: 3 },
  green: { name: "Ministerios", color: "#2f9e5f", size: 3 },
  darkblue: { name: "Petróleo", color: "#2b6cb0", size: 2 },
};

// Alquileres en orden: [base, 1 casa, 2 casas, 3 casas, 4 casas, hotel].
// Los precios y alquileres son los del Monopoly clásico: la partida sigue
// siendo reconocible y equilibrada aunque cambien los nombres.
export const BOARD = [
  { i: 0, type: "go", name: "SALIDA", icon: "➡️", side: "bottom" },

  { i: 1, type: "property", name: "Bodegón de Barrio", group: "brown", price: 60, houseCost: 50,
    rent: [2, 10, 30, 90, 160, 250], side: "bottom" },
  { i: 2, type: "chest", name: "Caja Comunal", icon: "📦", side: "bottom" },
  { i: 3, type: "property", name: "Abastos La Esquina", group: "brown", price: 60, houseCost: 50,
    rent: [4, 20, 60, 180, 320, 450], side: "bottom" },
  { i: 4, type: "crisis", name: "Se va la luz", icon: "🕯️", side: "bottom",
    amount: 100, crisis: "blackout" },
  { i: 5, type: "railroad", name: "Metro de Caracas", price: 200, side: "bottom" },
  { i: 6, type: "property", name: "Lácteos Los Andes", group: "lightblue", price: 100, houseCost: 50,
    rent: [6, 30, 90, 270, 400, 550], side: "bottom" },
  { i: 7, type: "chance", name: "Suerte", icon: "❓", side: "bottom" },
  { i: 8, type: "property", name: "Agroisleña", group: "lightblue", price: 100, houseCost: 50,
    rent: [6, 30, 90, 270, 400, 550], side: "bottom" },
  { i: 9, type: "property", name: "Mercal", group: "lightblue", price: 120, houseCost: 50,
    rent: [8, 40, 100, 300, 450, 600], side: "bottom" },

  { i: 10, type: "jail", name: "CÁRCEL DE HELICOIDES", icon: "🚔", side: "bottom" },

  { i: 11, type: "property", name: "Hidroven", group: "pink", price: 140, houseCost: 100,
    rent: [10, 50, 150, 450, 625, 750], side: "left" },
  { i: 12, type: "crisis", name: "Se va el agua", icon: "🚱", side: "left",
    amount: 75, crisis: "water" },
  { i: 13, type: "property", name: "Hidrocapital", group: "pink", price: 140, houseCost: 100,
    rent: [10, 50, 150, 450, 625, 750], side: "left" },
  { i: 14, type: "property", name: "IVSS", group: "pink", price: 160, houseCost: 100,
    rent: [12, 60, 180, 500, 700, 900], side: "left" },
  { i: 15, type: "railroad", name: "Ferrocarril Ezequiel Zamora", price: 200, side: "left" },
  { i: 16, type: "property", name: "Corpoelec", group: "orange", price: 180, houseCost: 100,
    rent: [14, 70, 200, 550, 750, 950], side: "left" },
  { i: 17, type: "chest", name: "Caja Comunal", icon: "📦", side: "left" },
  { i: 18, type: "property", name: "Electricidad de Caracas", group: "orange", price: 180, houseCost: 100,
    rent: [14, 70, 200, 550, 750, 950], side: "left" },
  { i: 19, type: "property", name: "Cantv", group: "orange", price: 200, houseCost: 100,
    rent: [16, 80, 220, 600, 800, 1000], side: "left" },

  { i: 20, type: "parking", name: "ESTACIONAMIENTO DE EMBAJADAS", icon: "🅿️", side: "left" },

  { i: 21, type: "property", name: "SIDOR", group: "red", price: 220, houseCost: 150,
    rent: [18, 90, 250, 700, 875, 1050], side: "top" },
  { i: 22, type: "chance", name: "Suerte", icon: "❓", side: "top" },
  { i: 23, type: "property", name: "Alcasa", group: "red", price: 220, houseCost: 150,
    rent: [18, 90, 250, 700, 875, 1050], side: "top" },
  { i: 24, type: "property", name: "Ferrominera Orinoco", group: "red", price: 240, houseCost: 150,
    rent: [20, 100, 300, 750, 925, 1100], side: "top" },
  { i: 25, type: "railroad", name: "Puerto de La Guaira", price: 200, side: "top" },
  { i: 26, type: "property", name: "Cementos Progreso", group: "yellow", price: 260, houseCost: 150,
    rent: [22, 110, 330, 800, 975, 1150], side: "top" },
  { i: 27, type: "property", name: "Cemento Andino", group: "yellow", price: 260, houseCost: 150,
    rent: [22, 110, 330, 800, 975, 1150], side: "top" },
  { i: 28, type: "crisis", name: "Marcadores cambiarios", icon: "💱", side: "top",
    amount: 60, crisis: "fx" },
  { i: 29, type: "property", name: "Vencemos Cemento", group: "yellow", price: 280, houseCost: 150,
    rent: [24, 120, 360, 850, 1025, 1200], side: "top" },

  { i: 30, type: "gotojail", name: "IR A LA CÁRCEL", icon: "👮", side: "top" },

  { i: 31, type: "property", name: "Ministerio de Finanzas", group: "green", price: 300, houseCost: 200,
    rent: [26, 130, 390, 900, 1100, 1275], side: "right" },
  { i: 32, type: "property", name: "Ministerio de Energía", group: "green", price: 300, houseCost: 200,
    rent: [26, 130, 390, 900, 1100, 1275], side: "right" },
  { i: 33, type: "chest", name: "Caja Comunal", icon: "📦", side: "right" },
  { i: 34, type: "property", name: "Ministerio de Petróleo", group: "green", price: 320, houseCost: 200,
    rent: [28, 150, 450, 1000, 1200, 1400], side: "right" },
  { i: 35, type: "railroad", name: "Aeropuerto de Maiquetía", price: 200, side: "right" },
  { i: 36, type: "chance", name: "Suerte", icon: "❓", side: "right" },
  { i: 37, type: "property", name: "PDVSA", group: "darkblue", price: 350, houseCost: 200,
    rent: [35, 175, 500, 1100, 1300, 1500], side: "right" },
  { i: 38, type: "crisis", name: "Deuda con trabajadores", icon: "📉", side: "right",
    amount: 150, crisis: "debt" },
  { i: 39, type: "property", name: "Paseo PDVSA Marina", group: "darkblue", price: 400, houseCost: 200,
    rent: [50, 200, 600, 1400, 1700, 2000], side: "right" },
];

export const RAILROAD_RENTS = [25, 50, 100, 200];

// Fichas: animales típicos de Venezuela, una por jugador (hasta 8).
export const TOKENS = ["🐦", "🐆", "🦫", "🐬", "🐻", "🐊", "🦜", "🐒"];

export const TOKEN_NAMES = [
  "Turpial",
  "Jaguar",
  "Chigüire",
  "Tonina",
  "Oso Frontino",
  "Caimán del Orinoco",
  "Guacamaya",
  "Mono Araguato",
];

export const PLAYER_COLORS = [
  "#ffd23f",
  "#ff5f6d",
  "#35d07f",
  "#7c5cff",
  "#f08a24",
  "#4dd0e1",
  "#e7508f",
  "#9ccc65",
];

export const START_MONEY = 1500;
export const GO_REWARD = 200;
export const JAIL_FINE = 50;
export const JAIL_POSITION = 10;

// Textos de las casillas de crisis, para la interfaz y las reglas.
export const CRISIS_TEXT = {
  blackout: "Apagón nacional: se va la luz y toca pagar plantas y velas.",
  water: "Sin agua por semanas: hay que comprar camiones cisterna.",
  fx: "Brecha cambiaria: el dólar BCV no alcanza, se paga al paralelo.",
  debt: "Deuda pública: los trabajadores cobran retroactivos atrasados.",
};

// El Magnate Trumpista: personaje central del juego. Cada cierto número de
// turnos aparece a ofrecer un "deal" que el jugador actual acepta o rechaza.
export const MAGNATE = {
  name: "El Magnate Trumpista",
  icon: "🕶️",
  everyTurns: 12,
  deals: [
    {
      text: "Te ofrezco licencia petrolera a cambio de $200 y una disculpa pública.",
      accept: { kind: "money", amount: -200 },
      acceptText: "Pagas $200 y el magnate sonríe para las cámaras.",
      rejectText: "Rechazas el trato. El magnate amenaza con aranceles.",
    },
    {
      text: "Puedo levantarte las sanciones por $150. ¿Trato hecho?",
      accept: { kind: "money", amount: -150 },
      acceptText: "Pagas $150 y consigues una foto con el magnate.",
      rejectText: "Dices que no. El magnate publica un tuit furioso.",
    },
    {
      text: "Invierto en tu empresa: recibes $300 y yo me llevo el crédito.",
      accept: { kind: "money", amount: 300 },
      acceptText: "Recibes $300 y el magnate cobra la fama.",
      rejectText: "Rechazas la inversión. 'Muy triste', comenta el magnate.",
    },
    {
      text: "Deal del cemento: te compro tu grupo de construcción. Recibes $500.",
      accept: { kind: "money", amount: 500 },
      acceptText: "Vendes al magnate y él construye un muro de $500.",
      rejectText: "Dices que no y el magnate ofrece el doble a tu rival.",
    },
    {
      text: "Redada migratoria: pagas $100 en abogados o pierdes un turno.",
      accept: { kind: "money", amount: -100 },
      acceptText: "Pagas $100 y todo sigue igual.",
      rejectText: "Pierdes el próximo turno entre trámites.",
      rejectLoseTurn: true,
    },
    {
      text: "Remesa sorpresa de un familiar en Miami: recibes $250.",
      accept: { kind: "money", amount: 250 },
      acceptText: "Recibes $250 vía Zelle. El magnate cobra comisión.",
      rejectText: "Rechazas por orgullo y el magnate se queda la comisión.",
    },
  ],
};

export function groupProperties(group) {
  return BOARD.filter((s) => s.type === "property" && s.group === group);
}

export function spaceColor(space) {
  if (space.type === "property") return COLOR_GROUPS[space.group].color;
  if (space.type === "railroad") return "#6b7280";
  if (space.type === "crisis") return "#ff5f6d";
  return "#334155";
}

export const AI_NAMES = [
  "TAK-Bot",
  "Taki",
  "Señor TAK",
  "Doña TAK",
  "Capitán TAK",
  "La TAK",
  "El Chigüire",
];
