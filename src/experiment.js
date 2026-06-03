import { getRegistrationTimeline, getPsychometricTimeline } from './forms.js';
import { logger } from './logger.js';
import { stopRecordingAndDownload } from './media.js';

export function runExperiment() {
    // Hide settings, show jsPsych container
    document.getElementById('settings-panel').classList.add('hidden');
    document.getElementById('app-background').classList.add('hidden');
    document.getElementById('jspsych-container').classList.remove('hidden');

    const jsPsych = initJsPsych({
        display_element: 'jspsych-container',
        on_trial_finish: function(data) {
            logger.logEvent('trial_finish', data);
        },
        on_finish: function() {
            logger.logEvent('experiment_finish');
            stopRecordingAndDownload();
            // Automatically download jsPsych data as CSV
            jsPsych.data.get().localSave('csv', 'experiment_data.csv');
        }
    });

    const timeline = [];

    // Preload trial
    const preload = {
        type: jsPsychPreload,
        auto_preload: true, 
        images: [], 
        audio: []
    };
    timeline.push(preload);

    // Registration and Forms
    timeline.push(getRegistrationTimeline());
    timeline.push(getPsychometricTimeline());

    // Dummy experimental trial with trigger
    const trial = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '<div style="font-size:48px;">+</div>',
        choices: ['j', 'f'],
        trial_duration: 2000,
        on_load: function() {
            // Send trigger at the exact moment stimulus is presented
            logger.dispatchTrigger(1); // 1 = Stimulus onset trigger
        },
        data: { phase: 'experiment_trial' }
    };
    
    // Add a few trials
    timeline.push(trial);
    timeline.push({ ...trial, stimulus: '<div style="font-size:48px;">O</div>', on_load: () => logger.dispatchTrigger(2) });

    jsPsych.run(timeline);
}
