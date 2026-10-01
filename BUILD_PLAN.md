# Build plan

Each milestone lists scope, what to build, and acceptance tests. A milestone is done only when every test passes in CI. Order follows dependencies; M1-M3 are the critical path, M4 onward can partly overlap.

## M0. Repo and tooling

- Init repo, workspace layout from ARCHITECTURE.md, ESLint with layer rules, Vitest, Playwright, esbuild, CI.
- Port `spec/tools/build.py` (src -> schema, YAML 1.2, `x-*` stripping, events builder) and `validate.py` to Node, keeping the same checks (55+ cases and the Firestore/chunk section). Keep the Python files as reference until output is byte-identical, then delete them.
- **Accept:** `npm run build:schemas` reproduces `spec/schema/*.json` identically; `npm test` runs the ported validator with all cases passing; layer-lint fails on a deliberately bad import (test it); `on:` stays a string.

## M1. Compiler and cascade (authoring)

- `authoring/spec.js` (load + schema validation with Ajv, error messages with file and YAML path), `compiler.js` (expand `each`, resolve cascade for `input:` and `triggers:`, build compiled plan), `cli validate`.
- Implement every check in `spec/README.md` "Checks the schemas cannot express". Resolve `disable`, `reset`, merge by id, `stim:` rule ids, inline `trigger:` compilation.
- **Accept:** `spec/examples/` compiles with zero errors; a table of at least 40 invalid projects, one per check, each fails with the expected code, file and path; golden test of the resolved scope for the visual-search block on desktop and phone (touch override applies, `stim:fixation_plus` overridden); coverage check catches an intent with no binding for an allowed profile; property test: resolution is idempotent.

## M2. Foundation runtime

- `clock`, `events` (envelope + dev validation against `event.schema.json`), `matcher`, `session`, `device`.
- **Accept:** seq is gap-free and strictly increasing; `matcher` passes table tests for every predicate operator, glob, `all/any/not`, and sequence patterns (`distinct_by`, `within`, `unordered`); `events.sample.jsonl` replays through the bus and validates; device detection tested via Playwright emulation (desktop, phone, tablet) and the `allowed`/rejection path writes `device_rejected`.

## M3. Input pipeline + jsPsych bridge

- `stage`, `cursor`, `input.js` (normalization, stage coordinates, `trusted`), gesture recognizer (tap, longpress, swipe, drag), `mapping.js`, `bridge.js`.
- **Accept (Playwright, desktop + mobile emulation):** stage coordinates correct under letterboxing and resize; synthetic taps/swipes/longpress produce the documented event fields and `all_trusted`; cursor hides after 1 s and returns on movement; the two-target-then-SPACE (desktop) / two-taps (phone) visual-search case ends the trial through the same intent; an unmodified `jspsych-html-keyboard-response` receives injected keys; no pointer events are logged for desktop key presses; no raw listeners exist outside `input.js` (grep test).

## M4. Built-in modules

- `response_task` (all keys in `module-response-task.schema.json`: sequence, response window, `on_response`, timeout, correct, feedback, post, repetitions, `applies_to`, conditions, `design`), `survey` (forms.yaml), `instructions`, built-in `subject`/`session`/consent screens.
- **Accept:** the example oddball, flashes and visual-search blocks run end to end in Playwright with scripted input; trial numbers 1-based; `phase.onset/offset` emitted per phase with `stimulus` field; consent gate persists nothing before acceptance; `session.start` is the first persisted event; `min_age` enforced.

## M5. Triggers and relay

- `triggers.js`, sinks (serial, websocket, usb), formats (raw/ndjson/template), `reset_after_ms`, `ack`, `required` semantics, `trigger.sent/dropped`, `sink.status/sync`; `cli relay`.
- **Accept:** fake-port tests for exact bytes (including hex template and reset byte); websocket integration test with the relay against a virtual serial pair; two sinks fire from one rule; required sink failure blocks the session, optional one warns; `once`, `priority`, `allow_multiple`, `{from}` and `{map}` values; same-value-different-meaning and out-of-range values rejected at compile time (M1).
- **Not testable here without hardware:** real EEG amplifiers. Provide a loopback test procedure in `docs/`.

## M6. Local storage and recovery

- IndexedDB log, recovery offer on reload, JSONL export, download on finish.
- **Accept:** kill the tab mid-session (Playwright), reload, recover with no event loss up to the last flush and `seq` continuity; session record validates against `session.schema.json`; nothing stored before consent.

## M7. Firebase

- `storage/firebase.js` (dynamic SDK import, anonymous/Google auth, claims allocator for both modes, chunk writer with idempotent retry and flush policy, session finalization), port `gen_rules.py` and `chunks.py`.
- **Accept (emulator, blocking):** all 23 cases in `spec/firebase/DESIGN.md` pass; fix the generator for any failure and record which assumptions (`string(int)`, `existsAfter/getAfter`, `diff().affectedKeys()`) held. Concurrency test: 50 parallel public allocators get unique contiguous numbers. Crash test: kill mid-session, chunks present, session `in_progress`, export flags it partial. Chunk codec parity test against `spec/examples/firestore.sample.json`.

## M8. Export

- `storage/export.js`, `cli export-firestore`, BIDS writer.
- First decide the BIDS version target and the `sex` enum (open decision 4) and record it.
- **Accept:** same BIDS output from a local session and the same session read from the emulator; integrity report catches missing/duplicate chunks and seq gaps; run `bids-validator` on the output of the example project and report the result (including warnings).

## M9. Eye tracking

- `gaze.js`: lazy WebGazer, camera consent, calibration + validation screens, chunked `gaze.samples`, lost/regained, dwell.
- **Accept:** disabled by default and loads nothing when off (network test); enabling adds the consent statement; restricted to `eyetracking.profiles`; sample chunks respect the chunk byte limit; validation accuracy reported in the session record. Real accuracy is not claimed beyond what is measured.

## M10. Timing harness and polish

- Measurement page and procedure: photodiode overlay vs trigger edge vs recorded `t`; report distribution (median, p95, max) per device class. Overlay (AprilTags, photodiode) finalized here.
- `cli dry-run`, `cli serve`, `cli deploy`, `cli migrate`, user docs (one page per YAML file, generated from the schemas), bundle into the user-facing folder.
- **Accept:** a documented, reproducible latency report; a fresh user can create a working experiment from the template using only YAML + `index.html`.

## M11. VS Code extension

- Bind schemas to the four files, run the compiler for diagnostics with YAML-path positions, completion for stimulus/intent/rule ids, dry-run command, preview.
- **Accept:** diagnostics match `cli validate` exactly on the invalid-project table from M1.

## Definition of done (every milestone)

Tests pass in CI; layer-lint clean; `spec/` and ARCHITECTURE.md updated if anything changed; `docs/decisions.md` records deviations; a short "not verified" list is written (hardware, real phones, anything run only in emulation).
