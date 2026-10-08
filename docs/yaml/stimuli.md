# stimuli.yaml

_Generated from the schemas in `spec/schema/` by `tools/build-docs.js`; do not edit by hand. The schemas themselves are the contract: `expfw validate` reports anything outside them with the file and the path._

Everything a participant sees or hears, and the styles used by HTML stimuli.

Paths are written as in the YAML: `a.b` is key `b` inside `a`; `items[]` is each entry of a list; `<name>` is a key you choose.

| Key | Type | Required | Default | Description |
|---|---|---|---|---|
| `styles` | object |  |  | Named style sets (CSS properties) referenced from 'style' |
| `styles.<name>` | object |  |  |  |
| `styles.<name>.<name>` | string or number |  |  |  |
| `stimuli` | list of object | yes |  | min items 1 |
| `stimuli[].name` | string | yes |  | Id, or a template containing {value} / {index} when 'each' is used. pattern `"^[\\p{L}_{][\\p{L}\\p{N}_.{}-]*$"` |
| `stimuli[].type` | string | yes |  | Built in: html, text, image, audio, shape, fill, blank. Any other value names a custom generator in custom/stimuli/<type>.js |
| `stimuli[].each` | list of string or number |  |  | min items 1 |
| `stimuli[].trigger` | integer |  |  | Sugar for a lowest-scope trigger rule on this stimulus's onset (id stim:<name>). min 0 |
| `stimuli[].trigger_base` | integer |  |  | With 'each' - trigger = base + index. min 0 |
| `stimuli[].duration` | one of several forms |  |  | How long it stays; null = until a response ends the phase |
| `stimuli[].post` | one of several forms |  |  | Gap after the stimulus (a [min, max] pair jitters) |
| `stimuli[].post[].frames` | integer | yes |  | min 1 |
| `stimuli[].style` | one of several forms |  |  |  |
| `stimuli[].class` | string |  |  |  |
| `stimuli[].position` | object |  |  |  |
| `stimuli[].position.x` | number |  |  | min 0. max 1 |
| `stimuli[].position.y` | number |  |  | min 0. max 1 |
| `stimuli[].html` | string |  |  |  |
| `stimuli[].text` | string |  |  |  |
| `stimuli[].size` | one of several forms |  |  |  |
| `stimuli[].color` | string |  |  |  |
| `stimuli[].font` | string |  |  |  |
| `stimuli[].weight` | one of several forms |  |  |  |
| `stimuli[].align` | one of |  |  | values: `"left"`, `"center"`, `"right"` |
| `stimuli[].src` | string |  |  |  |
| `stimuli[].alt` | string |  |  |  |
| `stimuli[].fit` | one of |  |  | values: `"contain"`, `"cover"` |
| `stimuli[].volume` | number |  |  | min 0. max 1 |
| `stimuli[].loop` | boolean |  |  |  |
| `stimuli[].shape` | one of |  |  | values: `"circle"`, `"square"`, `"rect"`, `"cross"` |
| `stimuli[].cover` | one of |  | `"viewport"` | For type fill - cover the stage or the whole viewport (overlays stay on top). values: `"stage"`, `"viewport"` |
| `stimuli[].params` | object |  |  |  |

