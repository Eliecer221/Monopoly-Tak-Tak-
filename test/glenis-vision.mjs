// Prueba de visión de GLENIS contra la API real.
// Se salta si no hay GEMINI_API_KEY: sin clave no hay nada que probar, y
// saltar es honesto, no un fallo.
import { ReceiptValidator } from "../server/ai-receipts.mjs";
import { createMemoryDb } from "../server/db.mjs";
import { createServer } from "../server/server.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let passed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok -", msg); }
  else { console.error("  FALLA -", msg); process.exitCode = 1; }
}

const key = process.env.GEMINI_API_KEY || process.env.K;
if (!key) {
  console.log("GLENIS visión: sin GEMINI_API_KEY, se salta (no es un fallo).");
  process.exit(0);
}

// Comprobante de prueba, generado aquí: no se sube ninguna imagen real.
function makeReceipt({ amount = "10.00", receiver = "Monopoly Tak Tak", ref = "TT-2026-00123" } = {}) {
  const py = `
from PIL import Image, ImageDraw
im=Image.new('RGB',(700,900),(248,249,251)); d=ImageDraw.Draw(im)
d.rectangle([0,0,700,120], fill=(20,90,170)); d.text((30,50),'PAGO ENVIADO', fill=(255,255,255))
rows=[('Destinatario:','${receiver}'),('Monto:','USD ${amount}'),('Referencia:','${ref}'),('Fecha:','06/11/2026'),('Estado:','Completado')]
y=200
for k,v in rows:
    d.text((40,y),k,fill=(90,100,110)); d.text((300,y),v,fill=(15,20,25)); y+=80
im.save('${path.join(os.tmpdir(), "rec.png")}')
`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return fs.readFileSync(path.join(os.tmpdir(), "rec.png")).toString("base64");
}

const b64 = makeReceipt();
if (!b64) {
  console.log("GLENIS visión: falta Pillow para generar el comprobante, se salta.");
  process.exit(0);
}
const image = `data:image/png;base64,${b64}`;
const env = { GEMINI_API_KEY: key };

// 1) GLENIS lee el comprobante: monto, moneda y referencia.
const v = new ReceiptValidator(createMemoryDb(), { env });
ok(v.available, "GLENIS tiene proveedor de visión con la clave de Gemini");
const out = await v.review({
  order: { amountCents: 1000, currency: "USD", reference: "TT-2026-00123" },
  image,
  declaredReference: "TT-2026-00123",
  user: { email: "ana@gmail.com" },
});
ok(out.reading !== null, "GLENIS leyó el comprobante");
ok(out.reading?.amount === 10, "leyó el monto correcto (10)");
ok(out.reading?.currency === "USD", "leyó la moneda (USD)");
ok(out.reading?.reference === "TT-2026-00123", "leyó la referencia");
ok(out.verdict !== "approved" || out.score > 0, "el veredicto lleva confianza");

// 2) Un comprobante con monto menor no se aprueba.
const v2 = new ReceiptValidator(createMemoryDb(), { env });
const low = await v2.review({
  order: { amountCents: 5000, currency: "USD", reference: "TT-2026-00123" },
  image,
  declaredReference: "TT-2026-00123",
  user: { email: "ana@gmail.com" },
});
ok(low.verdict !== "approved", "un monto insuficiente no se aprueba solo");

// 3) El mismo comprobante no se acepta dos veces.
const v3 = new ReceiptValidator(createMemoryDb(), { env });
await v3.review({ order: { amountCents: 1000, currency: "USD" }, image, declaredReference: "TT-2026-00123", user: {} });
const dup = await v3.review({ order: { amountCents: 1000, currency: "USD" }, image, declaredReference: "TT-2026-00123", user: {} });
ok(dup.verdict === "rejected", "el mismo comprobante repetido se rechaza");

// 4) El estado del servidor dice que GLENIS tiene visión.
const server = createServer({ db: createMemoryDb(), env });
await new Promise((r) => server.listen(0, r));
const health = await (await fetch(`http://127.0.0.1:${server.address().port}/health`)).json();
ok(health.glenis.vision === true, "el estado confirma que GLENIS lee comprobantes");
server.close();

console.log(`\nGLENIS visión: ${passed} comprobaciones correctas.`);
