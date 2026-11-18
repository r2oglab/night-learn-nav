#!/usr/bin/env node
// PreToolUse guard: bloqueia edições em arquivos protegidos e comandos git
// que reescrevem histórico; pede confirmação antes de qualquer git push.
// Lê o JSON do hook no stdin e responde com hookSpecificOutput.permissionDecision.
"use strict";

const fs = require("fs");
const path = require("path");

function respond(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function norm(p) {
  let s = p.replace(/\\/g, "/");
  if (process.platform === "win32") s = s.toLowerCase();
  return s;
}

// ---------- arquivos ----------
function checkFile(input, projectDir) {
  const raw = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (!raw) return;
  const abs = path.resolve(projectDir, raw);
  const rel = norm(path.relative(projectDir, abs));
  if (rel.startsWith("..")) return; // fora do projeto: não é com este hook
  const base = rel.split("/").pop();

  if (base === ".env" || (/^\.env\./.test(base) && base !== ".env.example")) {
    respond("deny", `Bloqueado: ${rel} contém segredos e não pode ser editado pelo Claude.`);
  }
  if (rel === "src/routetree.gen.ts" || rel === "src/routeTree.gen.ts") {
    respond("deny", "Bloqueado: src/routeTree.gen.ts é gerado pelo TanStack Router. Edite as rotas em src/routes/.");
  }
  if (rel === "bun.lock" || rel === "package-lock.json") {
    respond("deny", `Bloqueado: ${rel} é lock file. Use o gerenciador de pacotes (npm/bun install) em vez de editar à mão.`);
  }
  if (rel.startsWith("supabase/migrations/") && fs.existsSync(abs)) {
    respond(
      "deny",
      `Bloqueado: ${rel} é uma migration já existente (provavelmente já aplicada). Crie uma NOVA migration com timestamp atual em vez de alterar esta.`,
    );
  }
}

// ---------- git ----------
// Divide em segmentos por ; && || | e quebras de linha, e acha o subcomando git
// pulando opções globais (-C dir, -c k=v, --git-dir=..., etc.).
function gitInvocations(cmd) {
  const out = [];
  for (const seg of cmd.split(/;|&&|\|\||\||\r?\n/)) {
    const toks = seg.trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i].replace(/^["']|["']$/g, "");
      if (!/(^|[\\/])git(\.exe)?$/i.test(t)) continue;
      let j = i + 1;
      while (j < toks.length && toks[j].startsWith("-")) {
        if (/^(-C|-c|--git-dir|--work-tree|--namespace)$/.test(toks[j])) j += 2;
        else j += 1;
      }
      if (j < toks.length) out.push({ sub: toks[j], args: toks.slice(j + 1) });
      break;
    }
  }
  return out;
}

function checkCommand(input) {
  const cmd = input.tool_input?.command;
  if (typeof cmd !== "string") return;
  let wantsAsk = false;
  for (const { sub, args } of gitInvocations(cmd)) {
    if (sub === "rebase") {
      respond("deny", "Bloqueado: git rebase reescreve histórico (o Lovable perde o histórico do projeto). Use merge ou um novo commit.");
    }
    if (sub === "commit" && args.some((a) => a === "--amend")) {
      respond("deny", "Bloqueado: git commit --amend reescreve histórico. Crie um novo commit.");
    }
    if (sub === "push") {
      const force = args.some(
        (a) =>
          a === "-f" ||
          a === "--force" ||
          a.startsWith("--force-with-lease") ||
          a === "--force-if-includes" ||
          a === "--mirror" ||
          (/^-[a-z]+$/i.test(a) && a.includes("f")) ||
          /^\+/.test(a),
      );
      if (force) respond("deny", "Bloqueado: push forçado reescreve histórico no Lovable.");
      wantsAsk = true;
    }
  }
  if (wantsAsk) {
    respond("ask", "git push sincroniza com o Lovable. Confirme antes de enviar.");
  }
}

let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (data += c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(data || "{}");
  } catch {
    process.exit(0);
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const tool = input.tool_name;
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) checkFile(input, projectDir);
  if (tool === "Bash" || tool === "PowerShell") checkCommand(input);
  process.exit(0);
});
