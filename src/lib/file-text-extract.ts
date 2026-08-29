import mammoth from "mammoth";

// Matches the server-side cap in ai.functions.ts (generateCardsFromText /
// suggestMissingCards both reject text over this length) — trimming here
// avoids sending something the server will just reject anyway.
const MAX_TEXT_LENGTH = 20000;

export type ExtractResult = { text: string; truncated: boolean };

/**
 * Extracts plain text from a .txt or .docx file, entirely client-side — no
 * server round-trip needed just to read a file.
 *
 * PDF isn't supported yet: real PDF text extraction needs a worker-thread
 * library (pdf.js) whose setup is easy to get subtly wrong in a bundler
 * without a live environment to verify it actually loads — safer to ship
 * .docx/.txt now (which covers most real study material — Word exports,
 * plain notes) than guess at a PDF pipeline that might silently fail.
 */
export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();

  let text: string;
  if (name.endsWith(".docx")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    text = result.value;
  } else if (name.endsWith(".txt") || name.endsWith(".md")) {
    text = await file.text();
  } else if (name.endsWith(".pdf")) {
    throw new Error(
      'PDF ainda não é suportado aqui — converte pra .docx ou .txt antes (Word e Google Docs fazem isso em "Salvar como"/"Fazer download").',
    );
  } else if (name.endsWith(".doc")) {
    throw new Error(
      "Esse é o formato antigo do Word (.doc) — resalva como .docx (Word atual) antes de enviar.",
    );
  } else {
    throw new Error("Formato não suportado. Envie um arquivo .docx ou .txt.");
  }

  text = text.trim();
  if (!text) {
    throw new Error(
      "Não consegui tirar texto desse arquivo — pode estar vazio ou ser conteúdo escaneado/imagem.",
    );
  }

  const truncated = text.length > MAX_TEXT_LENGTH;
  return { text: truncated ? text.slice(0, MAX_TEXT_LENGTH) : text, truncated };
}