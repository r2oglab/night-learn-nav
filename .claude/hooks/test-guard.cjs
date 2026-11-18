// Testa o guard.cjs com payloads simulados de PreToolUse.
// Uso (na raiz do projeto ou de qualquer lugar): node .claude/hooks/test-guard.cjs
const { execFileSync } = require("child_process");
const path = require("path");

const P = path.resolve(__dirname, "..", ".."); // raiz do projeto
const G = path.join(__dirname, "guard.cjs");

const f = (tool, rel) => ({ tool_name: tool, tool_input: { file_path: path.join(P, rel) } });
const c = (tool, command) => ({ tool_name: tool, tool_input: { command } });

const cases = [
  ["Edit .env", f("Edit", ".env"), "deny"],
  ["Edit routeTree.gen.ts", f("Edit", "src/routeTree.gen.ts"), "deny"],
  ["Write bun.lock", f("Write", "bun.lock"), "deny"],
  ["Edit package-lock.json", f("Edit", "package-lock.json"), "deny"],
  ["Edit migration existente", f("Edit", "supabase/migrations/20260831000000_deck_archive.sql"), "deny"],
  ["Write migration nova", f("Write", "supabase/migrations/20991118000000_nova.sql"), "allow"],
  ["Edit src/lib/fsrs.ts", f("Edit", "src/lib/fsrs.ts"), "allow"],
  ["Edit .env.example", f("Edit", ".env.example"), "allow"],
  ["git push --force", c("Bash", "git push --force origin main"), "deny"],
  ["git push -f (PowerShell)", c("PowerShell", "git push -f"), "deny"],
  ["git push --force-with-lease", c("Bash", "git push --force-with-lease"), "deny"],
  ["git push origin +main", c("Bash", "git push origin +main"), "deny"],
  ["git commit --amend", c("Bash", "git add . && git commit --amend --no-edit"), "deny"],
  ["git -C . rebase main", c("Bash", "git -C . rebase main"), "deny"],
  ["commit + git push", c("Bash", 'git commit -m "feat: x" && git push'), "ask"],
  ["git push --follow-tags", c("Bash", "git push --follow-tags"), "ask"],
  ["git status", c("Bash", "git status"), "allow"],
  ["grep rebase src", c("Bash", "grep -r rebase src"), "allow"],
];

let fail = 0;
for (const [name, input, want] of cases) {
  const out = execFileSync("node", [G], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: P },
  }).toString();
  const got = out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow";
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name.padEnd(32)} -> ${got}${ok ? "" : ` (esperado ${want})`}`);
}
console.log(fail ? `${fail} falha(s)` : `todos os ${cases.length} passaram`);
process.exit(fail ? 1 : 0);
