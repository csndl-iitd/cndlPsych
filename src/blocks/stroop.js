// Stroop Task custom block module
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
    const repetitions = config.repetitions || 1; // number of times to repeat the set of congruent/incongruent trials (1 rep = 16 trials)
    const randomize = config.randomize !== false;
    const postTrialGapConfig = config.post || [150, 450]; // Default post-trial gap range
    const fixationDuration = config.fixation_duration || 500;
    const trialDuration = config.trial_duration || 2000;

    // Define colors and keys
    // Red -> r, Green -> g, Blue -> b, Yellow -> y
    const colorMap = {
        "RED": { hex: "#ef4444", key: "r" },
        "GREEN": { hex: "#10b981", key: "g" },
        "BLUE": { hex: "#3b82f6", key: "b" },
        "YELLOW": { hex: "#f59e0b", key: "y" }
    };

    const words = ["RED", "GREEN", "BLUE", "YELLOW"];

    // 1. Welcome / Instruction slide
    const instructions = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `
            <div class="glass-panel" style="max-width: 600px; margin: 0 auto; padding: 35px; text-align: left; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; color: #f8fafc; font-family: 'Inter', sans-serif; line-height: 1.6; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4); backdrop-filter: blur(10px);">
                <h2 style="font-size: 1.8rem; font-weight: 700; margin-bottom: 1.5rem; text-align: center; background: linear-gradient(to right, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Stroop Color-Word Task</h2>
                <p style="margin-bottom: 1.25rem; font-size: 1rem; color: #cbd5e1;">
                    In this task, words of color names will be displayed in different font colors.
                </p>
                <p style="margin-bottom: 1.25rem; font-size: 1rem; font-weight: 600; color: #f1f5f9;">
                    Your task is to identify the <span style="background: linear-gradient(to right, #ef4444, #10b981, #3b82f6, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800;">FONT COLOR</span> of the word and ignore the word itself.
                </p>
                <p style="margin-bottom: 1.5rem; font-size: 1rem; color: #cbd5e1;">
                    Press the corresponding key on your keyboard:
                </p>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 2rem;">
                    <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 10px 15px; text-align: center;">
                        <span style="font-weight: bold; color: #ef4444; font-size: 1.1rem;">R</span> key for <span style="color: #ef4444; font-weight: bold;">RED</span>
                    </div>
                    <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px 15px; text-align: center;">
                        <span style="font-weight: bold; color: #10b981; font-size: 1.1rem;">G</span> key for <span style="color: #10b981; font-weight: bold;">GREEN</span>
                    </div>
                    <div style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 10px 15px; text-align: center;">
                        <span style="font-weight: bold; color: #3b82f6; font-size: 1.1rem;">B</span> key for <span style="color: #3b82f6; font-weight: bold;">BLUE</span>
                    </div>
                    <div style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 10px 15px; text-align: center;">
                        <span style="font-weight: bold; color: #f59e0b; font-size: 1.1rem;">Y</span> key for <span style="color: #f59e0b; font-weight: bold;">YELLOW</span>
                    </div>
                </div>
                <div style="text-align: center; margin-top: 1.5rem; font-size: 0.95rem; color: #94a3b8; animation: pulse 2s infinite;">
                    Press any key to begin the task.
                </div>
            </div>
        `,
        choices: "ALL_KEYS",
        data: { phase: 'stroop_instructions' }
    };
    timeline.push(instructions);

    // Build unique trials
    const baseTrials = [];

    // Create 4 congruent and 12 incongruent combinations (total 16 unique trials)
    words.forEach(word => {
        words.forEach(colorName => {
            const congruent = (word === colorName);
            const colorInfo = colorMap[colorName];

            baseTrials.push({
                word: word,
                colorName: colorName,
                colorHex: colorInfo.hex,
                correctKey: colorInfo.key,
                congruent: congruent,
                trigger: congruent ? 11 : 12 // Congruent trigger: 11, Incongruent trigger: 12
            });
        });
    });

    // Expand by repetitions
    let taskTrials = [];
    for (let r = 0; r < repetitions; r++) {
        taskTrials.push(...baseTrials);
    }

    if (randomize) {
        taskTrials = shuffleArray(taskTrials);
    }

    // Map trials to timeline with fixation cross
    taskTrials.forEach((t, index) => {
        const postTrialGap = resolvePost(postTrialGapConfig);

        // Fixation cross
        timeline.push({
            type: jsPsychHtmlKeyboardResponse,
            stimulus: '<div style="font-size:60px; color: #f8fafc; font-weight: 300;">+</div>',
            choices: "NO_KEYS",
            trial_duration: fixationDuration,
            post_trial_gap: 0,
            on_load: function () {
                logger.dispatchTrigger(10); // Fixation trigger: 10
            },
            data: {
                phase: 'stroop_fixation',
                blockId: blockConfig.id
            }
        });

        // Stroop trial
        timeline.push({
            type: jsPsychHtmlKeyboardResponse,
            stimulus: `<div style="font-size:64px; font-weight: 800; color: ${t.colorHex}; font-family: 'Inter', sans-serif; text-shadow: 0 4px 15px rgba(0,0,0,0.4);">${t.word}</div>`,
            choices: ['r', 'g', 'b', 'y'],
            trial_duration: trialDuration,
            post_trial_gap: postTrialGap,
            on_load: function () {
                console.log(`[Stroop Trial Displayed] word: "${t.word}", font_color: "${t.colorName}", congruent: ${t.congruent}, duration: ${trialDuration}ms, trigger: ${t.trigger}, actual post: ${postTrialGap}ms`);
                logger.dispatchTrigger(t.trigger);
            },
            on_finish: function (data) {
                // Determine accuracy
                const keyChar = data.response;
                if (keyChar === null || keyChar === undefined) {
                    data.correct = false;
                    console.log(`[Stroop Response] Timeout (no response). Dispatching trigger 23.`);
                    logger.dispatchTrigger(23); // Response timeout: 23
                } else {
                    const isCorrect = (keyChar === t.correctKey);
                    data.correct = isCorrect;
                    const responseTrigger = isCorrect ? 21 : 22;
                    console.log(`[Stroop Response] key: "${keyChar}", correct: ${isCorrect}. Dispatching trigger ${responseTrigger}.`);
                    logger.dispatchTrigger(responseTrigger); // Correct: 21, Incorrect: 22
                }
                data.word = t.word;
                data.color = t.colorName;
                data.congruent = t.congruent;
                data.correct_response = t.correctKey;
                data.phase = 'experiment_trial';
                data.blockId = blockConfig.id;
                data.trialName = `stroop_${t.congruent ? 'congruent' : 'incongruent'}_${t.word}_${t.colorName}`;
            }
        });
    });

    return timeline;
}
