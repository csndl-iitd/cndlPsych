# Architecture

`expfw` is a placeholder name. This document is the contract between design and implementation. `spec/` holds the machine-readable half (JSON Schemas, event catalog, `types.d.ts`, examples, Firestore rules and design). When this file and `spec/` disagree, `spec/` wins and this file gets fixed.

Status words used below: **decided** = the author said so; **intent** = proposed design that follows from decisions but was not explicitly confirmed. Intent items may be changed with a note in `docs/decisions.md`.

## 1. Goals

Cognitive-neuroscience experiments that run in a browser on monitors and phones, authored without code, with jsPsych doing trial sequencing and plugins.

1. **Code-free authoring (decided).** Researchers edit `experiment.yaml`, `forms.yaml`, `stimuli.yaml`, `timeline.yaml` (+ `consent.md`, assets) and `index.html`. Nothing else is exposed.
2. **One event model (decided).** Every input, phase onset, response and trigger is an event on one bus with one clock, independent of jsPsych. Logging and triggers consume that bus only.
3. **Device-specific response mapping (decided).** Monitor: spot two targets, press SPACE. Phone: tap the targets. Mapping is per block / task, not global.
4. **Hardware triggers (decided).** Several sinks at once: serial (raw bytes or text), websocket (text), usb. Rules table maps events to values.
5. **Optional Firebase, fully local mode (decided).** Local recoverable log always available. Firebase for hosting and large-scale logging.
6. **Export separate from storage (decided).** BIDS export must work from Firestore directly.
7. **Escape hatch (decided).** Custom tasks, stimulus generators and jsPsych plugins, in a ladder so most "custom" needs stay in YAML.
8. Later: VS Code extension (schemas, validation, preview, dry-run).

Non-goals: Web Bluetooth; chip-specific trigger adapters (the framework only pushes bytes or strings); a GUI builder; npm packages per module.

## 2. Packaging

One library, many module files (decided). Source in `framework/`, bundled for users into a single folder next to `index.html`. A `cli` (Node) and later `vscode-ext` live in the same repo.

```
framework/
  foundation/   clock.js events.js matcher.js session.js device.js
  pipeline/     input.js gaze.js mapping.js triggers.js bridge.js
  storage/      local.js firebase.js export.js
  stage/        stage.js overlay.js cursor.js
  authoring/    spec.js compiler.js modules/{response-task,survey,instructions}.js
  runtime/      boot.js services.js session/ (run-session.js and the steps of a session)
cli/            relay, export-firestore, validate, dry-run, serve, deploy, migrate
vscode-ext/     later
spec/           schemas, types.d.ts, examples, firebase/
```

Layer rules (enforced by lint, see CLAUDE.md): `foundation` imports nothing. `pipeline`, `storage`, `stage` import only `foundation`. `authoring` imports `foundation`. `runtime` wires everything. jsPsych is imported only in `pipeline/bridge.js` and `authoring/modules/*`. The Firebase SDK is dynamically imported inside `storage/firebase.js` only. WebGazer is lazy-loaded inside `pipeline/gaze.js` only. Nothing in `framework/` touches `window.localStorage`.

## 3. Foundation

- **clock.js**: one monotonic clock (`performance.now()` origin) plus a wall-clock anchor recorded in `session.clock_anchor`. Every event has `t` (ms since origin) and `seq` (gap-free integer from 0). Frame-aligned stamps for visual onsets come from a `requestAnimationFrame` callback after the paint that shows the stimulus (intent; document measured error in the session record).
- **events.js**: synchronous bus. Envelope and per-type data schemas come from `spec/schema/event.schema.json` (generated from `spec/src/events.catalog.yaml`). In dev builds every emit is validated; in production only the envelope. Namespaces: framework types from the catalog, plus `task.*` (emitted by tasks) and `semantic.*` (emitted by rules). Events carry `caused_by` (seq of the cause) where meaningful.
- **matcher.js**: the one predicate/pattern engine used by input rules and trigger rules. Implements `predicate` (equality, list membership, operators, globs, `all/any/not`) and `pattern` (single step or `sequence` with `distinct_by`, `within`, `unordered`) from `common.schema`. Pure, no DOM, exhaustively unit-tested.
- **session.js**: session record (`session.schema.json`), ids, consent gate, collected subject/session answers, `capture_url_params`.
- **device.js**: profile detection (`desktop`, `phone`, `tablet`, custom), `device.select: auto|ask|fixed`, `allowed`, rejection path (`status: device_rejected`).

## 4. Stage and coordinates

(decided) All pointer geometry is relative to a letterboxed **stage element** (`stage.aspect`: fixed ratio or `fill`). Stage coordinates are normalized 0-1, origin top-left. Bare lengths in YAML are fractions of the stage's shorter side; `px` is CSS pixels; `mm`/`deg` need calibration (`device.calibration`), and the compiler errors when they are used without it. Raw events carry `trusted` (`isTrusted`); gesture events carry `all_trusted`. Hit targets are DOM elements registered by `data-role` / `data-id` (stimulus generators and built-in stimuli do this automatically); `hit_padding` expands touch hit areas.

`stage/cursor.js`: pointer hides after `autohide_ms` (default 1000) without movement and reappears after `show_on_move_px`. No pointer logging on desktop keypresses (decided): pointer events are recorded only where the input scope asks for them.

`stage/overlay.js`: optional AprilTags in the four corners (family, ids, size; for later video-based timing/geometry) and a photodiode patch (corner, size) flashed with `phase.onset`.

## 5. Input pipeline

```
raw DOM events  ->  input.js (normalize, stage coords, trusted)  ->  bus
                    gaze.js  (WebGazer samples, dwell, calibration) ->  bus
bus input.*  ->  mapping.js (resolved rules, per block/trial)  ->  semantic.* / intent / key injection
intent / key ->  bridge.js (jsPsych extension)                 ->  jsPsych plugin sees a KeyboardEvent
```

- `input.js` attaches listeners once, at the stage. Tasks and rules never attach listeners (types.d.ts `Bus.on` only).
- Gesture recognizer produces `tap`, `longpress` (start/end, duration), `swipe` (direction, distance, velocity), `drag` (start/end/cancel, optional path). Thresholds and `fire_on` come from the input scope. A mouse click is a tap.
- **Intents** are semantic response names (`go`, `target_found`, `left`...). `any` and `none` are built in. An intent has per-profile **bindings**: `key`, `tap` (optionally a region or target selector), `swipe`, `longpress`. Shorthand: `desktop: {key: f}`, `phone: {tap: {x: [0, 0.5]}}`.
- **Rules** are the general mechanism for what bindings cannot express: `match` (a `pattern`, so a sequence such as "tap two distinct targets within 5 s") plus `emit` (`intent`, custom `event`, raw `key`, `end_trial`, visual `effect`). Example from the design: phone taps on two different targets -> `semantic.search_complete` -> `end_trial`; desktop SPACE -> same intent.
- `mapping.js` consumes the **already-resolved** scope for the current block/trial. It does no merging at runtime.
- **bridge.js** (jsPsych extension, not a plugin): on trial start it exposes the intent set to the trial; when an intent fires it dispatches a synthetic `KeyboardEvent` that unmodified jsPsych keyboard plugins handle (the key is internal unless `plugin_key` overrides). It records `jspsych.trial.start/load/end` and `bridge.key_injected` to the bus. jsPsych's own timing is never the source of truth for the log.
- **gaze.js** (decided: WebGazer, toggled in `eyetracking.enabled`, restricted by `eyetracking.profiles`): lazy-loaded; camera consent statement auto-added; calibration and validation before blocks; emits `gaze.samples` (chunked), `gaze.lost/regained`, `input.gaze.dwell`. Implemented in M9: calibration is by fixation (a timed dot, no clicks), validation reports mean error and scatter in px, re-validation happens at block boundaries, and the screens/flow are in `runtime/eyetracking.js`. See `docs/decisions.md`.

## 6. Cascade

(decided) The same cascade for `input:` and `triggers:`:

```
framework defaults < task-module defaults < experiment.yaml < block < trial
```

Merge by id (intent id, profile key, rule id). `disable: [ids]` is a sibling key of `rules`, not a list entry. `reset: true` on a scope discards everything inherited. Resolution happens **at compile time**, producing a flat resolved scope per trial; the runtime never walks the cascade. `stim:<name>` is the reserved rule id for an inline `trigger:` on a stimulus, so blocks can override or disable it. Trigger **sinks** are session-wide and live only in `experiment.yaml`.

## 7. Triggers

`triggers.js` subscribes to the bus and evaluates the resolved rules (`on`, `where`, `value` as int / `{from: field}` / `{map: ...}`, `sinks`, `once`, `priority`, `allow_multiple`). A matched rule produces a `trigger.sent` (or `trigger.dropped` with a reason) event carrying `value`, the causing event's `t`, and the time it was handed to the sink.

Sinks (several at once, decided): `serial` (Web Serial), `websocket`, `usb` (WebUSB). Formats (`format` is mandatory):

- `raw`: bytes written as-is to the port, `value` as a byte (0-255) through the sink's `template` (e.g. `"{value:02x}"` for hex). No chip-specific logic: just push bytes. Optional `reset_after_ms` writes a zero byte after the pulse.
- `ndjson`: one JSON object per line with selected `fields` (seq, value, event, t_event, t_sent, trial, stimulus, ...).
- `template`: a string with `{field}` substitution, interpreted by the receiver; same formats for websocket.

Source timestamps and metadata travel with text formats (decided). `required` defaults to true: a required sink failing to connect blocks the session at "connect trigger sinks"; `required: false` (e.g. a lab websocket) degrades to a warning plus `sink.status`. `ack: true` records round trips as `sink.sync`. The **relay CLI** is a small local server that bridges a websocket to a physical serial port/other protocol for setups where the browser cannot reach the device directly.

## 8. Authoring: compile and run

**compile (authoring/compiler.js, also in cli validate):** load the four YAML files with a YAML 1.2 loader (js-yaml 4; `on` must stay a string key), validate each against `spec/schema/*.json` (Ajv, draft-07), expand `each`, resolve the cascade, then run the cross-file checks listed in `spec/README.md` ("Checks the schemas cannot express"). Output: one compiled plan object: trials, resolved input/trigger scopes per block/trial, stimulus store, sinks. Errors carry file, YAML path and a human message; the same engine powers the VS Code extension.

**Built-in modules** (`authoring/modules/`): `response_task` (generic keyboard/touch response trials; replaces the old `keyboard_task`, which is removed with no alias), `survey` (forms.yaml), `instructions`. Each builds a jsPsych timeline from its config and uses the bridge for responses.

**Customization ladder (decided):**

| Level | What | Where |
|---|---|---|
| L0 | YAML only | the four files |
| L1 | stimulus generator (JS returning `html` + `data`, with data-role/id) | `custom/stimuli/*.js` |
| L2 | custom task (`build(ctx)` returning phases; modeled on the old `visual_search.js`) | `custom/tasks/*.js` |
| L3 | custom jsPsych plugin | `custom/plugins/*.js` |

L1 and L2 files import nothing and use no globals: everything comes through the injected context (`spec/types.d.ts`: `rng`, `layout`, `phase`, `bus`, `plan`, `stimuli`, `params`, ...). Their declarative half (`params`, `input`, `events`, `requires`, `css`) is validated by `task-manifest.schema.json`; custom `task.*` events declared there make trigger `on:` names checkable.

**Lifecycle (decided):** consent -> subject form -> session form -> device check -> (camera + gaze calibration) -> connect trigger sinks -> blocks -> finish. Nothing is persisted or sent before consent; `session.start` is the first persisted event. Built-in `subject` form: `sub-xxx` (BIDS), sex, age; `session` form: session id; extended in `forms.yaml`. Consent is mandatory (`file` or `text`, `on_screen` or `attested`, `statements`, `min_age`; `min_age` requires the age field).

## 9. Storage and export

- **Local (storage/local.js):** every event goes to an IndexedDB log as it happens; on reload the runtime offers recovery (`storage.local.recovery`). `export_on_finish`: `jsonl`, `bids`.
- **Firebase (storage/firebase.js):** optional. Layout, access modes, subject-ID allocation, chunking, cost and deployment are in `spec/firebase/DESIGN.md`; rules are generated by `spec/tools/gen_rules.js` and tested in the Firestore emulator. Public = anonymous participants, server-assigned locked IDs (smallest free, via claims with a no-gaps rule). Controlled = signed-in allow-listed experimenters, prefilled smallest-free ID, overridable. Events are written as NDJSON string chunks (Firestore rejects nested arrays), flushed every `chunk.flush_ms`.
- **Export (storage/export.js + cli export-firestore):** one input format (session record + event stream) whichever store produced it; Firestore export uses the Admin SDK and the integrity checks in DESIGN.md. The BIDS writer produces `sub-*/ses-*/beh/*_events.tsv` (+ json sidecars, `participants.tsv`) and, when present, `physio`/gaze files. Written for BIDS 1.10.0 (decided in M8, `docs/decisions.md`); gaze/physio files arrive with M9.

## 10. What users see

```
my-experiment/
  index.html            <script type=module src="expfw/boot.js"> and a stage div
  experiment.yaml  forms.yaml  stimuli.yaml  timeline.yaml  consent.md
  assets/               images, audio
  custom/               optional: stimuli/ tasks/ plugins/
  expfw/                the framework as readable source (framework/, vendor/, schemas/); do not edit
  expfw-eyetracking/    optional add-on: WebGazer (GPL), only with eye tracking
```

`cli serve` hosts it locally; `cli deploy` pushes to Firebase Hosting; `cli dry-run` plays the timeline with synthetic input and prints the event stream and triggers; `cli migrate` upgrades `spec_version`. Implemented in M10 as `expfw init|validate|dry-run|serve|deploy|migrate`; the bundle comes from `npm run build` (entry `bundle/entry.js`, outside the framework layers); see `docs/decisions.md`.

## 11. Open decisions (defaults assumed)

1. Keep `on:` as the event key; the loader must be YAML 1.2. (Alternative: rename.)
2. Profile groups (`touch: [phone, tablet]`) not in v1; the example uses a YAML anchor.
3. `design:` stays small: factors, repetitions, `max_run`. No block-order counterbalancing in v1.
4. `sex` enum `male|female|other|n/a` (decided M8: kept; the BIDS validator accepts all four values).
5. Custom events limited to `task.*` and `semantic.*`.
6. Real accounts for multi-device, multi-session public studies: not built.

## 12. Main risks (in order)

1. **Timing.** Visual onset stamps, trigger latency and jsPsych's own scheduling. Mitigate with the photodiode overlay and a measurement harness in M10 before any claims are made about accuracy.
2. **Mobile browser variance.** Wake lock, fullscreen, orientation, touch-event quirks, Web Serial availability (desktop Chromium only; phones fall back to websocket/none).
3. **Firestore rules** are untested; M7 is blocked until the emulator matrix passes.
4. **Schema drift** between `spec/`, the runtime and the VS Code extension; one generated source, checked in CI.
