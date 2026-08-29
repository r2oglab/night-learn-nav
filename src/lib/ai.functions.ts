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

function geminiHttpError(response: Response, detail: string): Error {
  // 429 on the free tier means the daily/minute quota ran out.
  if (response.status === 429) {
    return new Error("Limite gratuito da IA atingido. Tente de novo mais tarde.");
  }
  if (response.status === 404) {
    return new Error(
      `Modelo "${GEMINI_MODEL}" indisponível para esta conta. Ajuste o secret GEMINI_MODEL para um modelo atual.`,
    );
  }
  if (response.status === 503) {
    return new AiOverloadedError(detail.slice(0, 200));
  }
  return new Error(`Falha na chamada da IA (${response.status}). ${detail.slice(0, 200)}`);
}

async function parseGeminiResponse(response: Response): Promise<string> {
  if (!response.ok) {
    throw geminiHttpError(response, await response.text().catch(() => ""));
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

/** Same as parseGeminiResponse, but also reports whether the response was
 * cut short by the token cap — worth surfacing to the person instead of
 * silently handing back a partial transcription as if it were complete. */
async function parseGeminiFileResponse(
  response: Response,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.ok) {
    throw geminiHttpError(response, await response.text().catch(() => ""));
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  };
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("A IA não retornou conteúdo.");
  return { text, truncated: candidate?.finishReason === "MAX_TOKENS" };
}

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
  return parseGeminiResponse(response);
}

/** Same call, but with a file (image or PDF) attached alongside the text
 * prompt — Gemini reads it as a genuine image/document, not OCR bolted on
 * separately, so it can read text inside diagrams and describe figures. */
async function callGeminiWithFile(
  apiKey: string,
  system: string,
  user: string,
  fileBase64: string,
  mimeType: string,
  maxTokens: number,
): Promise<{ text: string; truncated: boolean }> {
  const response = await fetch(`${GEMINI_URL}/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType, data: fileBase64 } }, { text: user }],
        },
      ],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  return parseGeminiFileResponse(response);
}

async function parseAnthropicResponse(response: Response): Promise<string> {
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

/** Same as parseAnthropicResponse, but also reports whether stop_reason
 * says the response was cut short by the token cap. */
async function parseAnthropicFileResponse(
  response: Response,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 503) {
      throw new AiOverloadedError(detail.slice(0, 200));
    }
    throw new Error(`Falha na chamada da IA (${response.status}). ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as { content?: AnthropicBlock[]; stop_reason?: string };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new Error("A IA não retornou conteúdo.");
  return { text, truncated: data.stop_reason === "max_tokens" };
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
  return parseAnthropicResponse(response);
}

/** Same call, with a file (image or PDF) attached. Anthropic reads PDFs
 * natively as a "document" block (page images + extracted text together),
 * and any other supported mime type as an "image" block. */
async function callAnthropicWithFile(
  apiKey: string,
  system: string,
  user: string,
  fileBase64: string,
  mimeType: string,
  maxTokens: number,
): Promise<{ text: string; truncated: boolean }> {
  const fileBlock =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mimeType, data: fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data: fileBase64 } };

  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // PDF input is a beta capability on the Messages API.
      "anthropic-beta": "pdfs-2024-09-25",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: user }] }],
    }),
  });
  return parseAnthropicFileResponse(response);
}

/** The provider's own 503 message says these spikes are usually brief —
 * worth one short wait-and-retry before bothering the person with it. */
async function withOverloadRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (err) {
    if (!(err instanceof AiOverloadedError)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      return await attempt();
    } catch {
      throw new Error("A IA está sobrecarregada agora. Tente de novo em alguns segundos.");
    }
  }
}

const NO_KEY_MESSAGE =
  "Chave da IA não configurada. Defina GEMINI_API_KEY (gratuito em ai.google.dev) nos secrets do servidor.";

/** Route to whichever provider has a key configured; Gemini wins if both. */
async function callAi(system: string, user: string, maxTokens: number): Promise<string> {
  const geminiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  const attempt = geminiKey
    ? () => callGemini(geminiKey, system, user, maxTokens)
    : anthropicKey
      ? () => callAnthropic(anthropicKey, system, user, maxTokens)
      : null;

  if (!attempt) throw new Error(NO_KEY_MESSAGE);
  return withOverloadRetry(attempt);
}

/** Same routing as callAi, for a prompt with a file (image/PDF) attached. */
async function callAiWithFile(
  system: string,
  user: string,
  fileBase64: string,
  mimeType: string,
  maxTokens: number,
): Promise<{ text: string; truncated: boolean }> {
  const geminiKey = process.env["GEMINI_API_KEY"] ?? process.env["GOOGLE_API_KEY"];
  const anthropicKey = process.env["ANTHROPIC_API_KEY"];
  const attempt = geminiKey
    ? () => callGeminiWithFile(geminiKey, system, user, fileBase64, mimeType, maxTokens)
    : anthropicKey
      ? () => callAnthropicWithFile(anthropicKey, system, user, fileBase64, mimeType, maxTokens)
      : null;

  if (!attempt) throw new Error(NO_KEY_MESSAGE);
  return withOverloadRetry(attempt);
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

const TRANSCRIBE_SYSTEM = `Você transcreve o conteúdo de slides de aula (PDF ou imagem) para texto estruturado, em português do Brasil, para virar material de estudo depois.

Regras:
- Transcreva TODO texto visível: títulos, tópicos, texto dentro de diagramas/figuras, legendas, tabelas.
- Para diagramas e fluxogramas, descreva a estrutura e as relações entre os elementos — não liste só palavras soltas.
- Preserve termos técnicos exatamente como aparecem, sem traduzir ou simplificar.
- Organize por slide/página, com um cabeçalho curto indicando a posição (ex: "Slide 3:").
- Não resuma nem interprete o conteúdo — o objetivo é ter o material completo disponível depois, não uma versão editorializada.
- Se uma página não tiver texto útil (capa, divisor, imagem decorativa), pule ela sem comentário.

Responda só com a transcrição em si, sem introdução nem comentário seu antes ou depois.`;

const MAX_FILE_BYTES = 15 * 1024 * 1024; // ~15MB raw, comfortably under typical inline-request caps once base64-encoded (~20MB).

const FILE_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Transcribes a slide/lecture file (PDF or image) into plain text via a
 * vision-capable call — the AI reads it as an actual document/image, so
 * text inside diagrams and figures comes through too, not just body text.
 * Returns text meant to land back in the same textarea generateCardsFromText
 * already reads from, for the person to review before generating cards. */
export const transcribeFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { file_base64: string; file_name: string }) => {
    const fileBase64 = input.file_base64?.trim();
    if (!fileBase64) throw new Error("Nenhum arquivo enviado.");

    // Rough size check on the base64 string itself (~4/3 the raw bytes) —
    // good enough to reject something way over the limit before spending a
    // call on it; the provider enforces the real cap either way.
    const approxBytes = (fileBase64.length * 3) / 4;
    if (approxBytes > MAX_FILE_BYTES) {
      throw new Error("Arquivo grande demais (máx. ~15MB). Divida o PDF em partes menores.");
    }

    const ext = (input.file_name?.split(".").pop() ?? "").toLowerCase();
    const mimeType = FILE_MIME_TYPES[ext];
    if (!mimeType) {
      throw new Error("Formato não suportado. Envie PDF, PNG, JPG ou WEBP.");
    }

    return { fileBase64, mimeType };
  })
  .handler(async ({ data }) => {
    const { text, truncated } = await callAiWithFile(
      TRANSCRIBE_SYSTEM,
      "Transcreva o conteúdo deste arquivo.",
      data.fileBase64,
      data.mimeType,
      // Gemini 3.6 Flash allows up to 65,536; Claude Sonnet 5 up to
      // 128,000. 32,000 leaves generous room under both — a 41-slide deck
      // with detailed diagram descriptions got cut off at 8,000, which is
      // what this replaces.
      32000,
    );
    return { text, truncated };
  });

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

const SUGGEST_MISSING_SYSTEM = `Você ajuda um estudante de medicina a achar lacunas no material de estudo dele, em português do Brasil.

Vai receber um texto-fonte (objetivos, slides, roteiro de PBL) e a lista de perguntas dos flashcards que ele já tem sobre esse assunto.

Sua tarefa: aponte só os pontos do texto-fonte que NÃO estão cobertos por nenhum flashcard existente, mesmo que a redação da pergunta exista seja diferente — o que importa é se o CONTEÚDO já está coberto. Para cada ponto faltante, sugira um flashcard novo.

Regras:
- Não repita nada que já tenha flashcard equivalente.
- Cada sugestão testa UM fato ou conceito.
- Se o material já está bem coberto, devolva uma lista vazia — não invente lacunas pra preencher espaço.

Responda APENAS com um array JSON, sem texto antes ou depois, no formato:
[{"ponto": "...", "pergunta": "...", "resposta": "..."}]`;

export const suggestMissingCards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deck_id: string; text: string }) => {
    const text = input.text?.trim();
    if (!input.deck_id?.trim()) throw new Error("Escolha um deck pra comparar.");
    if (!text) throw new Error("Cole o material (objetivos, slides...) pra comparar.");
    if (text.length < 40) throw new Error("O texto é curto demais.");
    if (text.length > 20000) throw new Error("Texto muito longo. Divida em partes menores.");
    return { deck_id: input.deck_id, text };
  })
  .handler(async ({ data, context }) => {
    // Cards live in subdecks (Imunologia::Problema 4::...), so comparing
    // against the chosen deck alone would miss most of what already exists
    // and suggest duplicates. Walk the whole subtree instead.
    const { data: allDecks } = await context.supabase
      .from("decks")
      .select("id,parent_id")
      .eq("user_id", context.userId);

    const childrenOf = new Map<string, string[]>();
    for (const d of allDecks ?? []) {
      if (!d.parent_id) continue;
      childrenOf.set(d.parent_id, [...(childrenOf.get(d.parent_id) ?? []), d.id]);
    }
    const deckIds: string[] = [];
    const stack = [data.deck_id];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || deckIds.includes(id)) continue;
      deckIds.push(id);
      stack.push(...(childrenOf.get(id) ?? []));
    }

    const { data: existing, error } = await context.supabase
      .from("cards")
      .select("pergunta")
      .in("deck_id", deckIds)
      .eq("user_id", context.userId)
      .is("deleted_at", null);
    if (error) throw new Error(error.message);

    const existingQuestions =
      (existing ?? []).map((c) => `- ${c.pergunta}`).join("\n") || "(nenhum card ainda neste deck)";

    const raw = await callAi(
      SUGGEST_MISSING_SYSTEM,
      `Texto-fonte:\n---\n${data.text}\n---\n\nFlashcards que já existem neste deck:\n${existingQuestions}`,
      6000,
    );

    const items = parseJsonArray(raw);
    const suggestions = items
      .map((item) => {
        const obj = item as Record<string, unknown>;
        return {
          ponto: String(obj["ponto"] ?? "").trim(),
          pergunta: String(obj["pergunta"] ?? "").trim(),
          resposta: String(obj["resposta"] ?? "").trim(),
        };
      })
      .filter((s) => s.pergunta && s.resposta);

    return { suggestions };
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