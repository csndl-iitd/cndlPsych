# Schemas v1 (draft for review)

`expfw` is a placeholder name and `example.org` a placeholder `$id` host; both are one-line changes in `tools/build.js`.

```
src/        authoring format (YAML): *.schema.yaml + events.catalog.yaml
schema/     generated JSON Schema (draft-07) - point editors and the runtime at these
types.d.ts  contracts for custom tasks / stimulus generators
examples/   your oddball / flashes / visual-search project, migrated; sample events + session
tools/      build.js (src -> schema), validate.test.js, yaml12.js (YAML 1.2 loader),
            gen_rules.py (Firestore rules), chunks.py + chunks.js (Firestore chunk codec)
firebase/   DESIGN.md, generated firestore.{public,controlled}.rules, firestore.indexes.json
```

    npm run build:schemas && npm test      # from the repo root; npm run check:schemas fails if schema/ is stale

## What each schema covers

| File | Describes |
|---|---|
| `common` | ids, durations, lengths, regions, predicates (`where`/`when`), event patterns, `emit` |
| `event` | bus envelope + a data schema for each of ~50 event types (generated from `events.catalog.yaml`) |
| `session` | the session record written with every dataset (ids, subject/session answers, consent, device, clock, stage, sinks, overlays) |
| `experiment` | `experiment.yaml`: stage, device, consent, input/triggers roots, eye tracking, overlays, storage, finish, debug |
| `input` | cascadable input scope: intents, per-profile bindings and rules, gestures, thresholds, hit padding, cursor |
| `triggers` | rules table (cascadable) and session-wide sinks (serial / websocket / usb; raw / ndjson / template) |
| `forms`, `stimuli`, `timeline` | the three content files |
| `module-response-task`, `-survey`, `-instructions` | built-in module configs (`keyboard_task` is gone) |
| `task-manifest` | declarative half of custom tasks and stimulus generators |
| `firestore` | claim, uid-marker and event-chunk documents (see `firebase/DESIGN.md`) |

Lifecycle these schemas assume: consent -> subject -> session -> device check -> (camera + gaze calibration) -> connect trigger sinks -> blocks -> finish. Nothing is persisted or sent before consent; `session.start` is the first persisted event.

## Changes from the earlier discussion

- `stim.onset/offset` merged into `phase.onset/offset` (with an optional `stimulus` field). Trigger rules now say `on: phase.onset, where: {stimulus: ...}`.
- Binding shorthand: `desktop: {key: f}`, `phone: {tap: {x: [0, 0.5]}}`. `tap` replaces `touch` because a mouse click is a tap. The key jsPsych sees is internal (`plugin_key` overrides it).
- `disable: [ids]` is a sibling key of `rules`, not a list entry.
- Trigger rules need ids; `stim:<name>` is reserved for the rule compiled from an inline `trigger:`.
- Trial numbers are 1-based within a block.
- `response_task`: `response` replaces `choices`, `correct` replaces `correct_response`, `feedback` replaces `response_stimulus(i)`, `order` replaces `shuffle_trials` (default is still shuffle). New: `response_window`, `on_response`, `design`.
- Raw events carry `trusted`; gesture events carry `all_trusted`. Pointer paths are opt-in per scope.
- `format` is mandatory on trigger sinks (no silent default between raw bytes and text).
- `forms.yaml` no longer holds participant/session forms. Built-in `subject` and `session` forms are extended with `questions` and restyled with `overrides`. Form-level `type: survey-text` and `data.phase` are dropped.
- New `instructions` module replaces instruction trials with `ALL_KEYS`.

## Firebase additions

- `storage.firebase.experiment_id` namespaces an experiment inside a project; `chunk.max_bytes` (default 600000) and `chunk.flush_ms` (default 10000, one billed write per flush) control chunking.
- Session record gains `end_reason`, `experiment_id`, `uid`, `n_chunks`, `last_seq` (export integrity checks).
- Events are stored as one NDJSON string per chunk because Firestore rejects nested arrays.
- Rules are generated per access mode. **They have not been run in the emulator**; the test matrix is in `firebase/DESIGN.md`.

## Checks the schemas cannot express (compiler / `cli validate`)

- Cross references: stimulus names, `form_id`, module names and custom files, sink ids, `{factor}` templates.
- Unique ids across blocks, trials, rules; `each` expansion yields unique names.
- Cascade resolution, then completeness: every resolved rule has `match` + `emit` (input) or `on` + `value` (triggers).
- Coverage: every intent a trial uses resolves for every allowed profile in that block.
- Trigger values within each sink's range (raw: 0-255); same value with different meanings in one block; double-fire warning.
- `on:` names exist in the event catalog or the task's `events`; `where` keys exist in that event's data.
- Custom `params` values validate against the task's declaration.
- `eyetracking.profiles` is a subset of `device.allowed`; enabling eye tracking auto-adds a camera consent statement; `consent.min_age` requires the age field.

## Decisions to confirm

1. **`on:` and YAML 1.2.** Bare `on` is the boolean `true` in YAML 1.1 (PyYAML, and Python tooling generally); `tools/yaml12.js` loads with js-yaml 4 (YAML 1.2) and a test proves `on` stays a string. The browser runtime (js-yaml 4) and the VS Code YAML server read YAML 1.2 and are fine. Anyone loading a spec with a 1.1 parser would see `on` vanish. Keep `on` (reads best) and document it, or rename to something like `event:`.
2. **Profile groups.** The visual-search example repeats the phone rules for tablet with a YAML anchor. A `touch: [phone, tablet]` group usable as a profile key would remove that.
3. **`design:` is deliberately small** (factors, repetitions, `max_run`). Block-order counterbalancing (Latin square etc.) is not in v1.
4. **`sex` values** are `male | female | other | n/a` in the session record. Check them against the BIDS version you export to.
5. **Custom events** must be `task.*` (emitted by tasks) or `semantic.*` (emitted by rules). Say if you want a third namespace.

## Editor setup (VS Code YAML extension)

```json
"yaml.schemas": {
  "schema/experiment.schema.json": "experiment.yaml",
  "schema/forms.schema.json": "forms.yaml",
  "schema/stimuli.schema.json": "stimuli.yaml",
  "schema/timeline.schema.json": "timeline.yaml"
}
```

Not covered yet: the compiler (cascade resolver and the cross-file checks above), and emulator tests for the rules.
