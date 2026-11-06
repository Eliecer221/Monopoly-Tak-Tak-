// Genera el tablero de Monopoly Tak Tak como SVG.
//
// El tablero es un cuadrado de juego en el plano (u,v) de [0,1]², proyectado a
// un rombo en isométrico: la esquina (0,0) queda arriba, (1,0) a la derecha,
// (1,1) abajo (la salida) y (0,1) a la izquierda.
//
//   node board/generate-board.mjs

import fs from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "monopoly-tak-tak-board.svg");

// ---------- lienzo y proyección ----------
const W = 1024;
const H = 1024;
const CX = 512;
const CY = 122.5;
const KU = 418;
const KV = 368;
const RIM = 0.018;
const T = 1 / 11;
const THICK = 30;
const PH = 16;

const iso = (u, v, h = 0) => [CX + (u - v) * KU, CY + (u + v) * KV - h];
const pts = (a) => a.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (x) => Math.max(0, Math.min(255, Math.round(x + 255 * amt)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function poly(a, fill, o = {}) {
  const { stroke = null, sw = 1, opacity = null, filter = null } = o;
  return (
    `<polygon points="${pts(a)}" fill="${fill}"` +
    (stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : "") +
    (opacity != null ? ` opacity="${opacity}"` : "") +
    (filter ? ` filter="${filter}"` : "") +
    ` stroke-linejoin="round"/>`
  );
}

// Caja 3D en el plano del tablero. `h` es la altura en píxeles.
function box(u, v, w, d, h, c) {
  const A = iso(u, v, h);
  const B = iso(u + w, v, h);
  const Cc = iso(u + w, v + d, h);
  const D = iso(u, v + d, h);
  const B0 = iso(u + w, v, 0);
  const C0 = iso(u + w, v + d, 0);
  const D0 = iso(u, v + d, 0);
  return (
    poly([B0, C0, Cc, B], c.right, { stroke: c.stroke, sw: c.sw || 1 }) +
    poly([D0, C0, Cc, D], c.left, { stroke: c.stroke, sw: c.sw || 1 }) +
    poly([A, B, Cc, D], c.top, { stroke: c.stroke, sw: c.sw || 1 })
  );
}

// Sombra de contacto difusa bajo una pieza, para despegarla del suelo.
function contactShadow(u, v, w, d, opacity = 0.3) {
  const [x, y] = iso(u + w / 2, v + d / 2, 0);
  const rx = ((w + d) / 2) * KU * 0.72;
  const ry = ((w + d) / 2) * KV * 0.5;
  return `<ellipse cx="${x.toFixed(1)}" cy="${(y + 3).toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${C.shadow}" opacity="${opacity}" filter="url(#soft)"/>`;
}

// ---------- paleta ----------
const C = {
  bg: "#eceef1",
  boardTop: "#2f7a5f",
  boardRight: "#1f5540",
  boardLeft: "#1a4635",
  cream: "#f7efdc",
  creamAlt: "#f2e6cc",
  mint: "#d7ebe1",
  mintAlt: "#cbe4d8",
  corner: "#f0e3c6",
  cellLine: "#a7b8ad",
  woodLight: "#cf9560",
  wood: "#b57c45",
  woodMid: "#a06b39",
  woodDark: "#84562c",
  woodDeep: "#66411f",
  woodEdge: "#5d3a1c",
  gold: "#e3b64c",
  goldDark: "#b78a2c",
  chest: "#3d7fc4",
  chestLight: "#5c9bd8",
  chestDark: "#2b5f9c",
  cabinet: "#9ad3e8",
  cabinetDark: "#6fb2cc",
  red: "#dd3b40",
  green: "#2f9e5f",
  blue: "#2f6fb0",
  blueDark: "#1f4f83",
  shadow: "#000000",
  text: "#4b4238",
  white: "#ffffff",
  crate: "#d9a869",
  crateDark: "#b3833f",
};

const GROUPS = {
  brown: "#8d5524",
  lightblue: "#74c0e8",
  pink: "#e7508f",
  orange: "#f08a24",
  red: "#e0393e",
  yellow: "#f2c53d",
  green: "#2f9e5f",
  darkblue: "#2b6cb0",
};

// ---------- casillas ----------
const BOARD = [
  { i: 0, type: "go", name: "SALIDA" },
  { i: 1, type: "property", group: "brown", name: "Bodegón" },
  { i: 2, type: "chest", name: "Caja" },
  { i: 3, type: "property", group: "brown", name: "Abastos" },
  { i: 4, type: "crisis", name: "Luz" },
  { i: 5, type: "railroad", name: "Metro" },
  { i: 6, type: "property", group: "lightblue", name: "Lácteos" },
  { i: 7, type: "chance", name: "Suerte" },
  { i: 8, type: "property", group: "lightblue", name: "Agroisleña" },
  { i: 9, type: "property", group: "lightblue", name: "Mercal" },
  { i: 10, type: "jail", name: "Cárcel" },
  { i: 11, type: "property", group: "pink", name: "Hidroven" },
  { i: 12, type: "crisis", name: "Agua" },
  { i: 13, type: "property", group: "pink", name: "Hidrocapital" },
  { i: 14, type: "property", group: "pink", name: "IVSS" },
  { i: 15, type: "railroad", name: "Ferrocarril" },
  { i: 16, type: "property", group: "orange", name: "Corpoelec" },
  { i: 17, type: "chest", name: "Caja" },
  { i: 18, type: "property", group: "orange", name: "E. de Caracas" },
  { i: 19, type: "property", group: "orange", name: "Cantv" },
  { i: 20, type: "parking", name: "Embajadas" },
  { i: 21, type: "property", group: "red", name: "SIDOR" },
  { i: 22, type: "chance", name: "Suerte" },
  { i: 23, type: "property", group: "red", name: "Alcasa" },
  { i: 24, type: "property", group: "red", name: "Ferrominera" },
  { i: 25, type: "railroad", name: "Puerto" },
  { i: 26, type: "property", group: "yellow", name: "Cem. Progreso" },
  { i: 27, type: "property", group: "yellow", name: "Cem. Andino" },
  { i: 28, type: "crisis", name: "Cambiario" },
  { i: 29, type: "property", group: "yellow", name: "Vencemos" },
  { i: 30, type: "gotojail", name: "A la cárcel" },
  { i: 31, type: "property", group: "green", name: "Min. Finanzas" },
  { i: 32, type: "property", group: "green", name: "Min. Energía" },
  { i: 33, type: "chest", name: "Caja" },
  { i: 34, type: "property", group: "green", name: "Min. Petróleo" },
  { i: 35, type: "railroad", name: "Maiquetía" },
  { i: 36, type: "chance", name: "Suerte" },
  { i: 37, type: "property", group: "darkblue", name: "PDVSA" },
  { i: 38, type: "crisis", name: "Deuda" },
  { i: 39, type: "property", group: "darkblue", name: "Paseo PDVSA" },
];

function cellRect(pos) {
  if (pos === 0) return { u0: 1 - T, u1: 1, v0: 1 - T, v1: 1 };
  if (pos === 10) return { u0: 1 - T, u1: 1, v0: 0, v1: T };
  if (pos === 20) return { u0: 0, u1: T, v0: 0, v1: T };
  if (pos === 30) return { u0: 0, u1: T, v0: 1 - T, v1: 1 };
  if (pos <= 9) return { u0: 1 - T, u1: 1, v0: 1 - (pos + 1) * T, v1: 1 - pos * T };
  if (pos <= 19) {
    const i = pos - 10;
    return { u0: 1 - (i + 1) * T, u1: 1 - i * T, v0: 0, v1: T };
  }
  if (pos <= 29) {
    const i = pos - 20;
    return { u0: 0, u1: T, v0: i * T, v1: (i + 1) * T };
  }
  const i = pos - 30;
  return { u0: i * T, u1: (i + 1) * T, v0: 1 - T, v1: 1 };
}

function bandRect(pos) {
  const r = cellRect(pos);
  const b = T * 0.3;
  if (pos >= 1 && pos <= 9) return { ...r, u0: r.u1 - b };
  if (pos >= 11 && pos <= 19) return { ...r, v1: r.v0 + b };
  if (pos >= 21 && pos <= 29) return { ...r, u1: r.u0 + b };
  if (pos >= 31 && pos <= 39) return { ...r, v0: r.v1 - b };
  return null;
}

const rectPoly = (r, h = 0) => [
  iso(r.u0, r.v0, h),
  iso(r.u1, r.v0, h),
  iso(r.u1, r.v1, h),
  iso(r.u0, r.v1, h),
];

const cellFill = (type) =>
  type === "property"
    ? C.cream
    : type === "railroad"
      ? C.creamAlt
      : type === "go" || type === "jail" || type === "parking" || type === "gotojail"
        ? C.corner
        : type === "crisis"
          ? C.mintAlt
          : C.mint;

const ANG = 41.4; // atan(KV / KU)
const cellAngle = (pos) => {
  if (pos >= 1 && pos <= 9) return -ANG;
  if (pos >= 11 && pos <= 19) return ANG;
  if (pos >= 21 && pos <= 29) return -ANG;
  if (pos >= 31 && pos <= 39) return ANG;
  return 0;
};

// Desplaza el contenido hacia el interior, para no pisar la franja de color.
const inward = (pos) => {
  const d = T * 0.26;
  if (pos >= 1 && pos <= 9) return [-d, 0];
  if (pos >= 11 && pos <= 19) return [0, d];
  if (pos >= 21 && pos <= 29) return [d, 0];
  if (pos >= 31 && pos <= 39) return [0, -d];
  return [0, 0];
};

const center = (r) => [(r.u0 + r.u1) / 2, (r.v0 + r.v1) / 2];
const longAxis = (pos) => ((pos >= 1 && pos <= 9) || (pos >= 21 && pos <= 29) ? "v" : "u");

function label(u, v, text, size, fill, angle = 0, weight = 700, h = 0) {
  const [x, y] = iso(u, v, h);
  const rot = angle ? ` transform="rotate(${angle} ${x.toFixed(2)} ${y.toFixed(2)})"` : "";
  return (
    `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Verdana,DejaVu Sans,sans-serif"` +
    ` font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle"` +
    ` dominant-baseline="middle"${rot}>${text}</text>`
  );
}

// ---------- iconos impresos en las casillas ----------
function questionMark(u, v, s, h = 0) {
  const [x, y] = iso(u, v, h);
  return (
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})">` +
    `<circle r="${(s * 0.86).toFixed(1)}" fill="${C.white}" opacity="0.75"/>` +
    `<text x="0" y="${(s * 0.34).toFixed(1)}" font-family="Verdana,DejaVu Sans,sans-serif"` +
    ` font-size="${(s * 1.5).toFixed(1)}" font-weight="900" fill="${C.blue}"` +
    ` text-anchor="middle">?</text></g>`
  );
}

function trainIcon(u, v, s, angle, h = 0) {
  const [x, y] = iso(u, v, h);
  return (
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle})">` +
    `<rect x="${(-s * 0.62).toFixed(1)}" y="${(-s * 0.5).toFixed(1)}" width="${(s * 1.24).toFixed(1)}"` +
    ` height="${(s * 0.78).toFixed(1)}" rx="${(s * 0.2).toFixed(1)}" fill="${C.blueDark}"/>` +
    `<rect x="${(-s * 0.46).toFixed(1)}" y="${(-s * 0.36).toFixed(1)}" width="${(s * 0.92).toFixed(1)}"` +
    ` height="${(s * 0.3).toFixed(1)}" rx="${(s * 0.08).toFixed(1)}" fill="${C.white}" opacity="0.85"/>` +
    `<circle cx="${(-s * 0.34).toFixed(1)}" cy="${(s * 0.36).toFixed(1)}" r="${(s * 0.15).toFixed(1)}" fill="${C.blueDark}"/>` +
    `<circle cx="${(s * 0.34).toFixed(1)}" cy="${(s * 0.36).toFixed(1)}" r="${(s * 0.15).toFixed(1)}" fill="${C.blueDark}"/>` +
    `</g>`
  );
}

function crisisIcon(u, v, s, h = 0) {
  const [x, y] = iso(u, v, h);
  const k = s / 10;
  return (
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})">` +
    `<polygon points="0,${(-10 * k).toFixed(1)} ${(9 * k).toFixed(1)},${(7 * k).toFixed(1)} ${(-9 * k).toFixed(1)},${(7 * k).toFixed(1)}"` +
    ` fill="#f0a02a" stroke="#c47a12" stroke-width="${(1.1 * k).toFixed(1)}" stroke-linejoin="round"/>` +
    `<rect x="${(-1.1 * k).toFixed(1)}" y="${(-4.6 * k).toFixed(1)}" width="${(2.2 * k).toFixed(1)}"` +
    ` height="${(6.2 * k).toFixed(1)}" rx="${(1 * k).toFixed(1)}" fill="${C.white}"/>` +
    `<circle cx="0" cy="${(4.4 * k).toFixed(1)}" r="${(1.2 * k).toFixed(1)}" fill="${C.white}"/>` +
    `</g>`
  );
}

function chestIcon(u, v, s, h = 0) {
  const [x, y] = iso(u, v, h);
  const k = s / 10;
  return (
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})">` +
    `<rect x="${(-9 * k).toFixed(1)}" y="${(-6 * k).toFixed(1)}" width="${(18 * k).toFixed(1)}"` +
    ` height="${(13 * k).toFixed(1)}" rx="${(2 * k).toFixed(1)}" fill="${C.gold}" stroke="${C.goldDark}" stroke-width="${(1.1 * k).toFixed(1)}"/>` +
    `<rect x="${(-9 * k).toFixed(1)}" y="${(-6 * k).toFixed(1)}" width="${(18 * k).toFixed(1)}"` +
    ` height="${(5 * k).toFixed(1)}" rx="${(2 * k).toFixed(1)}" fill="${C.woodDark}"/>` +
    `<rect x="${(-1.6 * k).toFixed(1)}" y="${(-3 * k).toFixed(1)}" width="${(3.2 * k).toFixed(1)}"` +
    ` height="${(5 * k).toFixed(1)}" rx="${(1 * k).toFixed(1)}" fill="${C.white}" opacity="0.9"/>` +
    `</g>`
  );
}

function arrow(u, v, s, angle, h = 0) {
  const [x, y] = iso(u, v, h);
  return (
    `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle})">` +
    `<path d="M ${(-s).toFixed(1)},0 L ${(s * 0.25).toFixed(1)},0" stroke="${C.red}"` +
    ` stroke-width="${(s * 0.3).toFixed(1)}" stroke-linecap="round"/>` +
    `<polygon points="${(s * 0.25).toFixed(1)},${(-s * 0.42).toFixed(1)} ${s.toFixed(1)},0 ${(s * 0.25).toFixed(1)},${(s * 0.42).toFixed(1)}" fill="${C.red}"/>` +
    `</g>`
  );
}

// ---------- casas y hoteles ----------
function house(u, v, size, roofColor, bodyColor, h = 0) {
  const bh = size * 46;
  const rh = size * 60;
  const body = box(u, v, size, size, h + bh, {
    top: bodyColor,
    right: shade(bodyColor, -0.18),
    left: shade(bodyColor, -0.32),
  });
  const A = iso(u, v, h + bh);
  const B = iso(u + size, v, h + bh);
  const Cc = iso(u + size, v + size, h + bh);
  const D = iso(u, v + size, h + bh);
  const apex = iso(u + size / 2, v + size / 2, h + bh + rh);
  const roof =
    poly([A, B, apex], shade(roofColor, -0.28)) +
    poly([D, Cc, apex], shade(roofColor, -0.4)) +
    poly([B, Cc, apex], roofColor) +
    poly([A, D, apex], shade(roofColor, -0.14));
  return body + roof;
}

// ---------- composición ----------
const out = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
out.push(`<defs>
<filter id="soft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="13"/></filter>
<linearGradient id="woodGrad" x1="0" y1="0" x2="0.35" y2="1">
  <stop offset="0%" stop-color="${C.woodLight}"/><stop offset="100%" stop-color="${C.wood}"/>
</linearGradient>
</defs>`);

out.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/>`);

const slab = { u0: -RIM, u1: 1 + RIM, v0: -RIM, v1: 1 + RIM };

// Sombra suave bajo el tablero
out.push(poly(rectPoly(slab), C.shadow, { opacity: 0.17, filter: "url(#soft)" }));

// Canto de la losa
out.push(
  poly(
    [iso(slab.u1, slab.v0, 0), iso(slab.u1, slab.v1, 0), iso(slab.u1, slab.v1, -THICK), iso(slab.u1, slab.v0, -THICK)],
    C.boardRight
  )
);
out.push(
  poly(
    [iso(slab.u0, slab.v1, 0), iso(slab.u1, slab.v1, 0), iso(slab.u1, slab.v1, -THICK), iso(slab.u0, slab.v1, -THICK)],
    C.boardLeft
  )
);
out.push(poly(rectPoly(slab), C.boardTop));

// Casillas, de atrás hacia delante
const ordered = [...BOARD].sort((a, b) => {
  const ca = center(cellRect(a.i));
  const cb = center(cellRect(b.i));
  return ca[0] + ca[1] - (cb[0] + cb[1]);
});

for (const cell of ordered) {
  const r = cellRect(cell.i);
  out.push(poly(rectPoly(r), cellFill(cell.type), { stroke: C.cellLine, sw: 1.3 }));

  const band = bandRect(cell.i);
  if (band && cell.group) {
    out.push(poly(rectPoly(band), GROUPS[cell.group], { stroke: shade(GROUPS[cell.group], -0.22), sw: 1 }));
  }

  const [ou, ov] = center(r);
  const [du, dv] = inward(cell.i);
  const cu = ou + du;
  const cv = ov + dv;
  const angle = cellAngle(cell.i);

  if (cell.type === "chance") out.push(questionMark(cu, cv, 13));
  else if (cell.type === "chest") out.push(chestIcon(cu, cv, 13));
  else if (cell.type === "railroad") out.push(trainIcon(cu, cv, 15, angle));
  else if (cell.type === "crisis") out.push(crisisIcon(cu, cv, 13));
  else if (cell.type === "property") out.push(label(cu, cv, cell.name, 9, C.text, angle, 700));
  else if (cell.type === "go") {
    out.push(label(ou, ov - 0.028, "GO", 27, C.text, 0, 900));
    out.push(arrow(ou + 0.05, ov + 0.036, 17, -ANG));
  } else if (cell.type === "jail") out.push(label(ou, ov, "CÁRCEL", 13, C.text, 0, 800));
  else if (cell.type === "parking") out.push(label(ou, ov, "PARKING", 12, C.text, 0, 800));
  else if (cell.type === "gotojail") {
    out.push(label(ou, ov - 0.022, "IR A", 13, C.text, 0, 800));
    out.push(label(ou, ov + 0.034, "CÁRCEL", 13, C.text, 0, 800));
  }
}

// ---------- estructura central de madera ----------
const IN = { u0: T, u1: 1 - T, v0: T, v1: 1 - T };
out.push(
  box(IN.u0, IN.v0, IN.u1 - IN.u0, IN.v1 - IN.v0, PH, {
    top: "url(#woodGrad)",
    right: C.woodMid,
    left: C.woodDark,
    stroke: C.woodEdge,
    sw: 1.4,
  })
);

// Tablones del suelo
const planks = [];
const steps = 9;
for (let k = 1; k < steps; k++) {
  const u = IN.u0 + ((IN.u1 - IN.u0) * k) / steps;
  const a = iso(u, IN.v0, PH);
  const b = iso(u, IN.v1, PH);
  planks.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${C.woodDark}" stroke-width="1.6" opacity="0.45"/>`);
}
for (let k = 1; k < steps; k++) {
  const v = IN.v0 + ((IN.v1 - IN.v0) * k) / steps;
  const a = iso(IN.u0, v, PH);
  const b = iso(IN.u1, v, PH);
  planks.push(`<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}" stroke="${C.woodDark}" stroke-width="1.1" opacity="0.3"/>`);
}
out.push(`<g>${planks.join("")}</g>`);

// Vigas del borde interior
const beam = (u, v, w, d) =>
  box(u, v, w, d, PH + 7, { top: C.woodLight, right: C.woodMid, left: C.woodDark, stroke: C.woodEdge, sw: 1.2 });
out.push(beam(IN.u0, IN.v0, IN.u1 - IN.u0, T * 0.34));
out.push(beam(IN.u0, IN.v1 - T * 0.34, IN.u1 - IN.u0, T * 0.34));
out.push(beam(IN.u0, IN.v0, T * 0.34, IN.v1 - IN.v0));
out.push(beam(IN.u1 - T * 0.34, IN.v0, T * 0.34, IN.v1 - IN.v0));

// Abertura central poligonal (octágono)
const holeR = 0.155;
const holePoly = (r, dy = 0) => {
  const a = [];
  for (let k = 0; k < 8; k++) {
    const ang = Math.PI / 8 + (k * Math.PI) / 4;
    const p = iso(0.5 + r * Math.cos(ang), 0.5 + r * Math.sin(ang), PH);
    a.push([p[0], p[1] + dy]);
  }
  return a;
};
out.push(poly(holePoly(holeR * 1.12), C.woodDeep));
out.push(poly(holePoly(holeR, 4), "#3a2817"));
out.push(poly(holePoly(holeR * 0.86, 13), "#241810"));
out.push(poly(holePoly(holeR * 0.6, 20), "#150d08"));
out.push(poly(holePoly(holeR * 1.12), "none", { stroke: C.woodEdge, sw: 2.4 }));

// ---------- objetos 3D y construcciones, ordenados por profundidad ----------
const props = [];

// Cofre azul con refuerzos dorados
function bigChest(u, v) {
  const s = 0.13;
  let g = contactShadow(u, v, s, s, 0.34);
  g += box(u, v, s, s, 48, { top: C.chestLight, right: C.chest, left: C.chestDark, stroke: C.blueDark, sw: 1.3 });
  g += box(u - 0.006, v - 0.006, s + 0.012, s + 0.012, 20, {
    top: C.gold,
    right: C.goldDark,
    left: shade(C.goldDark, -0.2),
    stroke: shade(C.goldDark, -0.3),
    sw: 1.2,
  });
  const v1a = iso(u + s / 2, v + s, 0);
  const v1b = iso(u + s / 2, v + s, 48);
  const v2a = iso(u + s, v + s / 2, 0);
  const v2b = iso(u + s, v + s / 2, 48);
  g += `<line x1="${v1a[0].toFixed(1)}" y1="${v1a[1].toFixed(1)}" x2="${v1b[0].toFixed(1)}" y2="${v1b[1].toFixed(1)}" stroke="${C.gold}" stroke-width="4"/>`;
  g += `<line x1="${v2a[0].toFixed(1)}" y1="${v2a[1].toFixed(1)}" x2="${v2b[0].toFixed(1)}" y2="${v2b[1].toFixed(1)}" stroke="${C.gold}" stroke-width="4"/>`;
  return g;
}
props.push({ key: 0.33 + 0.78, svg: bigChest(0.33, 0.78) });
props.push({ key: 0.78 + 0.33, svg: bigChest(0.78, 0.33) });

// Mueble azul claro en la parte superior central
props.push({
  key: 0.25 + 0.27,
  svg:
    contactShadow(0.25, 0.27, 0.17, 0.11, 0.3) +
    box(0.25, 0.27, 0.17, 0.11, 42, {
    top: C.cabinet,
    right: C.cabinetDark,
    left: shade(C.cabinetDark, -0.18),
    stroke: shade(C.cabinetDark, -0.3),
    sw: 1.3,
  }),
});

// Cajas y objetos pequeños
const crates = [
  { u: 0.44, v: 0.16, s: 0.085, h: 32 },
  { u: 0.63, v: 0.17, s: 0.07, h: 26 },
  { u: 0.16, v: 0.44, s: 0.078, h: 28 },
  { u: 0.17, v: 0.62, s: 0.07, h: 24 },
  { u: 0.63, v: 0.63, s: 0.08, h: 30 },
  { u: 0.55, v: 0.16, s: 0.06, h: 22 },
  { u: 0.16, v: 0.55, s: 0.06, h: 22 },
];
for (const c of crates) {
  props.push({
    key: c.u + c.v,
    svg:
      contactShadow(c.u, c.v, c.s, c.s, 0.26) +
      box(c.u, c.v, c.s, c.s, c.h, {
      top: C.crate,
      right: shade(C.crate, -0.16),
      left: C.crateDark,
      stroke: shade(C.crateDark, -0.2),
      sw: 1.1,
    }),
  });
}

// Casas y hoteles sobre las propiedades
const builds = [
  { pos: 1, n: 2 }, { pos: 3, n: 1 }, { pos: 6, n: 1 }, { pos: 8, n: 2 }, { pos: 9, n: 1 },
  { pos: 16, n: 2 }, { pos: 18, n: 1 }, { pos: 21, n: 1 }, { pos: 26, n: 2 }, { pos: 27, n: 1 },
  { pos: 31, n: 1 }, { pos: 34, n: 2 }, { pos: 37, n: 1 }, { pos: 39, n: 1 },
];
for (const b of builds) {
  const r = cellRect(b.pos);
  const [cu, cv] = center(r);
  const s = 0.028;
  const spread = 0.024;
  const axis = longAxis(b.pos);
  for (let k = 0; k < b.n; k++) {
    const off = (k - (b.n - 1) / 2) * spread;
    const hu = cu + (axis === "u" ? off : 0) - s / 2;
    const hv = cv + (axis === "v" ? off : 0) - s / 2;
    const roof = b.n >= 2 ? C.green : C.red;
    props.push({
      key: hu + hv,
      svg: contactShadow(hu, hv, s, s, 0.34) + house(hu, hv, s, roof, C.creamAlt),
    });
  }
}

props.sort((a, b) => a.key - b.key);
out.push(props.map((p) => p.svg).join(""));

out.push(`</svg>`);

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`Tablero escrito en ${OUT}`);
