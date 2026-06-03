/**
 * Stroop Color-Word Task Custom Block Module
 * 
 * This module defines a standard psychology Stroop task using jsPsych.
 * It serves as an example of how to build custom modular experiment blocks
 * that can be imported and executed dynamically by the experiment manager.
 * 
 * Structure of a Custom Block Module:
 * 1. Must export an asynchronous function: `createTimeline(blockConfig)`
 * 2. `createTimeline` must construct and return an array of jsPsych trial objects (the timeline).
 * 3. All configuration, trials generation, randomizations, and triggers should be handled internally.
 */

import { logger } from '../logger.js';

/**
 * Shuffles an array in place using the Knuth-Fisher-Yates algorithm.
 * Used for randomizing the order of trials in the task.
 * 
 * @param {Array} array - The array to shuffle.
 * @returns {Array} A new shuffled copy of the array.
 */
function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Resolves a delay value which can either be a static integer or a range [min, max].
 * If a range is provided, it returns a random integer uniformly sampled from that range.
 * 
 * @param {number|Array} postVal - A static delay in ms, or a range array [min, max]
 * @returns {number} The resolved post-trial delay in ms.
 */
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
            // Uniformly sample an integer in the range [low, high] inclusive
            return Math.floor(Math.random() * (high - low + 1)) + low;
        }
    }
    return 0; // Default fallback if config is missing or invalid
}

/**
 * Factory function called by the experiment runner (experiment.js) to construct 
 * the timeline of trials for this block.
 * 
 * @param {Object} blockConfig - The configuration object from timeline.yaml.
 * @param {string} blockConfig.id - The unique block identifier (e.g. "stroop_task").
 * @param {string} blockConfig.module - The module name (e.g. "stroop").
 * @param {Object} blockConfig.config - Block-specific settings.
 * @returns {Promise<Array>} Resolves to an array of jsPsych trial objects.
 */
export async function createTimeline(blockConfig) {
    const timeline = [];
    const config = blockConfig.config || {};
    
    // Parse block parameters with default fallbacks
    const repetitions = config.repetitions || 1; // 1 repetition = 1 full set of 16 trials
    const randomize = config.randomize !== false; // Shuffle trials order by default
    const postTrialGapConfig = config.post || [150, 450]; // Post-trial delay (ms range or static number)
    const fixationDuration = config.fixation_duration || 500; // Duration of the fixation cross (ms)
    const trialDuration = config.trial_duration || 2000; // Max response window for the word stimulus (ms)

    /**
     * Color mapping dictionary containing CSS hex colors for presentation
     * and their corresponding correct keyboard response keys.
     * 
     * Key mappings:
     * - Red font color -> press 'r'
     * - Green font color -> press 'g'
     * - Blue font color -> press 'b'
     * - Yellow font color -> press 'y'
     */
    const colorMap = {
        "RED": { hex: "#ef4444", key: "r" },
        "GREEN": { hex: "#10b981", key: "g" },
        "BLUE": { hex: "#3b82f6", key: "b" },
        "YELLOW": { hex: "#f59e0b", key: "y" }
    };

    const words = ["RED", "GREEN", "BLUE", "YELLOW"];

    // ==========================================
    // 1. INSTRUCTION TRIAL
    // ==========================================
    // Displays the task rules and waits for a keypress before starting the trials.
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

    // ==========================================
    // 2. TRIAL MATRIX GENERATION
    // ==========================================
    // Generate all 16 unique combinations of Word X Font Color.
    // - 4 Congruent combinations (e.g. Word "RED" in Red color)
    // - 12 Incongruent combinations (e.g. Word "RED" in Blue color)
    const baseTrials = [];
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
                trigger: congruent ? 11 : 12 // Stimulus onset trigger: 11 for Congruent, 12 for Incongruent
            });
        });
    });

    // Expand the base matrix by the repetitions parameter
    let taskTrials = [];
    for (let r = 0; r < repetitions; r++) {
        taskTrials.push(...baseTrials);
    }

    // Shuffle the trials order if randomization is enabled (keeps individual trial properties intact)
    if (randomize) {
        taskTrials = shuffleArray(taskTrials);
    }

    // ==========================================
    // 3. MAPPING TRIALS TO jsPsych TIMELINE
    // ==========================================
    // Loop through the trial matrix and append Fixation and Stimulus screens.
    taskTrials.forEach((t, index) => {
        // Resolve the post-trial delay (resolves ranges [min, max] dynamically per trial)
        const postTrialGap = resolvePost(postTrialGapConfig);

        // A. Fixation Cross Trial
        timeline.push({
            type: jsPsychHtmlKeyboardResponse,
            stimulus: '<div style="font-size:60px; color: #f8fafc; font-weight: 300;">+</div>',
            choices: "NO_KEYS", // Disables keyboard input during fixation
            trial_duration: fixationDuration,
            post_trial_gap: 0,
            on_load: function () {
                // Dispatch fixation onset trigger (value 10) to hardware/websocket interfaces
                logger.dispatchTrigger(10);
            },
            data: { 
                phase: 'stroop_fixation',
                blockId: blockConfig.id
            }
        });

        // B. Word Stimulus Trial
        timeline.push({
            type: jsPsychHtmlKeyboardResponse,
            // Display the word using the CSS Hex color corresponding to its font color
            stimulus: `<div style="font-size:64px; font-weight: 800; color: ${t.colorHex}; font-family: 'Inter', sans-serif; text-shadow: 0 4px 15px rgba(0,0,0,0.4);">${t.word}</div>`,
            choices: ['r', 'g', 'b', 'y'], // Only accept valid keys mapping to red, green, blue, yellow
            trial_duration: trialDuration, // Max duration to wait for response before timing out
            post_trial_gap: postTrialGap, // The resolved delay gap after this trial
            on_load: function () {
                // Debug log showing properties of the current trial
                console.log(`[Stroop Trial Displayed] word: "${t.word}", font_color: "${t.colorName}", congruent: ${t.congruent}, duration: ${trialDuration}ms, trigger: ${t.trigger}, actual post: ${postTrialGap}ms`);
                
                // Dispatch stimulus onset trigger (congruent: 11, incongruent: 12)
                logger.dispatchTrigger(t.trigger);
            },
            on_finish: function (data) {
                // Process the participant response when the trial ends (on keypress or timeout)
                const keyChar = data.response;
                
                if (keyChar === null || keyChar === undefined) {
                    // Participant failed to respond in time (timeout)
                    data.correct = false;
                    console.log(`[Stroop Response] Timeout (no response). Dispatching trigger 23.`);
                    
                    // Dispatch timeout response trigger (value 23)
                    logger.dispatchTrigger(23);
                } else {
                    // Check response accuracy (key matched correct key mapped to the color name)
                    const isCorrect = (keyChar === t.correctKey);
                    data.correct = isCorrect;
                    
                    // Dispatch response trigger: 21 for correct keypress, 22 for incorrect keypress
                    const responseTrigger = isCorrect ? 21 : 22;
                    console.log(`[Stroop Response] key: "${keyChar}", correct: ${isCorrect}. Dispatching trigger ${responseTrigger}.`);
                    
                    logger.dispatchTrigger(responseTrigger);
                }
                
                // Inject metadata details into the trial's final dataset record
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
