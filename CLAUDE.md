# night-learn-nav — convenções do projeto

App de flashcards com repetição espaçada (FSRS). Stack: TanStack Start + React 19 + TypeScript, Tailwind 4 + shadcn/Radix, Supabase.

## Lovable (crítico)

- O branch `main` está conectado ao Lovable: todo push sincroniza com o editor de lá.
- **Nunca reescreva histórico já enviado**: nada de `git push --force`, `git commit --amend`, `git rebase` ou squash em commits publicados. O usuário perde o histórico no Lovable.
- Mantenha o branch sempre em estado funcional (build passando) antes de qualquer push.
- Só faça commit/push quando o usuário pedir.

## Commits

- Mensagens em **português**, no formato Conventional Commits: `feat: ...`, `fix: ...` (também `refactor:`, `chore:` quando fizer sentido).
- Descreva o efeito para o usuário, ex.: `fix: apkg - oclusao de imagem do Anki vira oclusao nativa`.

## Código

- Server functions ficam em arquivos `*.functions.ts` (em `src/lib/`), ex.: `cards.functions.ts`, `decks.functions.ts`.
- `src/routeTree.gen.ts` é gerado automaticamente — não edite; altere as rotas em `src/routes/`.
- Não edite `.env`, `bun.lock` nem `package-lock.json` à mão.

## Segurança: filtros PostgREST

- **Valide como UUID todo ID vindo do usuário antes de interpolá-lo em filtros PostgREST** (`.or(...)`, `.filter(...)`, strings montadas). Interpolar sem validar permite injeção no filtro (já corrigido em `listCardLinks`).
- Prefira os métodos tipados (`.eq`, `.in`) a montar strings de filtro.

## Migrations (Supabase)

- **Nunca altere uma migration já existente/aplicada** em `supabase/migrations/`. Toda mudança de schema vai em uma **nova** migration.
- Nome: `YYYYMMDDHHMMSS_descricao_curta.sql` (timestamp maior que o da última migration).
- Tabelas com dados do usuário precisam de RLS por `user_id`.
- **Entrega obrigatória**: além do arquivo em `supabase/migrations/`, salve uma cópia **só com o SQL** como `.txt` em `C:\Users\Texugo\Downloads\Claude\` (mesmo nome base, ex.: `20261118000000_minha_mudanca.txt`). O usuário roda esse SQL manualmente no Lovable. Crie a pasta se não existir e informe o caminho completo ao terminar.
