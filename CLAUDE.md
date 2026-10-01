# CLAUDE.md

Read `ARCHITECTURE.md` first, then `BUILD_PLAN.md`. Work one milestone at a time.

## Source of truth

- `spec/src/*.schema.yaml` and `spec/src/events.catalog.yaml` are the authoring format; `spec/schema/*.json` are generated. Never hand-edit generated files. If a schema must change, change `src`, regenerate, update examples and tests, and add a line to `docs/decisions.md`.
- `spec/types.d.ts` is the contract for custom tasks and stimulus generators. Type-check example custom code against it.
- `spec/examples/` is the acceptance fixture: it must always compile, and its events must always validate.
- If `ARCHITECTURE.md` and `spec/` disagree, `spec/` wins; fix the document in the same change.

## Hard rules

1. **Layers.** `foundation` imports nothing; `pipeline`, `storage`, `stage` import only `foundation`; `authoring` imports `foundation`; `runtime` wires everything. Enforce with an ESLint `no-restricted-imports` config plus a CI check; do not weaken it to make something compile.
2. **jsPsych** is imported only in `framework/pipeline/bridge.js` and `framework/authoring/modules/*`. Firebase SDK only (dynamic import) in `storage/firebase.js`. WebGazer only (lazy) in `pipeline/gaze.js`.
3. **No browser storage** (`localStorage`, `sessionStorage`) in the runtime. IndexedDB only inside `storage/local.js`.
4. **One bus, one clock.** Logging and triggers consume the bus only; never read jsPsych data for the log. Tasks and rules never attach DOM listeners.
5. **No `Math.random` in framework or task code**; use the seeded `rng` (types.d.ts).
6. **Vanilla JS + CSS**, ES modules, no framework, no TypeScript source (JSDoc + `tsc --checkJs` is fine). Source must read cleanly: small modules, named exports, short functions, comments explain why. No dead code, no commented-out blocks, no TODOs without an issue number.
7. **YAML:** load with a YAML 1.2 loader (js-yaml 4). A test must prove `on:` stays the string `"on"`.
8. **Users edit only YAML + index.html.** Anything that forces them to touch other files is a bug in the design; raise it instead of working around it.
9. **`keyboard_task` does not exist** (removed on purpose, no alias).
10. **Chunk and Firestore formats** follow `spec/firebase/DESIGN.md` and the reference codec `spec/tools/chunks.py`; port it with identical behaviour and share fixtures.

## Environment and honesty rules

- If a package registry or network call returns 403 or is blocked, stop and report it. Do not retry in loops, route around it, or substitute a fake implementation silently.
- The Firestore rules in `spec/firebase/` have **never been run**. Do not claim they work until the emulator matrix in DESIGN.md passes; fix the generator (`spec/tools/gen_rules.py`, later its ported version), not the generated files.
- Never claim timing accuracy you have not measured. Report measured numbers with the method.
- Do not mark a milestone done until its acceptance tests pass in CI and you have run them. State what was not tested (real hardware, real phones) explicitly.

## Working agreements

- Tests: Vitest for unit/integration; Playwright for browser (desktop + mobile emulation, touch); Firebase emulator for rules. Test files sit beside the code (`*.test.js`).
- Every public function of `foundation` has unit tests; `matcher.js` gets table-driven tests from the examples in the schemas.
- Small commits, conventional messages, one milestone per branch. Do not rewrite history.
- Ask before: renaming anything in `spec/`, adding a runtime dependency, changing a decided item in ARCHITECTURE.md, or changing a public YAML key.
- Dependencies allowed without asking: jsPsych (vendored), js-yaml, Ajv, WebGazer (lazy, vendored), Firebase JS SDK (dynamic), dev tools (Vitest, Playwright, ESLint, esbuild). Keep the shipped bundle free of anything else.
