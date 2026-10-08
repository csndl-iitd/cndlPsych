# experiment.yaml

_Generated from the schemas in `spec/schema/` by `tools/build-docs.js`; do not edit by hand. The schemas themselves are the contract: `expfw validate` reports anything outside them with the file and the path._

Who can take part, what is stored, how responses and triggers work. Everything outside the blocks.

Paths are written as in the YAML: `a.b` is key `b` inside `a`; `items[]` is each entry of a list; `<name>` is a key you choose.

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `spec_version` | constant | yes |  | must be `1` |
| `name` | string | yes |  | min length 1 |
| `description` | string |  |  |  |
| `authors` | list of string |  |  |  |
| `language` | string |  | `"en"` | pattern `"^[a-z]{2}(-[A-Z]{2})?$"` |
| `seed` | one of several forms |  | `"auto"` | Master seed for all randomization. 'auto' draws one per session and stores it |
| `capture_url_params` | list of string |  |  | URL query parameters copied into the session record (e.g. PROLIFIC_PID) |
| `stage` | object |  |  | The fixed-aspect container all stimuli and hit regions are laid out in |
| `stage.aspect` | one of several forms |  | `"fill"` | Width:height of the letterboxed stage, or 'fill' to use the whole viewport |
| `stage.margin` | one of several forms |  |  | Extra reserved border around the stage (in addition to overlays) |
| `stage.background` | string |  | `"#000000"` |  |
| `stage.color` | string |  | `"#ffffff"` |  |
| `stage.font` | string |  |  |  |
| `stage.fullscreen` | one of |  | `"preferred"` | values: `"required"`, `"preferred"`, `"off"` |
| `stage.orientation` | one of |  | `"any"` | values: `"any"`, `"landscape"`, `"portrait"` |
| `stage.wake_lock` | boolean |  | `true` |  |
| `device` | object |  |  |  |
| `device.select` | one of |  | `"auto"` | auto = capability detection, prompt = ask the participant/experimenter, fixed = use 'fixed'. values: `"auto"`, `"prompt"`, `"fixed"` |
| `device.allowed` | list of string |  |  | Profiles this experiment supports; other devices are rejected with 'rejected_message'. min items 1 |
| `device.fixed` | string |  |  | Device profile id (built in - desktop, phone, tablet - or custom). pattern `"^[a-z][a-z0-9_]*$"` |
| `device.profiles` | object |  |  | Override or add profile detection conditions. desktop, phone and tablet are built in |
| `device.profiles.<name>` | object |  |  |  |
| `device.profiles.<name>.when` | object | yes |  |  |
| `device.profiles.<name>.when.pointer` | one of |  |  | values: `"fine"`, `"coarse"`, `"none"` |
| `device.profiles.<name>.when.hover` | one of |  |  | values: `"hover"`, `"none"` |
| `device.profiles.<name>.when.keyboard` | boolean |  |  |  |
| `device.profiles.<name>.when.touch` | boolean |  |  |  |
| `device.profiles.<name>.when.min_width_px` | number |  |  |  |
| `device.profiles.<name>.when.max_width_px` | number |  |  |  |
| `device.profiles.<name>.when.orientation` | one of |  |  | values: `"portrait"`, `"landscape"` |
| `device.calibration` | object |  |  | Physical-size calibration, needed only for mm / deg units |
| `device.calibration.mode` | one of |  | `"none"` | values: `"none"`, `"card"`, `"manual"` |
| `device.calibration.viewing_distance_mm` | number |  |  | min 50 |
| `device.calibration.profiles` | list of string |  |  |  |
| `device.rejected_message` | string |  |  |  |
| `consent` | one of several forms | yes |  |  |
| `consent.file` | string |  |  | markdown file in the project root |
| `consent.text` | string |  |  |  |
| `consent.mode` | one of |  | `"on_screen"` | on_screen = participant accepts on the device; attested = experimenter confirms consent was obtained elsewhere. values: `"on_screen"`, `"attested"` |
| `consent.statements` | list of object |  |  |  |
| `consent.statements[].id` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `consent.statements[].text` | string | yes |  |  |
| `consent.statements[].required` | boolean |  | `true` |  |
| `consent.min_age` | integer |  |  | eligibility gate checked against the age answer. min 0 |
| `consent.require_scroll` | boolean |  | `false` |  |
| `consent.decline_message` | string |  |  |  |
| `input` | object |  |  |  |
| `input.reset` | boolean |  | `false` | Discard everything inherited from higher levels before applying this scope |
| `input.intents` | object |  |  |  |
| `input.intents.<name>` | object |  |  | Declares a semantic response. Per-profile bindings sit alongside 'hint' (text shown to participants via {{intent.hint}}). Reserved keys: hint, plugin_key, doc - so no profile may use those names |
| `input.intents.<name>.hint` | one of several forms |  |  | Participant-facing text, per profile or one string for all |
| `input.intents.<name>.plugin_key` | string |  |  | Key jsPsych sees. Auto-assigned unless a custom plugin needs a specific one. min length 1 |
| `input.intents.<name>.doc` | string |  |  |  |
| `input.intents.<name>.<name>` | one of several forms |  |  | One binding, or a list (any of them triggers the intent) |
| `input.profiles` | object |  |  |  |
| `input.profiles.<name>` | object |  |  |  |
| `input.profiles.<name>.rules` | list of object |  |  |  |
| `input.profiles.<name>.rules[].id` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `input.profiles.<name>.rules[].match` | one of several forms |  |  | A single step, or an ordered sequence of steps with per-rule state |
| `input.profiles.<name>.rules[].emit` | one of several forms |  |  |  |
| `input.profiles.<name>.rules[].reset` | one of |  | `"trial"` | When sequence state clears. values: `"trial"`, `"block"`, `"session"`, `"never"` |
| `input.profiles.<name>.rules[].consume` | boolean |  | `true` | Swallow the source event so it never reaches jsPsych or default handling |
| `input.profiles.<name>.rules[].priority` | integer |  | `0` |  |
| `input.profiles.<name>.disable` | list of string |  |  | Inherited rule ids to remove |
| `input.profiles.<name>.gestures` | list of one of |  |  | Gestures the recognizer runs. Enabling only what a trial needs avoids ambiguity and latency |
| `input.profiles.<name>.gesture_thresholds` | object |  |  |  |
| `input.profiles.<name>.gesture_thresholds.tap` | object |  |  |  |
| `input.profiles.<name>.gesture_thresholds.tap.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `input.profiles.<name>.gesture_thresholds.tap.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.profiles.<name>.gesture_thresholds.longpress` | object |  |  |  |
| `input.profiles.<name>.gesture_thresholds.longpress.min_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `input.profiles.<name>.gesture_thresholds.longpress.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.profiles.<name>.gesture_thresholds.swipe` | object |  |  |  |
| `input.profiles.<name>.gesture_thresholds.swipe.min_distance` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.profiles.<name>.gesture_thresholds.swipe.min_velocity` | number |  |  | stage lengths per second. min 0 |
| `input.profiles.<name>.gesture_thresholds.swipe.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `input.profiles.<name>.gesture_thresholds.drag` | object |  |  |  |
| `input.profiles.<name>.gesture_thresholds.drag.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.profiles.<name>.fire_on` | one of |  | `"up"` | when taps fire; affects RT by the press duration. values: `"down"`, `"up"` |
| `input.profiles.<name>.pointer_path` | one of several forms |  |  | Record pointer trajectories (input.pointer.path). Off by default; keyboard-only trials record none |
| `input.profiles.<name>.pointer_path.hz` | number |  |  | min 1 |
| `input.profiles.<name>.hit_padding` | one of several forms |  |  | Extra tolerance around registered targets (larger on touch) |
| `input.profiles.<name>.show_zones` | boolean |  | `false` | outline mapped touch regions |
| `input.profiles.<name>.cursor` | object |  |  | Mouse cursor behaviour (no effect on touch) |
| `input.profiles.<name>.cursor.autohide_ms` | number |  | `1000` | 0 disables autohide. min 0 |
| `input.profiles.<name>.cursor.show_on_move_px` | number |  | `3` | min 0 |
| `input.disable` | list of string |  |  | Inherited intent ids to remove |
| `input.gestures` | list of one of |  |  | Gestures the recognizer runs. Enabling only what a trial needs avoids ambiguity and latency |
| `input.gesture_thresholds` | object |  |  |  |
| `input.gesture_thresholds.tap` | object |  |  |  |
| `input.gesture_thresholds.tap.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `input.gesture_thresholds.tap.max_duration.frames` | integer | yes |  | min 1 |
| `input.gesture_thresholds.tap.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.gesture_thresholds.longpress` | object |  |  |  |
| `input.gesture_thresholds.longpress.min_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `input.gesture_thresholds.longpress.min_duration.frames` | integer | yes |  | min 1 |
| `input.gesture_thresholds.longpress.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.gesture_thresholds.swipe` | object |  |  |  |
| `input.gesture_thresholds.swipe.min_distance` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.gesture_thresholds.swipe.min_velocity` | number |  |  | stage lengths per second. min 0 |
| `input.gesture_thresholds.swipe.max_duration` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `input.gesture_thresholds.swipe.max_duration.frames` | integer | yes |  | min 1 |
| `input.gesture_thresholds.drag` | object |  |  |  |
| `input.gesture_thresholds.drag.slop` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.fire_on` | one of |  |  | values: `"down"`, `"up"` |
| `input.pointer_path` | one of several forms |  |  | Record pointer trajectories (input.pointer.path). Off by default; keyboard-only trials record none |
| `input.pointer_path.hz` | number |  |  | min 1 |
| `input.hit_padding` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `input.show_zones` | boolean |  |  |  |
| `input.cursor` | object |  |  | Mouse cursor behaviour (no effect on touch) |
| `input.cursor.autohide_ms` | number |  | `1000` | 0 disables autohide. min 0 |
| `input.cursor.show_on_move_px` | number |  | `3` | min 0 |
| `triggers` | object |  |  | experiment.yaml level - scope plus session-wide sinks |
| `triggers.enabled` | boolean |  | `true` |  |
| `triggers.sinks` | list of one of several forms |  |  |  |
| `triggers.defaults` | object |  |  |  |
| `triggers.defaults.min_gap_ms` | number |  | `0` | min 0 |
| `triggers.rules` | list of object |  |  |  |
| `triggers.rules[].id` | string | yes |  | Trigger rule id. Inline 'trigger:' values in stimuli.yaml compile to rules with the reserved id stim:<stimulus name>, so blocks can override them. pattern `"^(stim:)?[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `triggers.rules[].on` | string |  |  | Namespaced event name. A trailing '*' segment is a glob (input.*). pattern `"^[a-z][a-z0-9_]*(\\.([a-z0-9_]+\|\\*))*$"` |
| `triggers.rules[].where` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `triggers.rules[].where.all` | list of object |  |  | min items 1 |
| `triggers.rules[].where.all[].all` | list of object |  |  | min items 1 |
| `triggers.rules[].where.all[].any` | list of object |  |  | min items 1 |
| `triggers.rules[].where.all[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `triggers.rules[].where.any` | list of object |  |  | min items 1 |
| `triggers.rules[].where.any[].all` | list of object |  |  | min items 1 |
| `triggers.rules[].where.any[].any` | list of object |  |  | min items 1 |
| `triggers.rules[].where.any[].not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `triggers.rules[].where.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `triggers.rules[].where.not.all` | list of object |  |  | min items 1 |
| `triggers.rules[].where.not.any` | list of object |  |  | min items 1 |
| `triggers.rules[].where.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `triggers.rules[].where.not.not.all` | list of object |  |  | min items 1 |
| `triggers.rules[].where.not.not.any` | list of object |  |  | min items 1 |
| `triggers.rules[].where.not.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `triggers.rules[].value` | one of several forms |  |  | A literal, a value read from the event/context, or a lookup table |
| `triggers.rules[].value.from` | string | yes |  | Dotted path into an event's data or the context (target.role, subject.age). pattern `"^[a-z_][a-z0-9_]*(\\.[a-z0-9_]+)*$"` |
| `triggers.rules[].value.map` | object | yes |  |  |
| `triggers.rules[].value.map.by` | string | yes |  | Dotted path into an event's data or the context (target.role, subject.age). pattern `"^[a-z_][a-z0-9_]*(\\.[a-z0-9_]+)*$"` |
| `triggers.rules[].value.map.table` | object | yes |  |  |
| `triggers.rules[].value.map.default` | integer |  |  | min 0 |
| `triggers.rules[].sinks` | list of string |  |  | Subset of defined sinks; default all. min items 1 |
| `triggers.rules[].once` | boolean |  | `false` |  |
| `triggers.rules[].priority` | integer |  | `0` |  |
| `triggers.rules[].allow_multiple` | boolean |  | `false` | Silence the compiler warning when this rule fires alongside another on the same event |
| `triggers.disable` | list of string |  |  |  |
| `eyetracking` | object |  |  |  |
| `eyetracking.enabled` | boolean | yes |  |  |
| `eyetracking.engine` | one of |  | `"webgazer"` | values: `"webgazer"` |
| `eyetracking.profiles` | list of string |  | `["desktop"]` |  |
| `eyetracking.sample_hz` | number |  | `30` | min 1. max 120 |
| `eyetracking.calibration` | object |  |  |  |
| `eyetracking.calibration.points` | one of |  | `9` | values: `5`, `9`, `13` |
| `eyetracking.calibration.repeats` | integer |  | `2` | min 1 |
| `eyetracking.validation` | object |  |  |  |
| `eyetracking.validation.points` | integer |  | `5` | min 3 |
| `eyetracking.validation.max_error_px` | number |  | `150` | min 1 |
| `eyetracking.validation.max_retries` | integer |  | `3` | min 0 |
| `eyetracking.validation.on_fail` | one of |  | `"retry"` | values: `"retry"`, `"continue_flagged"`, `"abort"` |
| `eyetracking.revalidate` | object |  |  |  |
| `eyetracking.revalidate.every_trials` | integer |  |  | min 1 |
| `eyetracking.revalidate.every_minutes` | number |  |  | min 1 |
| `eyetracking.dwell` | object |  |  | Thresholds for the derived input.gaze.dwell event |
| `eyetracking.dwell.radius` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `eyetracking.dwell.min_ms` | number |  | `100` | min 0 |
| `eyetracking.learn_from_clicks` | boolean |  | `false` | Let clicks silently recalibrate WebGazer mid-task. Off keeps calibration fixed |
| `eyetracking.camera` | object |  |  |  |
| `eyetracking.camera.preview` | one of |  | `"setup_only"` | values: `"setup_only"`, `"always"`, `"never"` |
| `eyetracking.camera.on_denied` | one of |  | `"abort"` | values: `"abort"`, `"continue_without"` |
| `overlay` | object |  |  |  |
| `overlay.apriltags` | object |  |  |  |
| `overlay.apriltags.enabled` | boolean | yes |  |  |
| `overlay.apriltags.family` | one of |  | `"tag36h11"` | values: `"tag36h11"`, `"tag25h9"`, `"tag16h5"`, `"tagStandard41h12"`, `"tagStandard52h13"`, `"tagCircle21h7"` |
| `overlay.apriltags.ids` | list of integer |  | `[0,1,2,3]` | Tag ids for the corners in order top-left, top-right, bottom-right, bottom-left. min items 4. max items 4 |
| `overlay.apriltags.size` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `overlay.apriltags.margin` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `overlay.apriltags.quiet_zone` | number |  | `1` | white border, in tag modules. min 1 |
| `overlay.photodiode` | object |  |  |  |
| `overlay.photodiode.enabled` | boolean | yes |  |  |
| `overlay.photodiode.corner` | one of |  | `"bl"` | values: `"tl"`, `"tr"`, `"br"`, `"bl"` |
| `overlay.photodiode.size` | one of several forms |  |  | Bare number = fraction of the stage's shorter side. Strings carry a unit: mm and deg need calibration, px is CSS pixels, % is of the stage width |
| `overlay.photodiode.mode` | one of |  | `"toggle"` | values: `"toggle"`, `"pulse"` |
| `overlay.photodiode.pulse_ms` | number |  |  | min 1 |
| `overlay.photodiode.on` | list of object |  |  | Events that flip/pulse the patch. Default - every phase.onset. min items 1 |
| `overlay.photodiode.on[].on` | string | yes |  | Namespaced event name. A trailing '*' segment is a glob (input.*). pattern `"^[a-z][a-z0-9_]*(\\.([a-z0-9_]+\|\\*))*$"` |
| `overlay.photodiode.on[].where` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `overlay.photodiode.on[].where.all` | list of object |  |  | min items 1 |
| `overlay.photodiode.on[].where.any` | list of object |  |  | min items 1 |
| `overlay.photodiode.on[].where.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `overlay.photodiode.on[].where.not.all` | list of object |  |  | min items 1 |
| `overlay.photodiode.on[].where.not.any` | list of object |  |  | min items 1 |
| `overlay.photodiode.on[].where.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `overlay.photodiode.on[].min_ms` | number |  |  | Minimum duration for events that have one (e.g. gaze dwell). min 0 |
| `storage` | object |  |  |  |
| `storage.local` | object |  |  |  |
| `storage.local.enabled` | boolean |  | `true` |  |
| `storage.local.flush_ms` | number |  | `2000` | min 100 |
| `storage.local.recovery` | one of |  | `"offer"` | What to do when an unfinished session is found after a reload. values: `"offer"`, `"auto"`, `"off"` |
| `storage.local.export_on_finish` | list of one of |  |  |  |
| `storage.local.file_access` | boolean |  | `false` | Also write to a chosen folder via the File System Access API where available |
| `storage.firebase` | object |  |  |  |
| `storage.firebase.enabled` | boolean | yes |  |  |
| `storage.firebase.experiment_id` | string |  |  | Root document id in Firestore. Defaults to a slug of 'name'. pattern `"^[a-z0-9][a-z0-9-]{1,40}$"` |
| `storage.firebase.access` | one of |  |  | controlled = experimenter-run sessions, subject ID prefilled and overridable; public = open link, subject ID server-assigned and locked. values: `"controlled"`, `"public"` |
| `storage.firebase.web_config` | object |  |  | Firebase web app config (public identifiers, not secrets) |
| `storage.firebase.web_config.<name>` | string |  |  |  |
| `storage.firebase.subject_id` | object |  |  |  |
| `storage.firebase.subject_id.width` | integer |  | `3` | zero-padded digits after sub-. min 1. max 8 |
| `storage.firebase.subject_id.override` | boolean |  | `false` |  |
| `storage.firebase.subject_id.claim_timeout_min` | number |  | `60` | unfinished claims older than this may be released. min 1 |
| `storage.firebase.chunk` | object |  |  |  |
| `storage.firebase.chunk.max_events` | integer |  | `400` | min 10. max 5000 |
| `storage.firebase.chunk.max_bytes` | integer |  | `600000` | Firestore documents are capped at 1 MiB. min 10000. max 900000 |
| `storage.firebase.chunk.flush_ms` | number |  | `10000` | Flush a non-empty buffer after this long. Each flush is one billed write; 10 s or more suits public studies, the local journal covers the gap. min 500 |
| `storage.firebase.app_check` | object |  |  |  |
| `storage.firebase.app_check.provider` | one of | yes |  | values: `"recaptcha_v3"`, `"recaptcha_enterprise"` |
| `storage.firebase.app_check.site_key` | string | yes |  |  |
| `finish` | object |  |  |  |
| `finish.message` | string |  |  | markdown shown at the end |
| `finish.redirect_url` | string |  |  | pattern `"^https?://"` |
| `finish.redirect_delay` | one of several forms |  |  | Milliseconds (number), a string like '1.5s' / '200ms', or {frames} |
| `finish.redirect_delay.frames` | integer | yes |  | min 1 |
| `finish.show_session_code` | boolean |  | `false` |  |
| `debug` | object |  |  |  |
| `debug.enabled` | boolean |  | `false` |  |
| `debug.log_level` | one of |  | `"warn"` | values: `"error"`, `"warn"`, `"info"`, `"debug"` |
| `debug.show_events` | boolean |  | `false` |  |
| `debug.simulate_profile` | string |  |  | Device profile id (built in - desktop, phone, tablet - or custom). pattern `"^[a-z][a-z0-9_]*$"` |
| `debug.time_scale` | number |  |  | Multiply all durations (e.g. 0.2 for fast dry runs). Never stored as valid data |

