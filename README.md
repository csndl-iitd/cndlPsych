# expfw

Browser experiment framework (`expfw` is a placeholder name). Read `ARCHITECTURE.md`, then `BUILD_PLAN.md`; `CLAUDE.md` holds the standing rules and `spec/README.md` describes the schemas.

## Commands

    npm install
    npm run build:schemas   # spec/src -> spec/schema (generated; never hand-edit)
    npm run check:schemas   # fails if spec/schema is stale
    npm run lint            # ESLint, including the layer rules
    npm run check:layers    # independent import-layer check (CI)
    npm run typecheck       # custom-code examples against spec/types.d.ts
    npm test                # Vitest
    npm run test:browser    # Playwright (run `npx playwright install chromium` once)
    npm run ci              # everything except the browser tests

Status: M0 (repo and tooling). See `docs/decisions.md`.
