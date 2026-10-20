# timeline.yaml

_Generated from the schemas in `spec/schema/` by `tools/build-docs.js`; do not edit by hand. The schemas themselves are the contract: `expfw validate` reports anything outside them with the file and the path._

The order of blocks. What a block's `config` accepts depends on its `module`; those settings follow the table.

Paths are written as in the YAML: `a.b` is key `b` inside `a`; `items[]` is each entry of a list; `<name>` is a key you choose.

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `blocks` | list of object | yes |  | min items 1 |
| `blocks[].id` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `blocks[].module` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `blocks[].title` | string |  |  |  |
| `blocks[].config` | object |  |  | Module-specific. Built-in modules are validated; custom tasks are validated against their own 'params' |
| `blocks[].input` | object |  |  |  |
| `blocks[].input.reset` | boolean |  | `false` | Discard everything inherited from higher levels before applying this scope |
| `blocks[].input.intents` | object |  |  |  |
| `blocks[].input.intents.<name>` | object |  |  | Declares a semantic response. Per-profile bindings sit alongside 'hint' (text shown to participants via {{intent.hint}}). Reserved keys: hint, plugin_key, doc - so no profile may use those names |
| `blocks[].input.intents.<name>.hint` | one of several forms |  |  | Participant-facing text, per profile or one string for all |
| `blocks[].input.intents.<name>.plugin_key` | string |  |  | Key jsPsych sees. Auto-assigned unless a custom plugin needs a specific one. min length 1 |
| `blocks[].input.intents.<name>.doc` | string |  |  |  |
| `blocks[].input.intents.<name>.<name>` | one of several forms |  |  | One binding, or a list (any of them triggers the intent) |
| `blocks[].input.profiles` | object |  |  |  |
| `blocks[].input.profiles.<name>` | object |  |  |  |
| `blocks[].input.profiles.<name>.rules` | list of object |  |  |  |
| `blocks[].input.profiles.<name>.disable` | list of string |  |  | Inherited rule ids to remove |
| `blocks[].input.profiles.<name>.gestures` | list of one of |  |  | Gestures the recognizer runs. Enabling only what a trial needs avoids ambiguity and latency |
| `blocks[].input.profiles.<name>.gesture_thresholds` | object |  |  |  |
| `blocks[].input.profiles.<name>.gesture_thresholds.tap` | object |  |  |  |
| `blocks[].input.profiles.<name>.gesture_thresholds.longpress` | object |  |  |  |
| `blocks[].input.profiles.<name>.gesture_thresholds.swipe` | object |  |  |  |
| `blocks[].input.profiles.<name>.gesture_thresholds.drag` | object |  |  |  |
| `blocks[].input.profiles.<name>.fire_on` | one of |  | `"up"` | when taps fire; affects RT by the press duration. values: `"down"`, `"up"` |
| `blocks[].input.profiles.<name>.pointer_path` | one of several forms |  |  | Record pointer trajectories (input.pointer.path). Off by default; keyboard-only trials record none |
| `blocks[].input.profiles.<name>.hit_padding` | one of several forms |  |  | Extra tolerance around registered targets (larger on touch) |
| `blocks[].input.profiles.<name>.show_zones` | boolean |  | `false` | outline mapped touch regions |
| `blocks[].input.profiles.<name>.cursor` | object |  |  | Mouse cursor behaviour (no effect on touch) |
| `blocks[].input.profiles.<name>.cursor.autohide_ms` | number |  | `1000` | 0 disables autohide. min 0 |
| `blocks[].input.profiles.<name>.cursor.show_on_move_px` | number |  | `3` | min 0 |
| `blocks[].input.disable` | list of string |  |  | Inherited intent ids to remove |
| `blocks[].input.gestures` | list of one of |  |  | Gestures the recognizer runs. Enabling only what a trial needs avoids ambiguity and latency |
| `blocks[].input.gesture_thresholds` | object |  |  |  |
| `blocks[].input.gesture_thresholds.tap` | object |  |  |  |
| `blocks[].input.gesture_thresholds.tap.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `blocks[].input.gesture_thresholds.tap.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `blocks[].input.gesture_thresholds.longpress` | object |  |  |  |
| `blocks[].input.gesture_thresholds.longpress.min_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `blocks[].input.gesture_thresholds.longpress.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `blocks[].input.gesture_thresholds.swipe` | object |  |  |  |
| `blocks[].input.gesture_thresholds.swipe.min_distance` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `blocks[].input.gesture_thresholds.swipe.min_velocity` | number |  |  | stage lengths per second. min 0 |
| `blocks[].input.gesture_thresholds.swipe.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `blocks[].input.gesture_thresholds.drag` | object |  |  |  |
| `blocks[].input.gesture_thresholds.drag.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `blocks[].input.fire_on` | one of |  |  | values: `"down"`, `"up"` |
| `blocks[].input.pointer_path` | one of several forms |  |  | Record pointer trajectories (input.pointer.path). Off by default; keyboard-only trials record none |
| `blocks[].input.pointer_path.hz` | number |  |  | min 1 |
| `blocks[].input.hit_padding` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `blocks[].input.show_zones` | boolean |  |  |  |
| `blocks[].input.cursor` | object |  |  | Mouse cursor behaviour (no effect on touch) |
| `blocks[].input.cursor.autohide_ms` | number |  | `1000` | 0 disables autohide. min 0 |
| `blocks[].input.cursor.show_on_move_px` | number |  | `3` | min 0 |
| `blocks[].triggers` | object |  |  | Block / trial level (and task-module defaults). No sink definitions here |
| `blocks[].triggers.enabled` | boolean |  | `true` | false silences all triggers in this scope (e.g. practice) |
| `blocks[].triggers.reset` | boolean |  | `false` |  |
| `blocks[].triggers.rules` | list of object |  |  |  |
| `blocks[].triggers.rules[].id` | string | yes |  | Trigger rule id. Inline 'trigger:' values in stimuli.yaml compile to rules with the reserved id stim:<stimulus name>, so blocks can override them. The built-in universal and semantic triggers have the ids universal:<name> and semantic:<intent> (a block can disable or change them). pattern `"^((stim\|universal\|semantic):)?[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `blocks[].triggers.rules[].on` | string |  |  | Namespaced event name. A trailing '*' segment is a glob (input.*). pattern `"^[a-z][a-z0-9_]*(\\.([a-z0-9_]+\|\\*))*$"` |
| `blocks[].triggers.rules[].where` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].triggers.rules[].where.all` | list of object |  |  | min items 1 |
| `blocks[].triggers.rules[].where.any` | list of object |  |  | min items 1 |
| `blocks[].triggers.rules[].where.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].triggers.rules[].value` | one of several forms |  |  | A literal, a value read from the event/context, or a lookup table |
| `blocks[].triggers.rules[].sinks` | list of string |  |  | Subset of defined sinks; default all. min items 1 |
| `blocks[].triggers.rules[].once` | boolean |  | `false` |  |
| `blocks[].triggers.rules[].priority` | integer |  | `0` |  |
| `blocks[].triggers.rules[].allow_multiple` | boolean |  | `false` | Silence the compiler warning when this rule fires alongside another on the same event |
| `blocks[].triggers.disable` | list of string |  |  |  |
| `blocks[].profiles` | list of string |  |  | Run only on these device profiles (skipped elsewhere). min items 1 |
| `blocks[].skip_on` | list of string |  |  | min items 1 |
| `blocks[].when` | object |  |  | Run only if this holds over subject.*, session.* and device.profile |
| `blocks[].when.all` | list of object |  |  | min items 1 |
| `blocks[].when.all[].all` | list of object |  |  | min items 1 |
| `blocks[].when.all[].any` | list of object |  |  | min items 1 |
| `blocks[].when.all[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.all[].not.all` | list of object |  |  | min items 1 |
| `blocks[].when.all[].not.any` | list of object |  |  | min items 1 |
| `blocks[].when.all[].not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.any` | list of object |  |  | min items 1 |
| `blocks[].when.any[].all` | list of object |  |  | min items 1 |
| `blocks[].when.any[].any` | list of object |  |  | min items 1 |
| `blocks[].when.any[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.any[].not.all` | list of object |  |  | min items 1 |
| `blocks[].when.any[].not.any` | list of object |  |  | min items 1 |
| `blocks[].when.any[].not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.not.all` | list of object |  |  | min items 1 |
| `blocks[].when.not.all[].all` | list of object |  |  | min items 1 |
| `blocks[].when.not.all[].any` | list of object |  |  | min items 1 |
| `blocks[].when.not.all[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.not.any` | list of object |  |  | min items 1 |
| `blocks[].when.not.any[].all` | list of object |  |  | min items 1 |
| `blocks[].when.not.any[].any` | list of object |  |  | min items 1 |
| `blocks[].when.not.any[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.not.not.all` | list of object |  |  | min items 1 |
| `blocks[].when.not.not.any` | list of object |  |  | min items 1 |
| `blocks[].when.not.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].when.not.not.not.all` | list of object |  |  | min items 1 |
| `blocks[].when.not.not.not.any` | list of object |  |  | min items 1 |
| `blocks[].when.not.not.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `blocks[].repeat` | integer |  | `1` | min 1 |
| `blocks[].data` | object |  |  | Extra fields attached to block.start |
| `blocks[].config.trials` | list of object | yes |  | min items 1 |
| `blocks[].config.trials[].name` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `blocks[].config.trials[].start` | string |  |  | stimulus shown first (e.g. fixation). min length 1 |
| `blocks[].config.trials[].sequence` | list of one of several forms | yes |  | min items 1 |
| `blocks[].config.trials[].shuffle` | boolean |  | `false` | shuffle the sequence within each instance |
| `blocks[].config.trials[].end` | string |  |  | min length 1 |
| `blocks[].config.trials[].response` | one of several forms |  |  | Accepted intents. 'any' = any input (tap anywhere / any key), 'none' = no response |
| `blocks[].config.trials[].response_window` | one of |  | `"last"` | last = only the final stimulus accepts responses; any = every stimulus in the sequence does. values: `"last"`, `"any"` |
| `blocks[].config.trials[].on_response` | one of |  | `"end"` | end = a response ends the sequence; continue = keep presenting (multiple responses per trial). values: `"end"`, `"continue"` |
| `blocks[].config.trials[].timeout` | one of several forms |  |  | Maximum time for a response once the response window opens |
| `blocks[].config.trials[].correct` | one of several forms |  |  | Expected intent(s), optionally only in a context. 'where' is evaluated at response time over: stimulus, phase, occurrence (nth presentation of that stimulus in this trial), index (position in the sequence), trial, and the trial's conditions. A response outside a matching context is incorrect; no response during a matching context is a miss |
| `blocks[].config.trials[].rt_from` | object |  |  | Measure response times from the onset of the stimulus matching this predicate (same fields as correct.where: stimulus, phase, occurrence, index, trial, conditions), instead of from the stimulus on screen when the response happened. Use it when the response is to one particular stimulus of a longer sequence (the second Ǝ of an oddball sequence): the time is then from that stimulus even if a later one is already showing. A response before that stimulus has appeared has no response time |
| `blocks[].config.trials[].feedback` | one of several forms |  |  |  |
| `blocks[].config.trials[].post` | one of several forms |  |  | Gap after the trial (a [min, max] pair jitters) |
| `blocks[].config.trials[].repetitions` | integer |  | `1` | min 1 |
| `blocks[].config.trials[].applies_to` | object |  |  | With 'design' - only instantiate for cells matching this predicate over factor values |
| `blocks[].config.trials[].conditions` | object |  |  | Labels recorded in trial.start (design factors are added automatically) |
| `blocks[].config.trials[].data` | object |  |  |  |
| `blocks[].config.trials[].input` | object |  |  |  |
| `blocks[].config.trials[].triggers` | object |  |  | Block / trial level (and task-module defaults). No sink definitions here |
| `blocks[].config.order` | one of |  | `"shuffle"` | Order of trial instances in the block. values: `"sequential"`, `"shuffle"` |
| `blocks[].config.design` | object |  |  | Optional factorial expansion. Trial definitions may use {factor} in stimulus names and 'applies_to' to select cells. Cells are repeated 'repetitions' times and ordered by 'order', subject to constraints |
| `blocks[].config.design.factors` | object | yes |  |  |
| `blocks[].config.design.factors.<name>` | list of string or number or boolean |  |  | min items 1 |
| `blocks[].config.design.repetitions` | integer |  | `1` | min 1 |
| `blocks[].config.design.constraints` | list of object |  |  |  |
| `blocks[].config.form_id` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `blocks[].config.submit_label` | string |  |  |  |
| `blocks[].config.allow_skip` | boolean |  | `false` |  |
| `blocks[].config.pages` | list of one of several forms | yes |  | min items 1 |
| `blocks[].config.advance` | string |  |  | Semantic response name. 'any' and 'none' are built in. pattern `"^[a-z][a-z0-9_]*$"` |
| `blocks[].config.back` | one of several forms |  |  |  |
| `blocks[].config.min_time` | one of several forms |  |  | Minimum time a page stays before advancing is accepted |
| `blocks[].config.min_time.frames` | integer | yes |  | min 1 |
| `blocks[].config.post` | one of several forms |  |  | A duration, or a [min, max] pair drawn uniformly (jitter) |

## `config` of `module: instructions`

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `pages` | list of one of several forms | yes |  | min items 1 |
| `pages[].html` | string | yes |  |  |
| `pages[].text` | string | yes |  |  |
| `advance` | string |  |  | Semantic response name. 'any' and 'none' are built in. pattern `"^[a-z][a-z0-9_]*$"` |
| `back` | one of several forms |  |  |  |
| `min_time` | one of several forms |  |  | Minimum time a page stays before advancing is accepted |
| `min_time.frames` | integer | yes |  | min 1 |
| `post` | one of several forms |  |  | A duration, or a [min, max] pair drawn uniformly (jitter) |
| `post[].frames` | integer | yes |  | min 1 |

## `config` of `module: response_task`

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `trials` | list of object | yes |  | min items 1 |
| `trials[].name` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `trials[].start` | string |  |  | stimulus shown first (e.g. fixation). min length 1 |
| `trials[].sequence` | list of one of several forms | yes |  | min items 1 |
| `trials[].sequence[].stimulus` | string | yes |  | min length 1 |
| `trials[].sequence[].phase` | string |  |  | phase name used in events and trigger rules. pattern `"^[a-z][a-z0-9_]*$"` |
| `trials[].sequence[].duration` | one of several forms |  |  | A duration, or null for 'until a response' |
| `trials[].sequence[].post` | one of several forms |  |  | A duration, or a [min, max] pair drawn uniformly (jitter) |
| `trials[].shuffle` | boolean |  | `false` | shuffle the sequence within each instance |
| `trials[].end` | string |  |  | min length 1 |
| `trials[].response` | one of several forms |  |  | Accepted intents. 'any' = any input (tap anywhere / any key), 'none' = no response |
| `trials[].response_window` | one of |  | `"last"` | last = only the final stimulus accepts responses; any = every stimulus in the sequence does. values: `"last"`, `"any"` |
| `trials[].on_response` | one of |  | `"end"` | end = a response ends the sequence; continue = keep presenting (multiple responses per trial). values: `"end"`, `"continue"` |
| `trials[].timeout` | one of several forms |  |  | Maximum time for a response once the response window opens |
| `trials[].timeout[].frames` | integer | yes |  | min 1 |
| `trials[].correct` | one of several forms |  |  | Expected intent(s), optionally only in a context. 'where' is evaluated at response time over: stimulus, phase, occurrence (nth presentation of that stimulus in this trial), index (position in the sequence), trial, and the trial's conditions. A response outside a matching context is incorrect; no response during a matching context is a miss |
| `trials[].correct.intent` | one of several forms | yes |  | Accepted intents. 'any' = any input (tap anywhere / any key), 'none' = no response |
| `trials[].correct.where` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].correct.where.all` | list of object |  |  | min items 1 |
| `trials[].correct.where.any` | list of object |  |  | min items 1 |
| `trials[].correct.where.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].correct.where.not.all` | list of object |  |  | min items 1 |
| `trials[].correct.where.not.any` | list of object |  |  | min items 1 |
| `trials[].correct.where.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from` | object |  |  | Measure response times from the onset of the stimulus matching this predicate (same fields as correct.where: stimulus, phase, occurrence, index, trial, conditions), instead of from the stimulus on screen when the response happened. Use it when the response is to one particular stimulus of a longer sequence (the second Ǝ of an oddball sequence): the time is then from that stimulus even if a later one is already showing. A response before that stimulus has appeared has no response time |
| `trials[].rt_from.all` | list of object |  |  | min items 1 |
| `trials[].rt_from.all[].all` | list of object |  |  | min items 1 |
| `trials[].rt_from.all[].any` | list of object |  |  | min items 1 |
| `trials[].rt_from.all[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.all[].not.all` | list of object |  |  | min items 1 |
| `trials[].rt_from.all[].not.any` | list of object |  |  | min items 1 |
| `trials[].rt_from.all[].not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.any` | list of object |  |  | min items 1 |
| `trials[].rt_from.any[].all` | list of object |  |  | min items 1 |
| `trials[].rt_from.any[].any` | list of object |  |  | min items 1 |
| `trials[].rt_from.any[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.any[].not.all` | list of object |  |  | min items 1 |
| `trials[].rt_from.any[].not.any` | list of object |  |  | min items 1 |
| `trials[].rt_from.any[].not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.not.all` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.all[].all` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.all[].any` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.all[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.not.any` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.any[].all` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.any[].any` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.any[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.not.not.all` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.not.any` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].rt_from.not.not.not.all` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.not.not.any` | list of object |  |  | min items 1 |
| `trials[].rt_from.not.not.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].feedback` | one of several forms |  |  |  |
| `trials[].feedback.correct` | string |  |  | min length 1 |
| `trials[].feedback.incorrect` | string |  |  | min length 1 |
| `trials[].feedback.timeout` | string |  |  | min length 1 |
| `trials[].post` | one of several forms |  |  | Gap after the trial (a [min, max] pair jitters) |
| `trials[].post[].frames` | integer | yes |  | min 1 |
| `trials[].repetitions` | integer |  | `1` | min 1 |
| `trials[].applies_to` | object |  |  | With 'design' - only instantiate for cells matching this predicate over factor values |
| `trials[].applies_to.all` | list of object |  |  | min items 1 |
| `trials[].applies_to.all[].all` | list of object |  |  | min items 1 |
| `trials[].applies_to.all[].any` | list of object |  |  | min items 1 |
| `trials[].applies_to.all[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.all[].not.all` | list of object |  |  | min items 1 |
| `trials[].applies_to.all[].not.any` | list of object |  |  | min items 1 |
| `trials[].applies_to.all[].not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.any` | list of object |  |  | min items 1 |
| `trials[].applies_to.any[].all` | list of object |  |  | min items 1 |
| `trials[].applies_to.any[].any` | list of object |  |  | min items 1 |
| `trials[].applies_to.any[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.any[].not.all` | list of object |  |  | min items 1 |
| `trials[].applies_to.any[].not.any` | list of object |  |  | min items 1 |
| `trials[].applies_to.any[].not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.not.all` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.all[].all` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.all[].any` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.all[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.not.any` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.any[].all` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.any[].any` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.any[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.not.not.all` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.not.any` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].applies_to.not.not.not.all` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.not.not.any` | list of object |  |  | min items 1 |
| `trials[].applies_to.not.not.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].conditions` | object |  |  | Labels recorded in trial.start (design factors are added automatically) |
| `trials[].conditions.<name>` | string or number or boolean |  |  |  |
| `trials[].data` | object |  |  |  |
| `trials[].input` | object |  |  |  |
| `trials[].input.reset` | boolean |  | `false` | Discard everything inherited from higher levels before applying this scope |
| `trials[].input.intents` | object |  |  |  |
| `trials[].input.intents.<name>` | object |  |  | Declares a semantic response. Per-profile bindings sit alongside 'hint' (text shown to participants via {{intent.hint}}). Reserved keys: hint, plugin_key, doc - so no profile may use those names |
| `trials[].input.intents.<name>.hint` | one of several forms |  |  | Participant-facing text, per profile or one string for all |
| `trials[].input.intents.<name>.plugin_key` | string |  |  | Key jsPsych sees. Auto-assigned unless a custom plugin needs a specific one. min length 1 |
| `trials[].input.intents.<name>.doc` | string |  |  |  |
| `trials[].input.intents.<name>.<name>` | one of several forms |  |  | One binding, or a list (any of them triggers the intent) |
| `trials[].input.profiles` | object |  |  |  |
| `trials[].input.profiles.<name>` | object |  |  |  |
| `trials[].input.profiles.<name>.rules` | list of object |  |  |  |
| `trials[].input.profiles.<name>.disable` | list of string |  |  | Inherited rule ids to remove |
| `trials[].input.profiles.<name>.gestures` | list of one of |  |  | Gestures the recognizer runs. Enabling only what a trial needs avoids ambiguity and latency |
| `trials[].input.profiles.<name>.gesture_thresholds` | object |  |  |  |
| `trials[].input.profiles.<name>.gesture_thresholds.tap` | object |  |  |  |
| `trials[].input.profiles.<name>.gesture_thresholds.longpress` | object |  |  |  |
| `trials[].input.profiles.<name>.gesture_thresholds.swipe` | object |  |  |  |
| `trials[].input.profiles.<name>.gesture_thresholds.drag` | object |  |  |  |
| `trials[].input.profiles.<name>.fire_on` | one of |  | `"up"` | when taps fire; affects RT by the press duration. values: `"down"`, `"up"` |
| `trials[].input.profiles.<name>.pointer_path` | one of several forms |  |  | Record pointer trajectories (input.pointer.path). Off by default; keyboard-only trials record none |
| `trials[].input.profiles.<name>.hit_padding` | one of several forms |  |  | Extra tolerance around registered targets (larger on touch) |
| `trials[].input.profiles.<name>.show_zones` | boolean |  | `false` | outline mapped touch regions |
| `trials[].input.profiles.<name>.cursor` | object |  |  | Mouse cursor behaviour (no effect on touch) |
| `trials[].input.profiles.<name>.cursor.autohide_ms` | number |  | `1000` | 0 disables autohide. min 0 |
| `trials[].input.profiles.<name>.cursor.show_on_move_px` | number |  | `3` | min 0 |
| `trials[].input.disable` | list of string |  |  | Inherited intent ids to remove |
| `trials[].input.gestures` | list of one of |  |  | Gestures the recognizer runs. Enabling only what a trial needs avoids ambiguity and latency |
| `trials[].input.gesture_thresholds` | object |  |  |  |
| `trials[].input.gesture_thresholds.tap` | object |  |  |  |
| `trials[].input.gesture_thresholds.tap.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `trials[].input.gesture_thresholds.tap.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `trials[].input.gesture_thresholds.longpress` | object |  |  |  |
| `trials[].input.gesture_thresholds.longpress.min_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `trials[].input.gesture_thresholds.longpress.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `trials[].input.gesture_thresholds.swipe` | object |  |  |  |
| `trials[].input.gesture_thresholds.swipe.min_distance` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `trials[].input.gesture_thresholds.swipe.min_velocity` | number |  |  | stage lengths per second. min 0 |
| `trials[].input.gesture_thresholds.swipe.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `trials[].input.gesture_thresholds.drag` | object |  |  |  |
| `trials[].input.gesture_thresholds.drag.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `trials[].input.fire_on` | one of |  |  | values: `"down"`, `"up"` |
| `trials[].input.pointer_path` | one of several forms |  |  | Record pointer trajectories (input.pointer.path). Off by default; keyboard-only trials record none |
| `trials[].input.pointer_path.hz` | number |  |  | min 1 |
| `trials[].input.hit_padding` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `trials[].input.show_zones` | boolean |  |  |  |
| `trials[].input.cursor` | object |  |  | Mouse cursor behaviour (no effect on touch) |
| `trials[].input.cursor.autohide_ms` | number |  | `1000` | 0 disables autohide. min 0 |
| `trials[].input.cursor.show_on_move_px` | number |  | `3` | min 0 |
| `trials[].triggers` | object |  |  | Block / trial level (and task-module defaults). No sink definitions here |
| `trials[].triggers.enabled` | boolean |  | `true` | false silences all triggers in this scope (e.g. practice) |
| `trials[].triggers.reset` | boolean |  | `false` |  |
| `trials[].triggers.rules` | list of object |  |  |  |
| `trials[].triggers.rules[].id` | string | yes |  | Trigger rule id. Inline 'trigger:' values in stimuli.yaml compile to rules with the reserved id stim:<stimulus name>, so blocks can override them. The built-in universal and semantic triggers have the ids universal:<name> and semantic:<intent> (a block can disable or change them). pattern `"^((stim\|universal\|semantic):)?[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `trials[].triggers.rules[].on` | string |  |  | Namespaced event name. A trailing '*' segment is a glob (input.*). pattern `"^[a-z][a-z0-9_]*(\\.([a-z0-9_]+\|\\*))*$"` |
| `trials[].triggers.rules[].where` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].triggers.rules[].where.all` | list of object |  |  | min items 1 |
| `trials[].triggers.rules[].where.any` | list of object |  |  | min items 1 |
| `trials[].triggers.rules[].where.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `trials[].triggers.rules[].value` | one of several forms |  |  | A literal, a value read from the event/context, or a lookup table |
| `trials[].triggers.rules[].sinks` | list of string |  |  | Subset of defined sinks; default all. min items 1 |
| `trials[].triggers.rules[].once` | boolean |  | `false` |  |
| `trials[].triggers.rules[].priority` | integer |  | `0` |  |
| `trials[].triggers.rules[].allow_multiple` | boolean |  | `false` | Silence the compiler warning when this rule fires alongside another on the same event |
| `trials[].triggers.disable` | list of string |  |  |  |
| `order` | one of |  | `"shuffle"` | Order of trial instances in the block. values: `"sequential"`, `"shuffle"` |
| `design` | object |  |  | Optional factorial expansion. Trial definitions may use {factor} in stimulus names and 'applies_to' to select cells. Cells are repeated 'repetitions' times and ordered by 'order', subject to constraints |
| `design.factors` | object | yes |  |  |
| `design.factors.<name>` | list of string or number or boolean |  |  | min items 1 |
| `design.repetitions` | integer |  | `1` | min 1 |
| `design.constraints` | list of object |  |  |  |
| `design.constraints[].max_run` | object | yes |  |  |
| `design.constraints[].max_run.factor` | string | yes |  | Lower-case identifier (intent, profile, field, style names). pattern `"^[a-z][a-z0-9_]*$"` |
| `design.constraints[].max_run.n` | integer | yes |  | min 1 |

## `config` of `module: survey`

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `form_id` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `submit_label` | string |  |  |  |
| `allow_skip` | boolean |  | `false` |  |

