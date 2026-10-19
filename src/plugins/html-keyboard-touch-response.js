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
            stimulus: { type: jsPsychModule.ParameterType.STRING },
            touch_data: { type: jsPsychModule.ParameterType.COMPLEX }
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

        let end_trial = () => {
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
                response_y: response.y,
                touch_data: response.touch_data
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
            
            var touch_data = {
                events: [],
                paths: []
            };

            var mappingState = {};
            if (trial.touch_mapping) {
                trial.touch_mapping.forEach(m => {
                    mappingState[m.key] = { count: 0, targets: new Set(), config: m };
                });
            }

            var activePointers = new Map();

            const checkMappingGoal = (mappedKey) => {
                const state = mappingState[mappedKey];
                if (!state) return false;
                const required = state.config.require || 1;
                return state.count >= required;
            };

            const registerMappingHit = (mappingConfig, targetElement) => {
                const state = mappingState[mappingConfig.key];
                if (mappingConfig.type === 'selector' && targetElement) {
                    if (!state.targets.has(targetElement)) {
                        state.targets.add(targetElement);
                        state.count++;
                    }
                } else {
                    state.count++;
                }
                return checkMappingGoal(mappingConfig.key);
            };

            const triggerEndTrial = (mappedKey, x, y, rt) => {
                if (response.key != null) return;
                response = { rt: rt, key: mappedKey, type: 'touch', x: x, y: y, touch_data: touch_data };
                const stimEl = display_element.querySelector("#jspsych-html-keyboard-response-stimulus");
                if (stimEl) stimEl.classList.add("responded");
                if (trial.response_ends_trial) end_trial();
            };

            const handlePointerDown = (e) => {
                if (response.key != null) return;
                if (e.pointerType === "mouse" && e.button !== 0) return; // Ignore right-clicks

                // For touch interfaces to prevent scrolling during interaction
                if (e.cancelable && trial.touch_mapping && trial.touch_mapping.some(m => m.type === "drag" || m.type === "swipe")) {
                    e.preventDefault();
                }

                activePointers.set(e.pointerId, {
                    dragPath: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
                    lastSampleTime: performance.now(),
                    dragStartEvent: e
                });

                let hitKey = null;
                let hitElement = null;

                if (trial.touch_mapping) {
                    const targetEl = e.target.nodeType === Node.TEXT_NODE ? e.target.parentElement : e.target;
                    for (const m of trial.touch_mapping) {
                        if (m.type === 'selector') {
                            if (targetEl && targetEl.closest && targetEl.closest(m.selector)) {
                                hitKey = m.key;
                                hitElement = targetEl.closest(m.selector);
                                break;
                            }
                        } else if (m.type === 'area' || m.type === undefined) {
                            const normX = e.clientX / window.innerWidth;
                            const normY = e.clientY / window.innerHeight;
                            if (m.x && m.y && normX >= m.x[0] && normX <= m.x[1] && normY >= m.y[0] && normY <= m.y[1]) {
                                hitKey = m.key;
                                break;
                            }
                        }
                    }
                }

                const rt = Math.round(performance.now() - start_time);
                touch_data.events.push({
                    type: 'tap',
                    x: e.clientX,
                    y: e.clientY,
                    rt: rt,
                    target_key: hitKey || 'unmapped'
                });

                if (hitKey) {
                    if (registerMappingHit(mappingState[hitKey].config, hitElement)) {
                        triggerEndTrial(hitKey, e.clientX, e.clientY, rt);
                    }
                }
            };

            const handlePointerMove = (e) => {
                const ptr = activePointers.get(e.pointerId);
                if (!ptr) return;
                
                if (e.cancelable && trial.touch_mapping && trial.touch_mapping.some(m => m.type === "drag" || m.type === "swipe")) {
                    e.preventDefault();
                }
                const now = performance.now();
                if (now - ptr.lastSampleTime >= 10) {
                    ptr.dragPath.push({ x: e.clientX, y: e.clientY, t: now });
                    ptr.lastSampleTime = now;
                }
            };

            const handlePointerUp = (e) => {
                const ptr = activePointers.get(e.pointerId);
                if (!ptr) return;
                
                ptr.dragPath.push({ x: e.clientX, y: e.clientY, t: performance.now() });
                
                const dx = e.clientX - ptr.dragStartEvent.clientX;
                const dy = e.clientY - ptr.dragStartEvent.clientY;
                const distance = Math.sqrt(dx*dx + dy*dy);
                
                if (distance > 10) {
                    let dragDirection = 'any';
                    if (Math.abs(dx) > Math.abs(dy)) {
                        dragDirection = dx > 0 ? 'right' : 'left';
                    } else {
                        dragDirection = dy > 0 ? 'down' : 'up';
                    }

                    touch_data.paths.push({
                        start_x: ptr.dragStartEvent.clientX,
                        start_y: ptr.dragStartEvent.clientY,
                        end_x: e.clientX,
                        end_y: e.clientY,
                        distance: distance,
                        direction: dragDirection,
                        path: ptr.dragPath
                    });

                    let hitKey = null;
                    if (trial.touch_mapping) {
                        for (const m of trial.touch_mapping) {
                            if (m.type === 'drag' || m.type === 'swipe') {
                                const min_dist = m.min_distance || 50;
                                if (distance >= min_dist && (m.direction === 'any' || m.direction === dragDirection)) {
                                    hitKey = m.key;
                                    break;
                                }
                            }
                        }
                    }

                    if (hitKey) {
                        if (registerMappingHit(mappingState[hitKey].config, null)) {
                            const rt = Math.round(performance.now() - start_time);
                            triggerEndTrial(hitKey, e.clientX, e.clientY, rt);
                        }
                    }
                }

                activePointers.delete(e.pointerId);
            };

            let touchListener = handlePointerDown; // keeping for backward-compat end_trial cleanup if needed
            window.addEventListener('pointerdown', handlePointerDown, { passive: false });
            window.addEventListener('pointermove', handlePointerMove, { passive: false });
            window.addEventListener('pointerup', handlePointerUp);
            window.addEventListener('pointercancel', handlePointerUp);
            
            // Override end_trial to clean up all listeners
            const original_end_trial = end_trial;
            end_trial = () => {
                window.removeEventListener('pointerdown', handlePointerDown);
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', handlePointerUp);
                window.removeEventListener('pointercancel', handlePointerUp);
                original_end_trial();
            };
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
