# Decisions log

Record every deviation from ARCHITECTURE.md or `spec/` here: date, what changed, why.

Open at hand-off (defaults assumed): `on:` key kept (YAML 1.2 loader required); no profile groups in v1;
`design:` kept small; `sex` enum to be checked against the BIDS target in M8; custom events limited to
`task.*` / `semantic.*`; real accounts for multi-device public studies not built.

## 2026-10-01 - M0 repo and tooling

- **Python build/validate ported to Node and deleted.** `spec/tools/build.py`, `validate.py`, `yaml12.py` are replaced by `build.js`, `validate.test.js`, `yaml12.js`. `build.js` output was compared with the Python output byte for byte (all 14 files, LF endings) before deletion. `build.js --check` (`npm run check:schemas`) fails when `spec/schema/` is stale. `chunks.py` and `gen_rules.py` stay as the references for M7.
- **`chunks.js` added now** (not in M7) because the validator's Firestore section needs the codec. It is a tooling port only; the runtime codec in `storage/` is still M7. Parity is by round trip, not by bytes: Python `json.dumps` writes `1.0` where JS writes `1`, and gzip headers can differ, so M7 must decide what "identical" means for the shared fixture.
- **js-yaml 4 with `CORE_SCHEMA` + the merge type.** The core schema is YAML 1.2 (`on` stays a string, `16:9` stays a string); the sources use `<<` merge keys, which the core schema omits. js-yaml is pinned to major 4 (npm now resolves 5).
- **Ajv strict mode on, except `strictTypes` and `strictRequired`.** Those two police style (`pattern` without `type`, `required` of a property defined in a sibling subschema) that the schemas use on purpose. Unknown keywords still fail.
- **`.gitattributes` forces LF.** The Python reference wrote CRLF on Windows when run in place; generated files must not depend on the OS.
- **Layer rules are enforced twice**: `eslint.config.js` (`no-restricted-imports`, `no-restricted-syntax` for dynamic SDK imports, storage/random globals) and `tools/check-layers.js` (CI; also sees dynamic imports and `export ... from`). Both are tested with deliberately bad imports. `foundation` may import its own siblings (`./x.js`) but nothing else.
- **Test naming:** Vitest `*.test.js`, Playwright `*.e2e.js`, both beside the code.
- **`tsc` scope** is `spec/types.d.ts` plus `spec/examples/custom/**`; framework code is added to `tsconfig.json` as it is written.
- `esbuild` is installed but has no script yet; the first bundle is built when there is something to bundle (M4/M10).

### M0 not verified

- CI (`.github/workflows/ci.yml`) has never run: there is no remote. The same steps pass locally on Windows 11 / Node 24 (`npm run ci`, `npm run typecheck`, `npm run test:browser`).
- Playwright ran Chromium only (desktop and Pixel 7 emulation). WebKit, Firefox and real phones are untested.
- The Python reference `validate.py` itself failed one case on Windows (its `file://` URL for the custom generator import); the other 72 cases passed there. The Node port covers all of them.

## 2026-10-01 - M1 compiler and cascade

- **`compile(project)` is pure.** `framework/authoring/compiler.js` takes file texts, the generated schemas, the custom-module manifests (default exports with functions dropped) and an asset list, and returns `{plan, diagnostics}`. File access lives in `cli/project.js`, so the same compiler can run in the browser and the VS Code extension. Diagnostics carry `code`, `file`, YAML `path` (`blocks[5].input.profiles.phone.rules[1]`) and a message; there are no line numbers yet (except for YAML syntax errors).
- **Resolution is per concrete profile.** For each profile a block runs on, every cascade level applies `"*"` first, then the profile. A later level wins over an earlier one whatever its profile specificity (a block-level `"*"` binding replaces an experiment-level `phone` binding). A `disable` under one profile key only affects that profile. The plan holds one resolved scope per profile for each block and each `response_task` trial; triggers are profile independent.
- **Framework defaults** (cascade level 0, `defaults.js`): gestures `[tap]`, `fire_on: up`, cursor autohide 1000 ms / 3 px, `show_zones: false`. The spec does not state these; they are my reading of the schema defaults. Change them there if wrong. `any` and `none` are built-in intents and need no binding.
- **Stimulus triggers** compile to rules `stim:<name>` (`on: phase.onset`, `where: {stimulus: name}`) at the lowest trigger level, for the stimuli a block refers to. `trigger_base` expands to `base + index` (0-based).
- **Coverage** counts a rule that emits the intent as coverage, not only a binding. This is what lets the example's `next` intent work on desktop (rule `space_done`) and phone (rule `two_taps`).
- **New check codes beyond the README list:** `disable-conflict` (a scope that both disables and defines the same id; found by the idempotence property test, because it makes rule order depend on how often the level is applied), `gesture-not-enabled` (a tap/swipe/longpress binding whose gesture is not enabled), `each-name-template`, `task-profile-unsupported`, `block-profile-not-allowed`, `device-fixed-not-allowed`, `consent-file-missing`, `missing-asset`. `keyboard_task` is reported as an unknown module with a pointer to `response_task` (no alias).
- **Deviation to confirm: `mm` / `deg` without calibration is a warning, not an error.** ARCHITECTURE.md section 4 says the compiler errors, but `spec/examples/` (which must compile) uses `12mm` hit padding and `14mm` AprilTags with no `device.calibration`. The example wins; the compiler emits `units-need-calibration` warnings. If the rule should be an error, the example needs a calibration block (a one-line change in `spec/examples/experiment.yaml`).
- **Idempotence property** is tested two ways with a seeded generator (300 random cascades each; no property-testing dependency was added): re-resolving a resolved scope (`resolvedAsScope`) changes nothing, and applying every level twice equals applying it once. Trigger resolution has the second property.
- **`ajv` and `js-yaml` moved to `dependencies`** (the framework imports them). Ajv compiles validators with `new Function`, so a page served with a CSP that forbids `unsafe-eval` cannot run the compiler in the browser; M10 should decide between relaxing the CSP and pre-compiled (standalone) validators. The CLI is not affected.
- **Not covered by the compiler yet:** the design factor cell expansion (`design`, `applies_to` evaluation, `max_run`) happens at run time in M4; M1 only checks that `{factor}` templates and `applies_to` keys refer to real factors. `correct.where` keys are not checked against the context fields.

### M1 not verified

- The cascade semantics for "`*` versus profile across levels" and the framework defaults are my interpretation of `spec/`; no author has confirmed them.
- The golden files (`framework/authoring/golden/`) were generated by the compiler and then read against the spec by hand, not derived independently.
- Nothing has run in a browser; the compiler is only exercised from Node.

## 2026-10-01 - M2 foundation runtime

- **`seq` starts at 0.** ARCHITECTURE.md said "gap-free integer from 1"; `spec/examples/events.sample.jsonl` starts at 0 and the event schema allows 0. Spec wins, ARCHITECTURE.md fixed. A rejected emit (bad envelope or failed dev validation) consumes no seq.
- **Bus delivery order = seq order.** An event emitted from inside a handler is queued and delivered after the current event finishes, so no subscriber ever sees a later seq first. Every handler runs for every event; the first handler error is rethrown after delivery (or passed to `onHandlerError`). `caused_by` is explicit, never inferred.
- **Dev validation is injected, not imported.** `createBus({validate})` takes a function returning problems; foundation imports nothing, so tests and the runtime's dev build pass an Ajv validator over `event.schema.json`. The bus itself always checks the envelope. A test pins `SOURCES` to the generated schema's source enum.
- **`t_bus`** is recorded only when the event reached the bus more than 1 ms after its source time `t` (the spec says "meaningfully"; the threshold is mine).
- **Device detection rules (mine, spec is silent):** `desktop` = fine pointer and hover; `phone` = coarse pointer, touch, shorter screen side <= 599 CSS px; `tablet` = coarse pointer, touch, shorter side >= 600. `min_width_px` / `max_width_px` in `device.profiles.*.when` therefore mean the shorter screen side, so rotating a phone does not change its profile. `keyboard` cannot be detected and is assumed on fine-pointer devices. Custom profiles are tried before the built-ins (they win ties); a custom profile with a built-in id replaces it. If nothing matches, the device is rejected and `device.profile` records `profile: "unknown"`.
- **Rejection path:** `admitDevice` emits `device.profile`, and for a profile that is not in `device.allowed` (or matches nothing) also `session.end {reason: device_rejected}`; the caller shows the message (`rejected_message` or a default). `select: prompt` returns `pending` until an answer is given and emits nothing meanwhile.
- **Consent gate and record:** `createSessionRecord` throws without an accepted consent block, so a record cannot exist before consent. `min_age` is checked separately (`checkAge`) because the age answer is collected after consent; an unknown age fails the check when `min_age` is set.
- **Not in M2 although the foundation list suggests it:** the seeded `rng` of `types.d.ts` (needed by tasks in M4), frame-aligned onset stamping beyond the `nextFrame` helper (M10 measures it), and the subject / session form flow (M4). `session.js` provides ids, URL parameters, seed resolution, the consent gate and the record; the lifecycle that sequences them lives in `runtime/` (M4).
- **Matcher semantics chosen:** ordered sequences ignore non-matching events and are matched greedily (latest-starting partial wins; up to 8 partials are kept when `distinct_by` is set); `unordered` finds a real assignment of distinct events to steps by backtracking, so an event that could fill two steps does not block a match; `min_ms` compares `data.duration_ms`; a `null` condition matches null or missing; `ne` / `not_in` match a missing field; a missing `distinct_by` field is never distinct; `regex` is unanchored, globs are anchored and `*` also matches dots.
- **Browser tests** now start a static server (`tools/static-server.js`) and run three Chromium emulation projects: desktop, phone (Pixel 7) and tablet (Galaxy Tab S4). Layer rules exempt `*.e2e.js` like `*.test.js`.

### M2 not verified

- Device detection ran only in Chromium emulation. Real phones and tablets (iOS Safari in particular: `pointer`/`hover` media queries, `maxTouchPoints`, screen sizes) are untested, and the 600 px phone/tablet boundary is a convention, not a measurement. A desktop Chromium on this machine reported touch points (touch-screen host) and was still detected as desktop, as designed.
- `clock.js` is only tested with injected time sources and `performance.now()` monotonicity; no timing accuracy is claimed. `nextFrame` is unmeasured.
- `session.js` is not wired to storage or the lifecycle yet, so "nothing is persisted before consent" is enforced at the record level only; the end-to-end check belongs to M4/M6.

## 2026-10-01 - M3 input pipeline and jsPsych bridge

- **jsPsych comes from npm** (`jspsych` 8.3.0, `@jspsych/plugin-html-keyboard-response` 2.2.0, as runtime dependencies; you asked for npm instead of a vendored copy). "Vendored" now means bundled by esbuild into the user-facing folder at M10. `bridge.js` itself imports nothing from jsPsych: jsPsych instantiates the extension and hands itself over.
- **The bridge is made by a factory** (`createBridge({bus})`) because jsPsych does `new Extension(jsPsych)`. Internal keys are `F13`..`F24` in intent-name order (`any` first), or `plugin_key`. A trial enables the extension with `params: {accepted: [intents]}`; the plugin's `choices` are `bridge.keysFor(accepted)` (or `ALL_KEYS` for `any`). `bridge.key_injected.origin_t` is the time of the real input; semantic events are stamped with their cause's `t`, so `semantic.*.t` is the participant's action time, not when the mapping ran.
- **Consumption.** A key press is swallowed (`preventDefault` + `stopImmediatePropagation` in the capture phase, `consumed: true` in the event) when a rule or binding with `consume` (default true) would match it. Because the decision must come before the raw event is emitted, matchers gained `peek()` / `clone()` (state-free look-ahead). Only keys can be swallowed; a consumed tap simply does not also count as `any`. A real key that no rule consumes still reaches jsPsych natively, so `any` with `ALL_KEYS` works for keys without injection; a tap on an `any` trial needs the injected key.
- **What is logged:** every key down/up except while a form field has focus (typed answers are never captured); raw `input.pointer.*` and gestures only while the scope enables at least one gesture; mouse movement without a button is never logged (it only feeds the cursor). Right-click starts no gesture and the context menu is suppressed on the stage.
- **Gesture semantics (mine, spec is silent):** one pointer at a time. Defaults: tap <= 500 ms and <= 10 px; longpress 500 ms, slop 10 px; swipe >= 40 px, >= 0.2 stage lengths/s, <= 1 s; drag slop 10 px. Swipe and drag velocities are in stage lengths per second (the unit of `min_velocity`); `distance`/`dx`/`dy` are CSS px. With `drag` and `swipe` both enabled, drag wins. `fire_on: down` emits the tap at the press (up = down, duration 0). `tap_index` counts taps within 400 ms and 40 px. Tap bindings with `on: down` match the raw `input.pointer.down`; region tests use the tap's down point. Pointer paths are chunked at 256 rows and can be decimated with `hz`.
- **Stage:** coordinates are normalised per axis (x by width, y by height); bare lengths use the shorter side. `mm` without calibration is now an **estimate from the CSS reference pixel (96 px/inch)** with a one-time `system.warning` (`uncalibrated_units`), instead of throwing: the compiler only warns, and the example project uses mm. `deg` still needs `px_per_mm` and `viewing_distance_mm`. Listeners attach to the full-viewport root so taps in the letterbox are seen (`inside_stage: false`).
- **Rule 4 is enforced three ways:** the ESLint `no-restricted-syntax` rule, a grep test over `framework/` and the example custom code, and the browser tests. `ResizeObserver` (stage) and `dispatchEvent` (bridge) are not listeners and are allowed.
- **Rules cannot match `semantic.*` events** (prevents loops). Rule `reset` levels order is trial < block < session (`never` is never reset); `mapping.reset(level)` is for the runtime lifecycle (M4).
- **Browser tests** use an esbuild bundle (`tools/build-e2e.js`, built by the Playwright web server command) that includes the real framework, real unmodified jsPsych, and an Ajv validator that checks every emitted event against the generated schema; page errors fail the test. Touch input on phone/tablet comes from Chromium `Input.dispatchTouchEvent`; desktop uses the Playwright mouse. Both are trusted events; script-generated events are used for the untrusted case.
- **Bug found by tests:** `path_length` / `straightness` ignored the last segment up to the release point.

### M3 not verified

- Only Chromium emulation. Real touch hardware, iOS Safari (pointer-event and long-press / context-menu behaviour differs), Firefox and WebKit are untested; real finger pressure, coalesced events and palm rejection are not covered.
- Gesture thresholds are conventional defaults, not tuned or measured on devices.
- jsPsych is exercised with one plugin (`html-keyboard-response`) and one trial at a time through the extension; multi-trial timelines, the other keyboard plugins and `jsPsych.pluginAPI` options (`allow_held_key`, `case_sensitive_responses`) are not tested. Timing claims: none. The bridge latency (real input to injected key) is not measured; M10 does that.
- `input.js` is exercised with one `stage`; hot-swapping scopes between trials works in unit tests but the lifecycle that does it is M4.
