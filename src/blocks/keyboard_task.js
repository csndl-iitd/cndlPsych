// Dynamic keyboard task block module supporting the new trial/stimuli configuration
import { logger } from '../logger.js';

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function resolvePost(postVal) {
    if (typeof postVal === 'number') {
        return postVal;
    }
    if (Array.isArray(postVal) && postVal.length === 2) {
        const min = Number(postVal[0]);
        const max = Number(postVal[1]);
        if (!isNaN(min) && !isNaN(max)) {
            const low = Math.min(min, max);
            const high = Math.max(min, max);
            return Math.floor(Math.random() * (high - low + 1)) + low;
        }
    }
    return 0;
}

export async function createTimeline(blockConfig) {
    const timeline = [];
    const config = blockConfig.config || {};
    const trialsConfig = config.trials || [];
    const shuffleTrials = config.shuffle_trials !== false; // Shuffling of trials in a block

    let templates = {};
    try {
        const response = await fetch('stimuli.yaml');
        if (response.ok) {
            const yamlText = await response.text();
            if (typeof jsyaml !== 'undefined') {
                const parsed = jsyaml.load(yamlText);
                const stimuliList = parsed.stimuli || parsed.trials || [];
                stimuliList.forEach(s => {
                    if (s.name) {
                        templates[s.name] = s;
                    }
                });
            }
        }
    } catch (e) {
        console.error("Failed to load stimuli.yaml templates inside keyboard_task block, using defaults:", e);
    }

    // Fallback templates if empty
    if (Object.keys(templates).length === 0) {
        templates = {
            "fixation_plus": { stimulus: '<div style="font-size:48px;">+</div>', duration: 500, trigger: 1 },
            "stimulus_F": { stimulus: '<div style="font-size:48px;">F</div>', duration: 500, trigger: 2 },
            "stimulus_J": { stimulus: '<div style="font-size:48px;">J</div>', duration: 500, trigger: 3 },
            "feedback_correct": { stimulus: '<div style="font-size:36px; color:#10b981; font-weight:bold;">Correct!</div>', duration: 1000, trigger: 4 },
            "feedback_incorrect": { stimulus: '<div style="font-size:36px; color:#ef4444; font-weight:bold;">Incorrect!</div>', duration: 1000, trigger: 5 }
        };
    }

    // Helper template lookup function
    function lookupTemplate(name) {
        return templates[name] || { stimulus: `<div>[Missing stimulus: ${name}]</div>`, duration: 1000, trigger: null };
    }

    // Assemble trial instances
    let trialInstances = [];

    // Fallback block configuration if trials is empty
    const activeTrials = (trialsConfig && trialsConfig.length > 0) ? trialsConfig : [
        {
            name: "default_F",
            start: "fixation_plus",
            sequence: ["stimulus_F"],
            shuffle: false,
            choices: ["j", "f"],
            correct_response: "f",
            response_stimuli: { correct: "feedback_correct", incorrect: "feedback_incorrect" },
            post: 500,
            repetitions: 5
        }
    ];

    activeTrials.forEach(trialDef => {
        const reps = trialDef.repetitions || 1;
        for (let r = 0; r < reps; r++) {
            // For each instance of this trial type, build its specific jsPsych timeline sub-timeline
            const instanceTimeline = [];

            // A. Optional Start Stimulus (e.g. Fixation cross)
            if (trialDef.start) {
                const startTemplate = lookupTemplate(trialDef.start);
                instanceTimeline.push({
                    type: jsPsychHtmlKeyboardResponse,
                    stimulus: startTemplate.stimulus,
                    choices: "NO_KEYS", // Fixed duration display
                    trial_duration: startTemplate.duration,
                    post_trial_gap: 0,
                    on_load: function () {
                        console.log(`[Stimulus Displayed] name: "${trialDef.start}", duration: ${startTemplate.duration}ms, trigger: ${startTemplate.trigger || 'none'}`);
                        if (startTemplate.trigger) {
                            logger.dispatchTrigger(startTemplate.trigger);
                        }
                    },
                    data: {
                        phase: 'experiment_fixation',
                        blockId: blockConfig.id,
                        trialName: trialDef.name
                    }
                });
            }

            // B. Sequence of Cues and target stimuli
            let sequenceNames = [...(trialDef.sequence || [])];
            if (trialDef.shuffle) {
                sequenceNames = shuffleArray(sequenceNames);
            }

            sequenceNames.forEach((stimName, seqIdx) => {
                const stimTemplate = lookupTemplate(stimName);
                const isLast = (seqIdx === sequenceNames.length - 1);

                if (isLast) {
                    // This is the target / response stimulus trial!
                    const hasFeedback = !!(trialDef.response_stimulus || trialDef.response_stimuli);
                    const gap = hasFeedback ? 0 : resolvePost(trialDef.post);

                    instanceTimeline.push({
                        type: jsPsychHtmlKeyboardResponse,
                        stimulus: stimTemplate.stimulus,
                        choices: trialDef.choices,
                        trial_duration: stimTemplate.duration,
                        post_trial_gap: gap,
                        on_load: function () {
                            console.log(`[Stimulus Displayed] name: "${stimName}" (Target), duration: ${stimTemplate.duration}ms, trigger: ${stimTemplate.trigger || 'none'}`);
                            if (stimTemplate.trigger) {
                                logger.dispatchTrigger(stimTemplate.trigger);
                            }
                        },
                        on_finish: function (data) {
                            const keyChar = data.response;
                            if (keyChar === null || keyChar === undefined) {
                                // Timeout (no response)
                                data.correct = false;
                                console.log(`[Keyboard Response] Timeout (no response). Dispatching trigger 23.`);
                                logger.dispatchTrigger(23); // Response timeout trigger
                            } else {
                                const isCorrect = (keyChar === trialDef.correct_response);
                                data.correct = isCorrect;
                                const respTrigger = isCorrect ? 21 : 22;
                                console.log(`[Keyboard Response] key: "${keyChar}", correct: ${isCorrect}. Dispatching trigger ${respTrigger}.`);
                                logger.dispatchTrigger(respTrigger); // Correct: 21, Incorrect: 22
                            }
                            // Inject trial data details
                            data.correct_response = trialDef.correct_response;
                            data.phase = 'experiment_trial';
                            data.blockId = blockConfig.id;
                            data.trialName = trialDef.name;
                        }
                    });
                } else {
                    // This is an intermediate / cue stimulus (no choices accepted)
                    instanceTimeline.push({
                        type: jsPsychHtmlKeyboardResponse,
                        stimulus: stimTemplate.stimulus,
                        choices: "NO_KEYS",
                        trial_duration: stimTemplate.duration,
                        post_trial_gap: 0,
                        on_load: function () {
                            console.log(`[Stimulus Displayed] name: "${stimName}" (Cue), duration: ${stimTemplate.duration}ms, trigger: ${stimTemplate.trigger || 'none'}`);
                            if (stimTemplate.trigger) {
                                logger.dispatchTrigger(stimTemplate.trigger);
                            }
                        },
                        data: {
                            phase: 'experiment_cue',
                            blockId: blockConfig.id,
                            trialName: trialDef.name
                        }
                    });
                }
            });

            // C. Optional Feedback Stimulus
            if (trialDef.response_stimulus || trialDef.response_stimuli) {
                const gap = resolvePost(trialDef.post);

                instanceTimeline.push({
                    type: jsPsychHtmlKeyboardResponse,
                    choices: "NO_KEYS",
                    stimulus: function () {
                        // Dynamically retrieve the preceding response trial accuracy
                        const lastTrial = jsPsych.data.get().last(1).values()[0];
                        const isCorrect = lastTrial && lastTrial.correct === true;
                        
                        let feedbackName = null;
                        if (trialDef.response_stimuli) {
                            feedbackName = isCorrect ? trialDef.response_stimuli.correct : trialDef.response_stimuli.incorrect;
                        } else {
                            feedbackName = trialDef.response_stimulus;
                        }
                        
                        if (feedbackName) {
                            return lookupTemplate(feedbackName).stimulus;
                        }
                        return '';
                    },
                    trial_duration: function () {
                        const lastTrial = jsPsych.data.get().last(1).values()[0];
                        const isCorrect = lastTrial && lastTrial.correct === true;
                        
                        let feedbackName = null;
                        if (trialDef.response_stimuli) {
                            feedbackName = isCorrect ? trialDef.response_stimuli.correct : trialDef.response_stimuli.incorrect;
                        } else {
                            feedbackName = trialDef.response_stimulus;
                        }
                        
                        if (feedbackName) {
                            return lookupTemplate(feedbackName).duration || 1000;
                        }
                        return 0; // Skip if no feedback configured
                    },
                    post_trial_gap: gap, // Inter-trial interval (ITI) delay applies after feedback
                    on_load: function () {
                        const lastTrial = jsPsych.data.get().last(1).values()[0];
                        const isCorrect = lastTrial && lastTrial.correct === true;
                        
                        let feedbackName = null;
                        if (trialDef.response_stimuli) {
                            feedbackName = isCorrect ? trialDef.response_stimuli.correct : trialDef.response_stimuli.incorrect;
                        } else {
                            feedbackName = trialDef.response_stimulus;
                        }
                        
                        if (feedbackName) {
                            const template = lookupTemplate(feedbackName);
                            console.log(`[Stimulus Displayed] name: "${feedbackName}" (Feedback), duration: ${template.duration}ms, trigger: ${template.trigger || 'none'}`);
                            if (template.trigger) {
                                logger.dispatchTrigger(template.trigger);
                            }
                        }
                    },
                    data: {
                        phase: 'experiment_feedback',
                        blockId: blockConfig.id,
                        trialName: trialDef.name
                    }
                });
            }

            // Push this trial instance sub-timeline to the collection
            trialInstances.push(instanceTimeline);
        }
    });

    // Shuffle the trial instances at block level if enabled
    if (shuffleTrials) {
        trialInstances = shuffleArray(trialInstances);
    }

    // Flatten trial instances (sub-timelines) into a single linear jsPsych timeline array
    trialInstances.forEach(instance => {
        timeline.push(...instance);
    });

    return timeline;
}
