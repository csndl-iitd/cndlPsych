# YAML reference

One page per file, generated from the schemas. Start from `expfw init <folder>`: the template is a complete, working experiment.

- [experiment.yaml](experiment.md) - Who can take part, what is stored, how responses and triggers work.
- [forms.yaml](forms.md) - Questions beyond the built-in subject ID, sex, age and session ID, and any extra forms a survey block can show.
- [stimuli.yaml](stimuli.md) - Everything a participant sees or hears, and the styles used by HTML stimuli.
- [timeline.yaml](timeline.md) - The order of blocks.

Custom stimuli and tasks (JavaScript in `custom/`) follow `spec/types.d.ts`.
