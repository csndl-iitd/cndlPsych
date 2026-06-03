import { getRegistrationTimeline, getPsychometricTimeline } from './forms.js';
import { logger } from './logger.js';
import { stopRecording, downloadWebcam, downloadScreen } from './media.js';

export function runExperiment() {
    // Hide settings and dashboard panels, show jsPsych container
    document.getElementById('settings-panel').classList.add('hidden');
    document.getElementById('dashboard-panel').classList.add('hidden');
    document.getElementById('app-background').classList.add('hidden');
    document.getElementById('jspsych-container').classList.remove('hidden');

    let jsPsych;
    jsPsych = initJsPsych({
        display_element: 'jspsych-container',
        on_trial_finish: function(data) {
            logger.logEvent('trial_finish', data);
        },
        on_finish: function() {
            logger.logEvent('experiment_finish');
            
            let participantId = 'subject';
            try {
                const regData = jsPsych.data.get().filter({ phase: 'registration' }).values()[0];
                if (regData && regData.response && regData.response.participant_id) {
                    participantId = regData.response.participant_id.trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
                }
            } catch (e) {
                console.error("Failed to extract participant ID for media naming:", e);
            }
            
            // Turn off camera and stop recorder immediately (turns off indicators)
            stopRecording();

            // Hide jspsych container and show done panel
            document.getElementById('jspsych-container').classList.add('hidden');
            
            const donePanel = document.getElementById('done-panel');
            donePanel.classList.remove('hidden');
            
            // Configure download buttons
            const recordWebcam = document.getElementById('record-webcam').checked;
            const recordScreen = document.getElementById('record-screen').checked;
            
            const webcamBtn = document.getElementById('download-webcam-btn');
            const screenBtn = document.getElementById('download-screen-btn');
            const csvBtn = document.getElementById('download-csv-btn');
            
            if (recordWebcam) {
                webcamBtn.classList.remove('hidden');
            } else {
                webcamBtn.classList.add('hidden');
            }
            
            if (recordScreen) {
                screenBtn.classList.remove('hidden');
            } else {
                screenBtn.classList.add('hidden');
            }
            
            // Clone buttons to clear previous event listeners from other runs
            const newWebcamBtn = webcamBtn.cloneNode(true);
            webcamBtn.parentNode.replaceChild(newWebcamBtn, webcamBtn);
            
            const newScreenBtn = screenBtn.cloneNode(true);
            screenBtn.parentNode.replaceChild(newScreenBtn, screenBtn);
            
            const newCsvBtn = csvBtn.cloneNode(true);
            csvBtn.parentNode.replaceChild(newCsvBtn, csvBtn);
            
            // Add click listeners to trigger the downloads on demand
            newWebcamBtn.addEventListener('click', () => {
                console.log("Webcam download button clicked. Participant ID:", participantId);
                try {
                    downloadWebcam(participantId);
                } catch (err) {
                    console.error("Error downloading webcam:", err);
                }
            });
            
            newScreenBtn.addEventListener('click', () => {
                console.log("Screen download button clicked. Participant ID:", participantId);
                try {
                    downloadScreen(participantId);
                } catch (err) {
                    console.error("Error downloading screen:", err);
                }
            });
            
            newCsvBtn.addEventListener('click', () => {
                console.log("CSV download button clicked. Participant ID:", participantId);
                try {
                    jsPsych.data.get().localSave('csv', `recordings/${participantId}_data.csv`);
                    console.log("jsPsych.data.get().localSave CSV call completed.");
                } catch (err) {
                    console.error("Error downloading CSV:", err);
                }
            });
        }
    });
    window.jsPsych = jsPsych;

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
