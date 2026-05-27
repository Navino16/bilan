# Bilan — project guide for Claude

Self-hosted, multi-user personal-finance app. ("Bilan" = French for "balance sheet".)

## Start here when resuming a session

1. **Roadmap & progress**: `PLAN.md` (phases → scopes). Progress is tracked by **GitHub issues**:
   - `gh issue list --state open` → remaining scopes
   - `gh issue list --state closed` → done
2. **Detailed plan for the current phase**: `docs/superpowers/plans/YYYY-MM-DD-phase-N-*.md` (TDD, step-by-step). Phase 0: `2026-05-27-phase-0-bootstrap.md`. Plans for later phases are written **just before** starting that phase.
3. **Full design spec**: `docs/superpowers/specs/2026-05-26-budget-app-design.md` (architecture, data model, security, etc.).
4. **Visual design (pixel-perfect reference)**: `design/` — the "Bilan" design system. `design/project/tokens.css` is the source for the shadcn theme.

## How a scope is executed (Git Flow)

- One scope = one GitHub issue = one branch `feature/<scope>` = one PR → `develop`.
- When the user says **"scope X.Y"**: cleanup (`git checkout develop && git pull`, delete merged branches), create `feature/X.Y-...`, implement per the detailed plan, run `npm run ci`, commit, push, open PR with `Closes #<issue>` in the body.
- When the user says **"c'est mergé"**: confirm the issue auto-closed, propose the next scope.
- Releases are **manual** (`git flow release`, user-driven). `main` = default branch; auto-close handled by `.github/workflows/close-issues-on-develop.yml`.

## Conventions

- **npm** (not pnpm). Node 24. Commits: 1-line English conventional (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`). No co-authored-by.
- Commits are **GPG-signed**; if signing fails, ask the user to unlock GPG (per their global CLAUDE.md).
- Code/tests/comments in **English**; UI strings in **fr/en** (next-intl).
- Business logic in `src/server/services/*` (pure, tested). Server Actions / Route Handlers are thin wrappers.
- Tests: Vitest (unit + integration) + Playwright (e2e). CI mirrors the `librarr` project (added in scope 0.6).

## Key commands

```bash
npm run dev          # dev server
npm run ci           # lint + typecheck + test (run before every PR)
npm run test:e2e     # Playwright
npm run setup        # generate .env, boot MariaDB, migrate + seed (after scope 0.2/0.3)
```

## Important notes

- Repo is **private** on a Free plan → no branch protection (ruleset saved in `scripts/github-ruleset.json` for if it goes public/Pro). Safeguards = Git Flow + CI.
- Bootstrap secrets stay in `.env` (`DATABASE_URL`, `AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `SEARCH_TOKEN_KEY`, `APP_URL`); everything else is configured in the app's admin UI.
