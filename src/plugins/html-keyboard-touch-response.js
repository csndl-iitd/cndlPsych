export class HtmlKeyboardTouchResponsePlugin {
    constructor(jsPsych) {
        this.jsPsych = jsPsych;
    }
    static info = {
        name: "html-keyboard-touch-response",
        version: "2.0.0",
        parameters: {
            stimulus: {
                type: jsPsychModule.ParameterType.HTML_STRING,
                default: undefined
            },
            choices: {
                type: jsPsychModule.ParameterType.KEYS,
                default: "ALL_KEYS"
            },
            prompt: {
                type: jsPsychModule.ParameterType.HTML_STRING,
                default: null
            },
            stimulus_duration: {
                type: jsPsychModule.ParameterType.INT,
                default: null
            },
            trial_duration: {
                type: jsPsychModule.ParameterType.INT,
                default: null
            },
            response_ends_trial: {
                type: jsPsychModule.ParameterType.BOOL,
                default: true
            },
            touch_mapping: {
                type: jsPsychModule.ParameterType.COMPLEX,
                default: null
            }
        },
        data: {
            response: { type: jsPsychModule.ParameterType.STRING },
            response_type: { type: jsPsychModule.ParameterType.STRING },
            response_x: { type: jsPsychModule.ParameterType.FLOAT },
            response_y: { type: jsPsychModule.ParameterType.FLOAT },
            rt: { type: jsPsychModule.ParameterType.INT },
            stimulus: { type: jsPsychModule.ParameterType.STRING }
        }
    };

    trial(display_element, trial) {
        var new_html = '<div id="jspsych-html-keyboard-response-stimulus">' + trial.stimulus + "</div>";
        if (trial.prompt !== null) {
            new_html += trial.prompt;
        }
        display_element.innerHTML = new_html;

        var response = {
            rt: null,
            key: null,
            type: null,
            x: null,
            y: null
        };

        var keyboardListener;
        var touchListener;

        const end_trial = () => {
            if (typeof keyboardListener !== "undefined") {
                this.jsPsych.pluginAPI.cancelKeyboardResponse(keyboardListener);
            }
            if (typeof touchListener !== "undefined") {
                window.removeEventListener('pointerdown', touchListener);
                window.removeEventListener('touchstart', touchListener, { passive: false }); // Fallback
            }

            var trial_data = {
                rt: response.rt,
                stimulus: trial.stimulus,
                response: response.key,
                response_type: response.type,
                response_x: response.x,
                response_y: response.y
            };
            this.jsPsych.finishTrial(trial_data);
        };

        var after_keyboard_response = (info) => {
            display_element.querySelector("#jspsych-html-keyboard-response-stimulus").classList.add("responded");
            if (response.key == null) {
                response = {
                    rt: info.rt,
                    key: info.key,
                    type: 'keyboard',
                    x: null,
                    y: null
                };
            }
            if (trial.response_ends_trial) {
                end_trial();
            }
        };

        // Check if choices indicates NO_KEYS (can be a string or an array in jsPsych)
        const hasNoKeys = trial.choices === "NO_KEYS" || (Array.isArray(trial.choices) && trial.choices.includes("NO_KEYS")) || (Array.isArray(trial.choices) && trial.choices.length === 0);

        if (!hasNoKeys) {
            keyboardListener = this.jsPsych.pluginAPI.getKeyboardResponse({
                callback_function: after_keyboard_response,
                valid_responses: trial.choices,
                rt_method: "performance",
                persist: false,
                allow_held_key: false
            });
        }



        // --- Touch Logic ---
        if (!hasNoKeys) {
            var start_time = performance.now();
            touchListener = (e) => {
                if (response.key == null) {
                    const rt = Math.round(performance.now() - start_time);
                    let mappedKey = "unmapped";

                    // Handle touchstart fallback for coordinates
                    let clientX = e.clientX;
                    let clientY = e.clientY;
                    if (e.type === 'touchstart' && e.touches && e.touches.length > 0) {
                        clientX = e.touches[0].clientX;
                        clientY = e.touches[0].clientY;
                        if (e.cancelable) e.preventDefault(); // Prevent ghost clicks
                    } else if (e.type === 'pointerdown') {
                        // Pointer events can also trigger default behaviors
                        if (e.cancelable) e.preventDefault();
                    }

                    // Evaluate touch mapping if provided
                    if (trial.touch_mapping && Array.isArray(trial.touch_mapping)) {
                        const normX = clientX / window.innerWidth;
                        const normY = clientY / window.innerHeight;

                        for (const zone of trial.touch_mapping) {
                            const xMin = zone.x[0];
                            const xMax = zone.x[1];
                            const yMin = zone.y[0];
                            const yMax = zone.y[1];

                            if (normX >= xMin && normX <= xMax && normY >= yMin && normY <= yMax) {
                                mappedKey = zone.key;
                                break;
                            }
                        }
                    }

                    response = {
                        rt: rt,
                        key: mappedKey,
                        type: 'touch',
                        x: clientX,
                        y: clientY
                    };

                    const stimEl = display_element.querySelector("#jspsych-html-keyboard-response-stimulus");
                    if (stimEl) stimEl.classList.add("responded");

                    if (trial.response_ends_trial) {
                        end_trial();
                    }
                }
            };

            // Listen for taps anywhere on the window
            window.addEventListener('pointerdown', touchListener);
            window.addEventListener('touchstart', touchListener, { passive: false });
        }

        // --- Timers ---
        if (trial.stimulus_duration !== null) {
            this.jsPsych.pluginAPI.setTimeout(() => {
                const stimEl = display_element.querySelector("#jspsych-html-keyboard-response-stimulus");
                if (stimEl) stimEl.style.visibility = "hidden";
            }, trial.stimulus_duration);
        }
        if (trial.trial_duration !== null) {
            this.jsPsych.pluginAPI.setTimeout(end_trial, trial.trial_duration);
        }
    }

    simulate(trial, simulation_mode, simulation_options, load_callback) {
        if (simulation_mode == "data-only") {
            load_callback();
            this.simulate_data_only(trial, simulation_options);
        }
        if (simulation_mode == "visual") {
            this.simulate_visual(trial, simulation_options, load_callback);
        }
    }

    create_simulation_data(trial, simulation_options) {
        const default_data = {
            stimulus: trial.stimulus,
            rt: this.jsPsych.randomization.sampleExGaussian(500, 50, 1 / 150, true),
            response: this.jsPsych.pluginAPI.getValidKey(trial.choices),
            response_type: 'keyboard',
            response_x: null,
            response_y: null
        };
        const data = this.jsPsych.pluginAPI.mergeSimulationData(default_data, simulation_options);
        this.jsPsych.pluginAPI.ensureSimulationDataConsistency(trial, data);
        return data;
    }

    simulate_data_only(trial, simulation_options) {
        const data = this.create_simulation_data(trial, simulation_options);
        this.jsPsych.finishTrial(data);
    }

    simulate_visual(trial, simulation_options, load_callback) {
        const data = this.create_simulation_data(trial, simulation_options);
        const display_element = this.jsPsych.getDisplayElement();
        this.trial(display_element, trial);
        load_callback();
        if (data.rt !== null) {
            this.jsPsych.pluginAPI.pressKey(data.response, data.rt);
        }
    }
}
