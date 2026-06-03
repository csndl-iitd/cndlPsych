// Dynamic keyboard task block module supporting trial-by-trial sequence repetitions and sequence shuffling
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
    const sequences = config.sequences || [];
    const randomize = config.randomize !== false;

    let templates = {};
    try {
        const response = await fetch('stimuli.yaml');
        if (response.ok) {
            const yamlText = await response.text();
            if (typeof jsyaml !== 'undefined') {
                const parsed = jsyaml.load(yamlText);
                const trialsList = parsed.stimuli || parsed.trials || [];
                trialsList.forEach(t => {
                    if (t.name) {
                        templates[t.name] = t;
                    }
                });
            }
        }
    } catch (e) {
        console.error("Failed to load stimuli.yaml templates inside keyboard_task block, using defaults:", e);
    }

    // Dynamic templates fallback if empty
    if (Object.keys(templates).length === 0) {
        templates = {
            "fixation_plus": { stimulus: '<div style="font-size:48px;">+</div>', choices: ['j', 'f'], duration: 2000, trigger: 1 },
            "stimulus_circle": { stimulus: '<div style="font-size:48px;">O</div>', choices: ['j', 'f'], duration: 2000, trigger: 2 }
        };
    }

    // Helper lookup function
    function lookupTemplate(name) {
        return templates[name] || { stimulus: `<div>[Missing stimulus: ${name}]</div>`, choices: ['j', 'f'], duration: 2000 };
    }

    // Assemble sequence instances
    let sequenceInstances = [];
    
    // Fallback block configuration if sequences is empty
    const activeSequences = (sequences && sequences.length > 0) ? sequences : [
        { name: "default_seq", sequence: ["fixation_plus", "stimulus_circle"], repetitions: 5 }
    ];

    activeSequences.forEach(seqItem => {
        const reps = seqItem.repetitions || 1;
        for (let r = 0; r < reps; r++) {
            const instance = seqItem.sequence.map(name => {
                const template = lookupTemplate(name);
                return {
                    ...template,
                    sequenceName: seqItem.name,
                    sequencePost: seqItem.post
                };
            });
            sequenceInstances.push(instance);
        }
    });

    // Shuffle at the sequence level
    if (randomize) {
        sequenceInstances = shuffleArray(sequenceInstances);
    }

    // Flatten sequences to individual trials and map to jsPsych
    sequenceInstances.forEach(instance => {
        instance.forEach((t, index) => {
            let postVal = t.post;
            if (index === instance.length - 1 && t.sequencePost !== undefined && t.sequencePost !== null) {
                postVal = t.sequencePost;
            }
            const postTrialGap = resolvePost(postVal);
            timeline.push({
                type: jsPsychHtmlKeyboardResponse,
                stimulus: t.stimulus,
                choices: t.choices,
                trial_duration: t.duration,
                post_trial_gap: postTrialGap,
                on_load: function () {
                    console.log(`[Trial Displayed] stimulus: "${t.stimulus}", duration: ${t.duration}ms, trigger: ${t.trigger || 'none'}, actual post: ${postTrialGap}ms`);
                    if (t.trigger) {
                        logger.dispatchTrigger(t.trigger);
                    }
                },
                data: { 
                    phase: 'experiment_trial', 
                    blockId: blockConfig.id,
                    trialName: t.name,
                    sequenceName: t.sequenceName
                }
            });
        });
    });

    return timeline;
}
