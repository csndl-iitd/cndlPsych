# cndlpsych

Browser experiment framework (cndlpsych). Experimenters write four YAML files and an `index.html`; the framework runs the session, logs every event on one clock, sends triggers, stores the data locally and optionally in Firebase, and exports BIDS.

## Make an experiment

    npm install
    npx playwright install chromium      # once; only needed for dry-run and the browser tests
    npm run build                        # assembles dist/cndlpsych (readable source + vendor code) and dist/cndlpsych-eyetracking
    node cli/cndlpsych.js init my-study      # a working template + the bundled framework
    node cli/cndlpsych.js validate my-study  # check the YAML (file, path and message for every problem)
    node cli/cndlpsych.js dry-run my-study   # play it with a synthetic participant and print what happened
    node cli/cndlpsych.js serve my-study     # open http://localhost:8080 (add ?manage=1 for stored sessions)
    node cli/cndlpsych.js deploy my-study    # Firebase Hosting (+ Firestore rules); log in with firebase-tools first

Edit `experiment.yaml`, `stimuli.yaml`, `timeline.yaml`, `forms.yaml`, `consent.md`; `cndlpsych/` is the bundled framework and is never edited. Every setting is documented in `docs/yaml/` (generated from the schemas). The same commands are available as `cndlpsych <command>` once the package is installed (`bin`).

Other commands: `cndlpsych migrate <dir>` (spec_version), `cndlpsych export-firestore ...` (BIDS from Firestore), `cndlpsych relay ...` (WebSocket to serial; see `docs/triggers.md`).

Webcam recording is a setting (`webcam:` in experiment.yaml, commented out in the template): the video is written to a file on disk (Chrome, Edge) or downloaded separately, never into the exported zip and not to Firebase.

Eye tracking is an add-on: `node cli/cndlpsych.js init my-study --eyetracking` also copies `cndlpsych-eyetracking/` (WebGazer, GPL-3.0-or-later; see `LICENSE-eyetracking.md`). Without eye tracking nothing GPL is involved.

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

## Licence

MIT (`LICENSE`); the eye tracking add-on is GPL-3.0-or-later (`LICENSE-eyetracking.md`). The bundled folders carry `THIRD-PARTY-LICENSES.txt`.
