# Visual oddball and visual search

Two tasks, made with the cndlpsych framework (`cndlpsych/` is the framework and is not edited; the experiment is the YAML files, `custom/` and `index.html`).

1. **Visual oddball** (`oddball_task`): 5 trials. Each shows a fixation cross, then the letters A B C D E F H I L Ǝ twice in random order, 200 ms each with 300 ms gaps. The participant responds (SPACE, or a tap) at the **second** Ǝ; a response after it has appeared is correct and is timed from its onset (even when a later letter is already showing), a response before it is incorrect, and the first response ends the trial. Triggers: letters 100-109, fixation 1, instructions 9, correct 21, incorrect 22, no response 23.
2. **Visual search** (`visual_search`): 16 trials in random order.
   - **Top-down** (12 trials, `search_topdown`): two target **E** among ten distractors that are **E mirrored left to right**, all the same colour, so the targets are found only by their orientation; the letters are small (`size: 16px`) to make it harder.
   - **Bottom-up** (4 trials, `search_bottomup`): the same letters (16 px), but the targets are orange-red, so they pop out.
   - On a computer the participant presses SPACE after finding both targets. On a phone or tablet they tap both targets (two different targets; taps on distractors do not count). 10 s maximum per trial.
   - Triggers: fixation 30, top-down array on 31, bottom-up array on 34, both found 32, array off 33.

An experimental-group session ends with a short questionnaire (`post_task` in `forms.yaml`).

Change the numbers of trials (`repetitions`), the colours (`stimuli.yaml`, `target_color`), the set size (`distractors`) and the maximum time (`timeout`) in the YAML. `custom/stimuli/search_array.js` places the symbols.

Triggers are sent only when a device is connected: remove the `#` of a sink under `triggers:` in `experiment.yaml`. AprilTags are drawn in the corners (for a head-mounted eye tracker); the photodiode patch is commented out.

    node <framework>/cli/cndlpsych.js validate .
    node <framework>/cli/cndlpsych.js serve .      # then open http://localhost:8080
