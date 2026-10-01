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
