# expfw

Browser experiment framework (`expfw` is a placeholder name). Experimenters write four YAML files and an `index.html`; the framework runs the session, logs every event on one clock, sends triggers, stores the data locally and optionally in Firebase, and exports BIDS.

## Make an experiment

    npm install
    npx playwright install chromium      # once; only needed for dry-run and the browser tests
    npm run build                        # bundles the framework into dist/expfw
    node cli/expfw.js init my-study      # a working template + the bundled framework
    node cli/expfw.js validate my-study  # check the YAML (file, path and message for every problem)
    node cli/expfw.js dry-run my-study   # play it with a synthetic participant and print what happened
    node cli/expfw.js serve my-study     # open http://localhost:8080 (add ?manage=1 for stored sessions)
    node cli/expfw.js deploy my-study    # Firebase Hosting (+ Firestore rules); log in with firebase-tools first

Edit `experiment.yaml`, `stimuli.yaml`, `timeline.yaml`, `forms.yaml`, `consent.md`; `expfw/` is the bundled framework and is never edited. Every setting is documented in `docs/yaml/` (generated from the schemas). The same commands are available as `expfw <command>` once the package is installed (`bin`).

Other commands: `expfw migrate <dir>` (spec_version), `expfw export-firestore ...` (BIDS from Firestore), `expfw relay ...` (WebSocket to serial; see `docs/triggers.md`).

## Developing the framework

    npm run build:schemas   # spec/src -> spec/schema (generated; never hand-edit)
    npm run check:schemas   # fails if the schemas, the Firestore rules or docs/yaml are stale
    npm run lint            # ESLint, including the layer rules
    npm run check:layers    # independent import-layer check (CI)
    npm run typecheck       # custom-code examples against spec/types.d.ts
    npm test                # Vitest
    npm run test:browser    # Playwright (desktop, phone and tablet emulation)
    npm run test:emulator   # Firestore rules and client against the Firestore emulator (downloads a JRE and the emulator into .tools/)
    npm run timing          # software-only timing measurements into docs/timing.md
    npm run play            # serve the example for manual testing (http://localhost:4173/)
    npm run ci              # everything except the browser and emulator tests

Read `ARCHITECTURE.md`, then `BUILD_PLAN.md`; `CLAUDE.md` holds the standing rules, `spec/README.md` describes the schemas, `docs/decisions.md` records every decision and what was not verified, and `docs/timing.md` says what is known about timing.

Status: M10 (bundle, CLI, docs, timing). Not yet: the VS Code extension (M11).
