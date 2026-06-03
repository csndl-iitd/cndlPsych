import { getRegistrationTimeline, getPsychometricTimeline, loadFormsFromYaml, generateTimelineFromForms } from './forms.js';
import { logger } from './logger.js';
import { stopRecording, downloadWebcam, downloadScreen } from './media.js';
import { logDataToFirebase } from './firebase.js';

export function objectifyFormWithSemicolons(formArray) {
    if (!formArray || !Array.isArray(formArray)) return formArray;
    
    // Group values by name
    const grouped = {};
    formArray.forEach(item => {
        if (!grouped[item.name]) {
            grouped[item.name] = [];
        }
        grouped[item.name].push(item.value);
    });

    // Objectify: if multiple values, sort them alphabetically and join with ';', otherwise take single value
    const result = {};
    Object.keys(grouped).forEach(key => {
        const vals = grouped[key];
        if (vals.length > 1) {
            result[key] = vals.sort().join(';');
        } else {
            result[key] = vals[0];
        }
    });
    return result;
}

export async function runExperiment() {
    // Scroll to top and add scroll event listener to lock page scroll position at 0, 0 during the experiment
    window.scrollTo(0, 0);
    const forceScrollTop = () => window.scrollTo(0, 0);
    window.addEventListener('scroll', forceScrollTop);

    // Hide settings and dashboard panels, show jsPsych container
    document.getElementById('settings-panel').classList.add('hidden');
    document.getElementById('dashboard-panel').classList.add('hidden');
    document.getElementById('app-background').classList.add('hidden');
    document.getElementById('jspsych-container').classList.remove('hidden');

    let participantId = null;
    let sessionNumber = null;
    let sessionDocId = null;

    let jsPsych;
    jsPsych = initJsPsych({
        display_element: 'jspsych-container',
        on_trial_finish: async function (data) {
            if (data && Array.isArray(data.response)) {
                data.response = objectifyFormWithSemicolons(data.response);
            }

            logger.logEvent('trial_finish', data);

            // 1. Participant form completion: save responses dynamically to 'participants'
            if (data.formId === 'participant') {
                const response = data.response || {};
                const rawParticipantId = response.participant_id || Object.values(response)[0];
                if (rawParticipantId) {
                    participantId = String(rawParticipantId).trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
                }
                await logDataToFirebase('participants', {
                    ...response,
                    timestamp: new Date().toISOString()
                });
            }

            // 2. Session form completion: save responses dynamically to 'sessions' mapping participant_id
            if (data.formId === 'session') {
                const response = data.response || {};
                const rawSessionNumber = response.session_number || Object.values(response)[0];
                if (rawSessionNumber) {
                    sessionNumber = String(rawSessionNumber).trim().replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
                }
                const sDocId = await logDataToFirebase('sessions', {
                    ...response,
                    participant_id: participantId,
                    timestamp: new Date().toISOString()
                });
                if (sDocId) {
                    sessionDocId = sDocId;
                }
            }

            // 3. Save individual trial metrics to 'trials'
            await logDataToFirebase('trials', {
                ...data,
                participant_id: participantId,
                session_id: sessionDocId || sessionNumber || null
            });
        },
        on_finish: function () {
            logger.logEvent('experiment_finish');

            // Remove the scroll lock listener
            window.removeEventListener('scroll', forceScrollTop);

            const finalParticipantId = participantId || 'subject';
            const finalSessionId = sessionNumber || 'session';

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
                console.log("Webcam download button clicked. Participant ID:", finalParticipantId, "Session ID:", finalSessionId);
                try {
                    downloadWebcam(`${finalParticipantId}_${finalSessionId}`);
                } catch (err) {
                    console.error("Error downloading webcam:", err);
                }
            });

            newScreenBtn.addEventListener('click', () => {
                console.log("Screen download button clicked. Participant ID:", finalParticipantId, "Session ID:", finalSessionId);
                try {
                    downloadScreen(`${finalParticipantId}_${finalSessionId}`);
                } catch (err) {
                    console.error("Error downloading screen:", err);
                }
            });

            newCsvBtn.addEventListener('click', () => {
                console.log("CSV download button clicked. Participant ID:", finalParticipantId, "Session ID:", finalSessionId);
                try {
                    jsPsych.data.get().localSave('csv', `${finalParticipantId}_${finalSessionId}_data.csv`);
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

    // Load forms dynamically or fall back to static defaults
    const formsList = await loadFormsFromYaml('forms.yaml');
    if (formsList && formsList.length > 0) {
        try {
            const dynamicTimelines = generateTimelineFromForms(formsList);
            dynamicTimelines.forEach(t => timeline.push(t));
        } catch (e) {
            console.error("Failed to generate dynamic timelines, using fallback static forms:", e);
            timeline.push(getRegistrationTimeline());
            timeline.push(getPsychometricTimeline());
        }
    } else {
        console.log("No dynamic forms loaded, using fallback static forms.");
        timeline.push(getRegistrationTimeline());
        timeline.push(getPsychometricTimeline());
    }

    // Dummy experimental trial with trigger
    const trial = {
        type: jsPsychHtmlKeyboardResponse,
        stimulus: '<div style="font-size:48px;">+</div>',
        choices: ['j', 'f'],
        trial_duration: 2000,
        on_load: function () {
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
