import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * AI helpers.
 *
 * Every call happens server-side so the API key never reaches the browser —
 * this repo is public and the app is deployed, so a key shipped to the
 * client would be someone else's bill waiting to happen.
 *
 * Set ANTHROPIC_API_KEY as a secret in the hosting environment.
 */

/**
 * Provider is chosen by which key is present, so the app can run on
 * Google's free tier by default and move to Anthropic later without a code
 * change. Gemini's free tier needs no credit card; note that Google may use
 * free-tier prompts for training, unlike its paid tier.
 */
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// GA as of Aug/2026 — the gemini-2.5-* line was retired for new accounts.
// Cheaper/faster alternative: set GEMINI_MODEL to "gemini-3.5-flash-lite".
const GEMINI_MODEL = process.env["GEMINI_MODEL"] ?? "gemini-3.6-flash";
const ANTHROPIC_MODEL = process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5";

type AnthropicBlock = { type: string; text?: string };
type GeminiPart = { text?: string };

/** 503 from either provider — their own message says these spikes are
 * usually brief, so callAi() retries once before giving up. */
class AiOverloadedError extends Error {}

async function callGemini(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Key goes in a header rather than the query string, so it can't leak
      // into request logs or proxy history.
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      // temperature/top_p/top_k are deprecated on Gemini 3.x — omitted on purpose.
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 429 on the free tier means the daily/minute quota ran out.
    if (response.status === 429) {
      throw new Error("Limite gratuito da IA atingido. Tente de novo mais tarde.");
    }
    if (response.status === 404) {
      throw new Error(
        `Modelo "${GEMINI_MODEL}" indisponível para esta conta. Ajuste o secret GEMINI_MODEL para um modelo atual.`,
      );
    }
    if (response.status === 503) {
      throw new AiOverloadedError(detail.slice(0, 200));
    }
    throw new Error(`Falha na chamada da IA (${response.status}). ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] } }[];
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("A IA não retornou conteúdo.");
  return text;
}

async function callAnthropic(
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 503) {
      throw new AiOverloadedError(detail.slice(0, 200));
    }
    throw new Error(`Falha na chamada da IA (${response.status}). ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { content?: AnthropicBlock[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("A IA não retornou conteúdo.");
  return text;
}

/** Route to whichever provider has a key configured; Gemini wins if both. */
async function callAi(system: string, user: string, maxTokens: number): Promise<string> {
  const geminiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  const attempt = geminiKey
    ? () => callGemini(geminiKey, system, user, maxTokens)
    : anthropicKey
      ? () => callAnthropic(anthropicKey, system, user, maxTokens)
      : null;

  if (!attempt) {
    throw new Error(
      "Chave da IA não configurada. Defina GEMINI_API_KEY (gratuito em ai.google.dev) nos secrets do servidor.",
    );
  }

  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof AiOverloadedError)) throw err;
    // The provider's own message says these spikes are usually brief —
    // worth one short wait-and-retry before bothering the person with it.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      return await attempt();
    } catch {
      throw new Error("A IA está sobrecarregada agora. Tente de novo em alguns segundos.");
    }
  }
}

/** Strip ```json fences the model may wrap the answer in. */
function parseJsonArray(raw: string): unknown[] {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("A IA não retornou uma lista válida de cards.");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("A IA não retornou uma lista válida de cards.");
  return parsed;
}

const GENERATE_SYSTEM = `Você cria flashcards de estudo para um estudante de medicina, em português do Brasil.

Regras:
- Cada card testa UM fato ou conceito. Nunca junte dois assuntos no mesmo card.
- A pergunta deve ser respondível sem ver o texto original; não use "segundo o texto" nem "no material acima".
- A resposta deve ser curta e completa: uma a três frases.
- Não invente informação que não esteja no material fornecido.
- Prefira perguntas que exijam recuperação ativa ("Por que...", "O que diferencia...") a perguntas de sim/não.

Responda APENAS com um array JSON, sem texto antes ou depois, no formato:
[{"pergunta": "...", "resposta": "..."}]`;

export const generateCardsFromText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string; count?: number }) => {
    const text = input.text?.trim();
    if (!text) throw new Error("Cole o conteúdo que deve virar cards.");
    if (text.length < 40) throw new Error("O texto é curto demais para gerar cards úteis.");
    if (text.length > 20000) throw new Error("Texto muito longo. Divida em partes menores.");
    const count = Math.min(40, Math.max(1, Math.round(input.count ?? 12)));
    return { text, count };
  })
  .handler(async ({ data }) => {
    const raw = await callAi(
      GENERATE_SYSTEM,
      // Asking for an exact number matters: "no máximo N" was read as an
      // upper bound and consistently came back short of what was requested.
      `Crie EXATAMENTE ${data.count} flashcards a partir do material abaixo. ` +
        `Não devolva menos que ${data.count}, a não ser que o material realmente não dê para tanto — ` +
        `nesse caso, devolva quantos forem possíveis sem repetir conteúdo nem inventar informação.\n\n---\n${data.text}\n---`,
      8000,
    );

    const items = parseJsonArray(raw);
    const cards = items
      .map((item) => {
        const obj = item as Record<string, unknown>;
        return {
          pergunta: String(obj["pergunta"] ?? "").trim(),
          resposta: String(obj["resposta"] ?? "").trim(),
        };
      })
      .filter((c) => c.pergunta && c.resposta)
      .slice(0, data.count);

    if (cards.length === 0) throw new Error("A IA não conseguiu gerar cards a partir desse texto.");
    return { cards };
  });

const EXPLAIN_SYSTEM = `Você explica conceitos para um estudante de medicina, em português do Brasil.

Escreva uma explicação curta (no máximo 3 parágrafos) que ajude a ENTENDER, não apenas decorar:
por que é assim, como se conecta com o resto, e um erro comum ou pegadinha, se houver.
Não repita literalmente a resposta do card. Não use listas longas nem markdown pesado.`;

export const explainCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { card_id?: string; pergunta: string; resposta: string }) => {
    const pergunta = input.pergunta?.trim();
    if (!pergunta) throw new Error("Card sem pergunta.");
    return { card_id: input.card_id, pergunta, resposta: input.resposta?.trim() ?? "" };
  })
  .handler(async ({ data, context }) => {
    const explanation = await callAi(
      EXPLAIN_SYSTEM,
      `Pergunta do card: ${data.pergunta}\nResposta do card: ${data.resposta}\n\nExplique esse assunto.`,
      1500,
    );

    // Persist so the review screen doesn't burn another AI call every time
    // it re-opens this card. Skipped for cards with no id yet (e.g. a CSV
    // import preview before it's saved) — nothing to attach it to. Failure
    // is non-fatal: the person still gets the explanation this time either
    // way.
    if (data.card_id) {
      try {
        await context.supabase
          .from("cards")
          .update({ explanation })
          .eq("id", data.card_id)
          .eq("user_id", context.userId);
      } catch (e) {
        console.warn("Failed to save card explanation", e);
      }
    }

    return { explanation };
  });

const IMPROVE_SYSTEM = `Você revisa flashcards de um estudante de medicina, em português do Brasil.

Reescreva o card para ficar melhor de estudar, mantendo o MESMO fato central:
- A pergunta deve ser específica e respondível sem contexto externo.
- A resposta deve ser curta, precisa e completa (uma a três frases).
- Corrija imprecisões, ambiguidade e termos vagos.
- Se o card já estiver bom, devolva-o praticamente igual — não invente mudanças.
- NUNCA acrescente informação que não esteja implícita no card original.

Responda APENAS com um objeto JSON, sem texto antes ou depois:
{"pergunta": "...", "resposta": "...", "mudou": true|false}`;

/** Rewrite a single card, returning a suggestion the user can accept or discard. */
export const improveCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pergunta: string; resposta: string }) => {
    const pergunta = input.pergunta?.trim();
    if (!pergunta) throw new Error("Card sem pergunta.");
    return { pergunta, resposta: input.resposta?.trim() ?? "" };
  })
  .handler(async ({ data }) => {
    const raw = await callAi(
      IMPROVE_SYSTEM,
      `Pergunta: ${data.pergunta}\nResposta: ${data.resposta}`,
      2000,
    );

    const cleaned = raw
      .replace(/^\s*```(?:json)?/i, "")
      .replace(/```\s*$/, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("A IA não retornou uma sugestão válida.");

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const pergunta = String(parsed["pergunta"] ?? "").trim();
    const resposta = String(parsed["resposta"] ?? "").trim();
    if (!pergunta || !resposta) throw new Error("A IA não retornou uma sugestão válida.");

    return { pergunta, resposta };
  });