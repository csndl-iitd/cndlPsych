# Reaction task: an example experiment

A working experiment made with the expfw framework: consent, subject and session forms, instructions, and a simple reaction-time task (press SPACE on a computer, tap on a phone or tablet). The experiment is the YAML files and `index.html`; `expfw/` is the framework itself and is not edited.

    node cli/expfw.js serve <this folder>     # from a checkout of the framework (branch main), or any static file server
    open http://localhost:8080

- `experiment.yaml`: settings. Everything not used is shown commented out with its default.
- `timeline.yaml`, `stimuli.yaml`, `forms.yaml`, `consent.md`: what happens, what is shown, what is asked.
- `firebase.json`, `firebase/`: Hosting and Firestore rules, written by `expfw deploy`. `storage.firebase.web_config` in `experiment.yaml` names the Firebase project of the lab that made this example; use your own to store data.
- Eye tracking is off, so the GPL-licensed `expfw-eyetracking/` add-on is not included.

`expfw/` was copied from the framework on branch `main` (commit 6ba8ccc).
