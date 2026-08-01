/* =========================================================================
   Boti — función serverless (Vercel) que conversa con la API de Anthropic.
   La API key vive SOLO en el servidor (process.env.ANTHROPIC_API_KEY);
   nunca se expone al cliente. El frontend llama a /api/chat, nunca a Anthropic.
   ========================================================================= */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;

// System prompt de Boti. [RESUMEN] se reemplaza con el resumen del negocio.
function systemPrompt(resumen) {
  return (
    "Eres Boti, asistente financiero amigable de TF Finance. " +
    "Tienes acceso al resumen financiero del usuario:\n\n" +
    (resumen && String(resumen).trim() ? String(resumen).trim() : "(sin datos disponibles)") +
    "\n\nResponde en español, de forma concisa y útil. " +
    "Usa los números del resumen cuando la pregunta lo requiera; " +
    "si algo no está en el resumen, dilo con claridad en vez de inventarlo. " +
    "Puedes usar markdown (negritas, listas, tablas) para que la respuesta sea legible."
  );
}

// Normaliza el historial a mensajes válidos de la API (roles user/assistant).
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content }));
}

export default async function handler(req, res) {
  // 1) Método: solo POST.
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido. Usa POST." });
  }

  // 2) Cuerpo: Vercel ya parsea JSON, pero por robustez aceptamos string.
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "El cuerpo no es JSON válido." });
    }
  }
  body = body || {};

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const summary = body.summary;
  const history = normalizeHistory(body.history);

  // 3) Validación: debe venir un mensaje del usuario.
  if (!message) {
    return res.status(400).json({ error: "Falta 'message' en el cuerpo de la petición." });
  }

  // 4) API key configurada.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error:
        "Falta configurar ANTHROPIC_API_KEY en el servidor. " +
        "Agrégala en Vercel → Settings → Environment Variables y vuelve a desplegar.",
    });
  }

  // 5) Llamada a la API de Anthropic.
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt(summary),
      messages: [...history, { role: "user", content: message }],
    });

    const reply = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return res.status(200).json({
      reply: reply || "(sin respuesta)",
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    // Mensaje legible para errores de red/API (rate limit, auth, etc.).
    const status = err && typeof err.status === "number" ? err.status : 500;
    const detail =
      (err && err.error && err.error.error && err.error.error.message) ||
      (err && err.message) ||
      "Error desconocido al contactar la API.";
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "No se pudo obtener respuesta de Boti: " + detail,
    });
  }
}
