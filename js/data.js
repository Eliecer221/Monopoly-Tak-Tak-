// Definición del tablero de Monopoly TAK TAK.
// 40 casillas en el orden clásico: salida en la esquina inferior derecha,
// recorrido en sentido antihorario.

export const COLOR_GROUPS = {
  brown: { name: "Marrón", color: "#8d5524", size: 2 },
  lightblue: { name: "Celeste", color: "#74c0e8", size: 3 },
  pink: { name: "Rosa", color: "#e7508f", size: 3 },
  orange: { name: "Naranja", color: "#f08a24", size: 3 },
  red: { name: "Rojo", color: "#e0393e", size: 3 },
  yellow: { name: "Amarillo", color: "#f2c53d", size: 3 },
  green: { name: "Verde", color: "#2f9e5f", size: 3 },
  darkblue: { name: "Azul", color: "#2b6cb0", size: 2 },
};

// Alquileres en orden: [base, 1 casa, 2 casas, 3 casas, 4 casas, hotel]
export const BOARD = [
  { i: 0, type: "go", name: "SALIDA", icon: "➡️", side: "bottom" },

  { i: 1, type: "property", name: "Av. TAK", group: "brown", price: 60, houseCost: 50,
    rent: [2, 10, 30, 90, 160, 250], side: "bottom" },
  { i: 2, type: "chest", name: "Arca Común", icon: "📦", side: "bottom" },
  { i: 3, type: "property", name: "Av. TAK TAK", group: "brown", price: 60, houseCost: 50,
    rent: [4, 20, 60, 180, 320, 450], side: "bottom" },
  { i: 4, type: "tax", name: "Impuesto", amount: 200, icon: "💸", side: "bottom" },
  { i: 5, type: "railroad", name: "Estación Norte", price: 200, side: "bottom" },
  { i: 6, type: "property", name: "Av. Rivoli", group: "lightblue", price: 100, houseCost: 50,
    rent: [6, 30, 90, 270, 400, 550], side: "bottom" },
  { i: 7, type: "chance", name: "Suerte", icon: "❓", side: "bottom" },
  { i: 8, type: "property", name: "Av. Mariscal", group: "lightblue", price: 100, houseCost: 50,
    rent: [6, 30, 90, 270, 400, 550], side: "bottom" },
  { i: 9, type: "property", name: "Av. Córdoba", group: "lightblue", price: 120, houseCost: 50,
    rent: [8, 40, 100, 300, 450, 600], side: "bottom" },

  { i: 10, type: "jail", name: "CÁRCEL", icon: "🚔", side: "bottom" },

  { i: 11, type: "property", name: "Av. Belgrano", group: "pink", price: 140, houseCost: 100,
    rent: [10, 50, 150, 450, 625, 750], side: "left" },
  { i: 12, type: "utility", name: "Compañía Eléctrica", price: 150, icon: "⚡", side: "left" },
  { i: 13, type: "property", name: "Av. Independencia", group: "pink", price: 140, houseCost: 100,
    rent: [10, 50, 150, 450, 625, 750], side: "left" },
  { i: 14, type: "property", name: "Av. Libertad", group: "pink", price: 160, houseCost: 100,
    rent: [12, 60, 180, 500, 700, 900], side: "left" },
  { i: 15, type: "railroad", name: "Estación Sur", price: 200, side: "left" },
  { i: 16, type: "property", name: "Av. Colón", group: "orange", price: 180, houseCost: 100,
    rent: [14, 70, 200, 550, 750, 950], side: "left" },
  { i: 17, type: "chest", name: "Arca Común", icon: "📦", side: "left" },
  { i: 18, type: "property", name: "Av. San Martín", group: "orange", price: 180, houseCost: 100,
    rent: [14, 70, 200, 550, 750, 950], side: "left" },
  { i: 19, type: "property", name: "Av. 9 de Julio", group: "orange", price: 200, houseCost: 100,
    rent: [16, 80, 220, 600, 800, 1000], side: "left" },

  { i: 20, type: "parking", name: "ESTACIONAMIENTO", icon: "🅿️", side: "left" },

  { i: 21, type: "property", name: "Av. Mitre", group: "red", price: 220, houseCost: 150,
    rent: [18, 90, 250, 700, 875, 1050], side: "top" },
  { i: 22, type: "chance", name: "Suerte", icon: "❓", side: "top" },
  { i: 23, type: "property", name: "Av. Sarmiento", group: "red", price: 220, houseCost: 150,
    rent: [18, 90, 250, 700, 875, 1050], side: "top" },
  { i: 24, type: "property", name: "Av. Alvear", group: "red", price: 240, houseCost: 150,
    rent: [20, 100, 300, 750, 925, 1100], side: "top" },
  { i: 25, type: "railroad", name: "Estación Este", price: 200, side: "top" },
  { i: 26, type: "property", name: "Av. Callao", group: "yellow", price: 260, houseCost: 150,
    rent: [22, 110, 330, 800, 975, 1150], side: "top" },
  { i: 27, type: "property", name: "Av. Corrientes", group: "yellow", price: 260, houseCost: 150,
    rent: [22, 110, 330, 800, 975, 1150], side: "top" },
  { i: 28, type: "utility", name: "Compañía de Agua", price: 150, icon: "💧", side: "top" },
  { i: 29, type: "property", name: "Av. Santa Fe", group: "yellow", price: 280, houseCost: 150,
    rent: [24, 120, 360, 850, 1025, 1200], side: "top" },

  { i: 30, type: "gotojail", name: "IR A LA CÁRCEL", icon: "👮", side: "top" },

  { i: 31, type: "property", name: "Av. Florida", group: "green", price: 300, houseCost: 200,
    rent: [26, 130, 390, 900, 1100, 1275], side: "right" },
  { i: 32, type: "property", name: "Av. Córdoba Norte", group: "green", price: 300, houseCost: 200,
    rent: [26, 130, 390, 900, 1100, 1275], side: "right" },
  { i: 33, type: "chest", name: "Arca Común", icon: "📦", side: "right" },
  { i: 34, type: "property", name: "Av. Puerto Madero", group: "green", price: 320, houseCost: 200,
    rent: [28, 150, 450, 1000, 1200, 1400], side: "right" },
  { i: 35, type: "railroad", name: "Estación Oeste", price: 200, side: "right" },
  { i: 36, type: "chance", name: "Suerte", icon: "❓", side: "right" },
  { i: 37, type: "property", name: "Av. del Libertador", group: "darkblue", price: 350, houseCost: 200,
    rent: [35, 175, 500, 1100, 1300, 1500], side: "right" },
  { i: 38, type: "tax", name: "Impuesto de Lujo", amount: 100, icon: "💎", side: "right" },
  { i: 39, type: "property", name: "Paseo TAK TAK", group: "darkblue", price: 400, houseCost: 200,
    rent: [50, 200, 600, 1400, 1700, 2000], side: "right" },
];

export const RAILROAD_RENTS = [25, 50, 100, 200];
export const UTILITY_MULTIPLIER = [4, 10];

export const TOKENS = ["🎩", "🚗", "🐕", "🚢", "🐈", "🦖", "🍕", "🚀"];

export const PLAYER_COLORS = [
  "#ffd23f",
  "#ff5f6d",
  "#35d07f",
  "#7c5cff",
  "#f08a24",
  "#4dd0e1",
];

export const START_MONEY = 1500;
export const GO_REWARD = 200;
export const JAIL_FINE = 50;
export const JAIL_POSITION = 10;

export function groupProperties(group) {
  return BOARD.filter((s) => s.type === "property" && s.group === group);
}

export function spaceColor(space) {
  if (space.type === "property") return COLOR_GROUPS[space.group].color;
  if (space.type === "railroad") return "#6b7280";
  if (space.type === "utility") return "#7c5cff";
  return "#334155";
}

export const AI_NAMES = ["TAK-Bot", "Taki", "Señor TAK", "Doña TAK"];
