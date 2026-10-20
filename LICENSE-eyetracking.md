# cndlpsych-eyetracking

This folder is the eye tracking add-on for cndlpsych. It contains **WebGazer**
(https://webgazer.cs.brown.edu, Copyright Brown WebGazer Team), which is licensed under the
**GNU General Public License, version 3 or later** (see `LICENSE.md`), together with the face
model files it loads (`mediapipe/`, see `THIRD-PARTY-LICENSES.txt`).

It is a separate folder on purpose. The rest of cndlpsych (`cndlpsych/`) is MIT-licensed and does not
contain WebGazer. If you put this folder on a website, the website serves GPL-licensed software
to its visitors' browsers; the GPL then requires that they can get the corresponding source:

- WebGazer's source: https://github.com/brownhci/WebGazer (npm package `webgazer`, version in `VERSION`)
- the build entry for this folder: `bundle/eyetracking-addon.js` in the cndlpsych repository

Experiments that do not use eye tracking do not need this folder. To use it, copy it next to
`cndlpsych/` (or create the experiment with `cndlpsych init <dir> --eyetracking`) and set
`eyetracking.enabled: true` in `experiment.yaml`.

This is a description, not legal advice: check with your institution what the GPL means for how
you publish your own experiment.
