# forms.yaml

_Generated from the schemas in `spec/schema/` by `tools/build-docs.js`; do not edit by hand. The schemas themselves are the contract: `cndlpsych validate` reports anything outside them with the file and the path._

Questions beyond the built-in subject ID, sex, age and session ID, and any extra forms a survey block can show.

Paths are written as in the YAML: `a.b` is key `b` inside `a`; `items[]` is each entry of a list; `<name>` is a key you choose.

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `subject` | object |  |  |  |
| `subject.title` | string |  |  |  |
| `subject.intro` | string |  |  |  |
| `subject.questions` | list of any |  |  | Appended after the built-in fields |
| `subject.overrides` | object |  |  | Keyed by built-in field name (subject_id, sex, age, session_id) |
| `subject.overrides.<name>` | object |  |  | Presentation-only changes to a built-in field |
| `subject.overrides.<name>.prompt` | string |  |  |  |
| `subject.overrides.<name>.help` | string |  |  |  |
| `subject.overrides.<name>.placeholder` | string |  |  |  |
| `subject.overrides.<name>.options` | list of one of several forms |  |  | Relabel the sex options (values still map to BIDS male / female / other / n/a) |
| `subject.overrides.<name>.options[].value` | string or number | yes |  |  |
| `subject.overrides.<name>.options[].label` | string | yes |  |  |
| `subject.overrides.<name>.min` | number |  |  |  |
| `subject.overrides.<name>.max` | number |  |  |  |
| `subject.overrides.<name>.required` | boolean |  |  |  |
| `session` | object |  |  |  |
| `session.title` | string |  |  |  |
| `session.intro` | string |  |  |  |
| `session.questions` | list of any |  |  | Appended after the built-in fields |
| `session.overrides` | object |  |  | Keyed by built-in field name (subject_id, sex, age, session_id) |
| `session.overrides.<name>` | object |  |  | Presentation-only changes to a built-in field |
| `session.overrides.<name>.prompt` | string |  |  |  |
| `session.overrides.<name>.help` | string |  |  |  |
| `session.overrides.<name>.placeholder` | string |  |  |  |
| `session.overrides.<name>.options` | list of one of several forms |  |  | Relabel the sex options (values still map to BIDS male / female / other / n/a) |
| `session.overrides.<name>.options[].value` | string or number | yes |  |  |
| `session.overrides.<name>.options[].label` | string | yes |  |  |
| `session.overrides.<name>.min` | number |  |  |  |
| `session.overrides.<name>.max` | number |  |  |  |
| `session.overrides.<name>.required` | boolean |  |  |  |
| `forms` | list of object |  |  | Ordinary survey forms, run by 'survey' blocks in timeline.yaml |
| `forms[].id` | string | yes |  | Block, trial, stimulus, rule or sink id. Unicode letters allowed (e.g. oddball_Ǝ). pattern `"^[\\p{L}_][\\p{L}\\p{N}_.-]*$"` |
| `forms[].title` | string |  |  |  |
| `forms[].intro` | string |  |  | markdown |
| `forms[].questions` | list of object | yes |  | min items 1 |
| `forms[].questions[].name` | string | yes |  | Lower-case identifier (intent, profile, field, style names). pattern `"^[a-z][a-z0-9_]*$"` |
| `forms[].questions[].prompt` | string | yes |  | min length 1 |
| `forms[].questions[].type` | one of |  | `"text"` | values: `"text"`, `"textarea"`, `"number"`, `"multi-choice"`, `"multi-select"`, `"dropdown"`, `"likert"`, `"date"` |
| `forms[].questions[].required` | boolean |  | `false` |  |
| `forms[].questions[].options` | list of one of several forms |  |  | min items 2 |
| `forms[].questions[].scale` | object |  |  | For likert |
| `forms[].questions[].scale.min` | integer | yes |  |  |
| `forms[].questions[].scale.max` | integer | yes |  |  |
| `forms[].questions[].scale.labels` | object |  |  |  |
| `forms[].questions[].scale.labels.min` | string |  |  |  |
| `forms[].questions[].scale.labels.max` | string |  |  |  |
| `forms[].questions[].min` | number |  |  | numeric minimum, or minimum length for text |
| `forms[].questions[].max` | number |  |  |  |
| `forms[].questions[].pattern` | string |  |  |  |
| `forms[].questions[].placeholder` | string |  |  |  |
| `forms[].questions[].default` | string or number or boolean |  |  |  |
| `forms[].questions[].help` | string |  |  |  |
| `forms[].questions[].unit` | string |  |  |  |
| `forms[].questions[].rows` | integer |  |  | min 1 |
| `forms[].questions[].show_if` | object |  |  | Show only when the predicate holds over earlier answers in this form |
| `forms[].questions[].show_if.all` | list of object |  |  | min items 1 |
| `forms[].questions[].show_if.any` | list of object |  |  | min items 1 |
| `forms[].questions[].show_if.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `forms[].questions[].show_if.not.all` | list of object |  |  | min items 1 |
| `forms[].questions[].show_if.not.any` | list of object |  |  | min items 1 |
| `forms[].questions[].show_if.not.not` | object |  |  | Map of field path -> condition, all of which must hold. Combine with all / any / not. Keys such as target.role are dotted paths |
| `forms[].submit_label` | string |  |  |  |
| `forms[].data` | object |  |  | Extra fields attached to the form.submitted event |

