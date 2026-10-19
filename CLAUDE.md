# Bilan — project guide for Claude

Self-hosted, multi-user personal-finance app. ("Bilan" = French for "balance sheet".)

## Start here when resuming a session

1. **Work**: tracked by **GitHub issues**, one issue per change: `gh issue list --state open`.
2. **Architecture**: `docs/architecture.md` (stack, data model, key flows, security, deployment). Code comments cite its sections as `spec §N`.
3. **Visual design (pixel-perfect reference)**: `design/` — the "Bilan" design system. `design/project/tokens.css` is the source for the shadcn theme.
4. **User-facing docs**: `docs/user-guide*.md`, `docs/admin-guide*.md`, `docs/self-hosting*.md` (en + fr). Keep them and their screenshots in sync with UI changes (`npm run docs:screenshots`, see `docs/development.md`).

## How a change is executed (Git Flow)

- One issue = one branch `feature/<n>-<slug>` = one PR → `develop`.
- Larger work is designed and planned before coding (superpowers brainstorming / writing-plans); those plans stay out of the repo, the issue holds the goal and acceptance criteria.
- Cleanup (`git checkout develop && git pull`, delete merged branches), create the branch, implement, run `npm run ci`, commit, push, open the PR with `Closes #<n>` and a type label.
- The `Main/Develop` ruleset requires green CI + CodeQL before merging. When the user says **"c'est mergé"**: confirm the issue auto-closed, propose the next one.
- Releases are **manual** (`git flow release`, user-driven). `main` = default branch; auto-close handled by `.github/workflows/close-issues-on-develop.yml`.

## Conventions

- **npm** (not pnpm). Node 24. Commits: 1-line English conventional (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`). No co-authored-by.
- Commits are **GPG-signed**; if signing fails, ask the user to unlock GPG (per their global CLAUDE.md).
- Code/tests/comments in **English**; UI strings in **fr/en** (next-intl).
- Business logic in `src/server/services/*` (pure, tested). Server Actions / Route Handlers are thin wrappers.
- Tests: Vitest (unit + integration) + Playwright (e2e). CI mirrors the `librarr` project (`docs/architecture.md` §7.6).

## Key commands

```bash
npm run dev          # dev server
npm run ci           # lint + typecheck + test (run before every PR)
npm run test:e2e     # Playwright
npm run setup        # generate .env, boot MariaDB, migrate + seed
npm run db:seed-dev  # demo user dev@bilan.local / dev-password-123, 12 months of data (-- --reset to rebuild)
```

## Important notes

- Repo is **public**. The `Main/Develop` ruleset (managed in the GitHub settings) requires a PR, squash merge, linear history and green CI + CodeQL checks; no approval needed.
- Bootstrap secrets stay in `.env` (`DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `APP_URL`); everything else is configured in the app's admin UI.
