# expfw

Browser experiment framework (`expfw` is a placeholder name). Read `ARCHITECTURE.md`, then `BUILD_PLAN.md`; `CLAUDE.md` holds the standing rules and `spec/README.md` describes the schemas.

## Commands

    npm install
    npm run build:schemas   # spec/src -> spec/schema (generated; never hand-edit)
    npm run check:schemas   # fails if spec/schema is stale
    npm run lint            # ESLint, including the layer rules
    npm run check:layers    # independent import-layer check (CI)
    npm run validate -- <dir> # compile a project folder (e.g. spec/examples) and print diagnostics
    npm run play            # serve the example for manual testing (open http://localhost:4173/)
    node cli/relay.js ...   # websocket-to-serial relay for trigger sinks (see docs/triggers.md)
    npm run typecheck       # custom-code examples against spec/types.d.ts
    npm test                # Vitest
    npm run test:browser    # Playwright (run `npx playwright install chromium` once)
    npm run ci              # everything except the browser tests

Status: M6 (local storage and recovery). See docs/triggers.md for trigger sinks. See `docs/decisions.md`.
