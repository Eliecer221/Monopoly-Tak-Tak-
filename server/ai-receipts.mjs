// Validación de comprobantes de pago por IA.
//
// Arquitectura: un validador de reglas (determinista, siempre disponible) más un
// proveedor de visión opcional (OpenAI, Gemini o Anthropic) que lee la imagen.
// La IA nunca acredita por sí sola cuando hay dudas: en ese caso el comprobante
// va a revisión manual.
//
// Reglas de oro:
//   1. Un comprobante ya usado (mismo hash) no se acepta dos veces.
//   2. El monto leído debe cubrir el monto de la orden.
//   3. Ante duda, revisión manual; ante fraude evidente, rechazo.
//   4. La decisión y su motivo quedan registrados para auditoría.

import crypto from "node:crypto";

export const VERDICTS = ["approved", "manual_review", "rejected"];

// Umbrales de decisión. Ajustables sin tocar la lógica.
export const THRESHOLDS = {
  approveAt: 0.85,
  rejectAt: 0.35,
};

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Extrae el JSON del texto que devuelve el modelo, aunque venga con prosa.
export function parseModelJson(text) {
  if (!text) return null;
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : String(text);
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Normaliza lo que devuelve cualquier proveedor a una forma común.
export function normalizeReading(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const amount = Number(parsed.amount);
  return {
    amount: Number.isFinite(amount) ? amount : null,
    currency: String(parsed.currency || "").toUpperCase().slice(0, 4),
    sender: String(parsed.sender || "").slice(0, 80),
    receiver: String(parsed.receiver || "").slice(0, 80),
    reference: String(parsed.reference || "").slice(0, 60),
    date: String(parsed.date || "").slice(0, 40),
    looksEdited: Boolean(parsed.looksEdited),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
  };
}

// Motor de reglas: puntúa el comprobante de 0 a 1 y decide.
export function evaluateReceipt({ reading, expectedCents, expectedCurrency = "USD", config = {} }) {
  const pay = {
    receiverEmail: "",
    receiverPhone: "",
    ...config,
  };
  const reasons = [];
  let score = 0;

  if (!reading || reading.amount === null) {
    return {
      verdict: "manual_review",
      score: 0,
      reasons: ["no se pudo leer el monto del comprobante"],
      reading: reading || null,
    };
  }

  // Monto: debe cubrir la orden. Un monto menor es rechazo directo.
  const expected = expectedCents / 100;
  if (reading.amount >= expected - 0.01) {
    score += 0.4;
    reasons.push(`monto suficiente: ${reading.amount} >= ${expected}`);
  } else if (reading.amount > 0) {
    score -= 0.3;
    reasons.push(`monto insuficiente: ${reading.amount} < ${expected}`);
  }

  // Moneda
  if (!reading.currency || reading.currency === expectedCurrency.toUpperCase()) {
    score += 0.15;
  } else {
    score -= 0.1;
    reasons.push(`moneda distinta: ${reading.currency}`);
  }

  // Destinatario: debe coincidir con los datos de Zinli de la plataforma.
  const receiver = (reading.receiver || "").toLowerCase();
  const matchEmail = pay.receiverEmail && receiver.includes(pay.receiverEmail.toLowerCase());
  const matchPhone = pay.receiverPhone && receiver.replace(/\D/g, "").includes(pay.receiverPhone.replace(/\D/g, ""));
  if (matchEmail || matchPhone) {
    score += 0.25;
    reasons.push("destinatario coincide con los datos de la plataforma");
  } else if (receiver) {
    score -= 0.2;
    reasons.push("el destinatario no coincide con los datos de la plataforma");
  }

  // Manipulación: la señal más grave.
  if (reading.looksEdited) {
    score -= 0.5;
    reasons.push("señales de edición o montaje en la imagen");
  } else {
    score += 0.1;
  }

  // Confianza del modelo
  score += 0.1 * reading.confidence;

  score = Math.max(0, Math.min(1, score));
  let verdict = "manual_review";
  if (score >= THRESHOLDS.approveAt && !reading.looksEdited) verdict = "approved";
  else if (score <= THRESHOLDS.rejectAt) verdict = "rejected";

  return { verdict, score, reasons, reading };
}

// ---------- proveedores de visión ----------

const PROMPT = `Eres un validador de comprobantes de pago. Analiza la imagen y responde SOLO con JSON:
{"amount": number, "currency": "USD"|"VES", "sender": string, "receiver": string, "reference": string, "date": string, "looksEdited": boolean, "confidence": number}
Reglas: "amount" es el monto pagado; "sender" es quien paga; "receiver" es quien recibe;
"looksEdited" es true si detectas montaje, recorte, tipografía inconsistente o cifras retocadas;
"confidence" es tu seguridad de 0 a 1. Si no puedes leer algo, usa null y baja la confianza.`;

async function callOpenAI({ image, apiKey, fetchImpl = fetch }) {
  const res = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 400,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data?.error?.message || "OpenAI rechazó la petición" };
  return { value: normalizeReading(parseModelJson(data?.choices?.[0]?.message?.content)) };
}

// Groq: modelos abiertos, respuesta muy rápida y con visión en los Llama 4.
// Si el modelo principal no está disponible, se reintenta con uno alternativo.
export const GROQ_MODELS = ["meta-llama/llama-4-scout-17b-16e-instruct", "llama-3.2-11b-vision-preview"];

async function callGroqModel({ image, apiKey, fetchImpl, model }) {
  const res = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
      max_tokens: 400,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data?.error?.message || `Groq rechazó la petición (${model})` };
  return { value: normalizeReading(parseModelJson(data?.choices?.[0]?.message?.content)) };
}

async function callGroq({ image, apiKey, fetchImpl = fetch }) {
  let lastError = "Groq no respondió";
  for (const model of GROQ_MODELS) {
    const result = await callGroqModel({ image, apiKey, fetchImpl, model });
    if (!result.error) return result;
    lastError = result.error;
  }
  return { error: lastError };
}

// Groq en modo texto: se usa para los resúmenes de GLENIS, no para leer
// imágenes (la clave disponible no tiene modelos de visión).
export async function callGroqText({ prompt, apiKey, fetchImpl = fetch, model = "openai/gpt-oss-120b" }) {
  const res = await fetchImpl("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: String(prompt) }],
      max_tokens: 500,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data?.error?.message || "Groq rechazó la petición" };
  return { value: data?.choices?.[0]?.message?.content || "" };
}

// Google retira los nombres fijos de modelo cada pocos meses (gemini-1.5-flash y
// gemini-2.5-flash ya no sirven para cuentas nuevas). Los alias "latest"
// apuntan al modelo vigente y no hay que tocarlos.
export const GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.8-flash"];

async function callGeminiOnce({ image, apiKey, fetchImpl = fetch, model }) {
  const [meta, b64] = String(image).split(",");
  const mime = (meta.match(/data:(.*?);/) || [])[1] || "image/png";
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          { parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 || image } }] },
        ],
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data?.error?.message || "Gemini rechazó la petición" };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return { value: normalizeReading(parseModelJson(text)) };
}

// Prueba cada modelo en orden: si Google retiró el primero, sigue con el otro.
async function callGemini(args) {
  const errors = [];
  for (const model of GEMINI_MODELS) {
    const result = await callGeminiOnce({ ...args, model });
    if (!result.error) return result;
    errors.push(`${model}: ${result.error}`);
  }
  return { error: `ningún modelo de Gemini respondió (${errors.join(" | ")})` };
}

async function callAnthropic({ image, apiKey, fetchImpl = fetch }) {
  const [meta, b64] = String(image).split(",");
  const media = (meta.match(/data:(.*?);/) || [])[1] || "image/png";
  const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: media, data: b64 || image } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data?.error?.message || "Anthropic rechazó la petición" };
  return { value: normalizeReading(parseModelJson(data?.content?.[0]?.text)) };
}

export const PROVIDER_CALLS = { openai: callOpenAI, gemini: callGemini, anthropic: callAnthropic, groq: callGroq };

// Visión: leer el comprobante de una imagen. Groq queda fuera a propósito: los
// modelos de visión no están disponibles en todas las cuentas, y aquí no lo
// están. Un proveedor de texto no puede leer una captura.
export function visionProviderFromEnv(env = process.env) {
  if (env.OPENAI_API_KEY) return { name: "openai", apiKey: env.OPENAI_API_KEY };
  if (env.GEMINI_API_KEY) return { name: "gemini", apiKey: env.GEMINI_API_KEY };
  if (env.ANTHROPIC_API_KEY) return { name: "anthropic", apiKey: env.ANTHROPIC_API_KEY };
  return null;
}

// Texto: para que GLENIS explique lo que ve. Aquí sí entra Groq.
export function textProviderFromEnv(env = process.env) {
  if (env.GROQ_API_KEY) return { name: "groq", apiKey: env.GROQ_API_KEY };
  if (env.OPENAI_API_KEY) return { name: "openai", apiKey: env.OPENAI_API_KEY };
  if (env.GEMINI_API_KEY) return { name: "gemini", apiKey: env.GEMINI_API_KEY };
  if (env.ANTHROPIC_API_KEY) return { name: "anthropic", apiKey: env.ANTHROPIC_API_KEY };
  return null;
}

// ---------- servicio de validación ----------

export class ReceiptValidator {
  constructor(db, { env = process.env, fetchImpl = fetch } = {}) {
    this.db = db;
    this.receipts = db.collection("receipts");
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.provider = visionProviderFromEnv(env);
  }

  get available() {
    return Boolean(this.provider);
  }

  // Analiza el comprobante y devuelve un veredicto. No acredita nada: eso lo
  // hace la tienda solo cuando el veredicto es "approved".
  async review({ order, image, declaredReference, user, attemptsToday = 0 }) {
    const imageHash = sha256(image);

    // Regla 1: el mismo comprobante no se acepta dos veces.
    const duplicate = await this.receipts.findOne({ imageHash });
    if (duplicate) {
      return {
        verdict: "rejected",
        score: 0,
        reasons: ["este comprobante ya fue usado en otra solicitud"],
        imageHash,
        reading: null,
      };
    }

    let reading = null;
    let providerNote = "sin proveedor de IA configurado";
    if (this.provider) {
      const call = PROVIDER_CALLS[this.provider.name];
      const result = await call({ image, apiKey: this.provider.apiKey, fetchImpl: this.fetchImpl });
      if (result.error) providerNote = `el proveedor falló: ${result.error}`;
      else {
        reading = result.value;
        providerNote = `analizado con ${this.provider.name}`;
      }
    }

    const config = {
      receiverEmail: this.env.ZINLI_RECEIVER_EMAIL || "",
      receiverPhone: this.env.ZINLI_RECEIVER_PHONE || "",
    };
    const evaluation = evaluateReceipt({
      reading,
      expectedCents: order.amountCents,
      config,
    });

    // Señales de abuso del usuario: subir muchos comprobantes seguidos baja la
    // confianza y manda a revisión manual en vez de aprobar.
    const reasons = [...evaluation.reasons, providerNote];
    let verdict = evaluation.verdict;
    let score = evaluation.score;
    if (attemptsToday >= 5 && verdict === "approved") {
      verdict = "manual_review";
      reasons.push(`${attemptsToday} comprobantes hoy: se revisa a mano`);
      score = Math.min(score, 0.8);
    }
    if (declaredReference && reading?.reference && declaredReference.trim() && !reading.reference.includes(declaredReference.trim())) {
      verdict = verdict === "rejected" ? verdict : "manual_review";
      reasons.push("la referencia declarada no coincide con la del comprobante");
      score = Math.min(score, 0.7);
    }

    const record = {
      id: crypto.randomUUID(),
      orderId: order.id,
      userId: user.id,
      imageHash,
      verdict,
      score,
      reasons,
      reading,
      provider: this.provider?.name || null,
      at: new Date().toISOString(),
    };
    await this.receipts.insertOne(record);
    return record;
  }
}
