import { logger } from './logger.js';
import { stopRecording, downloadWebcam, downloadScreen, getWebcamBlob, getScreenBlob } from './media.js';
import { logDataToFirebase, logOrUpdateParticipant, logOrUpdateSession } from './firebase.js';
import { saveSessionDataToBids } from './bids.js';

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

    // Handle AprilTag Overlay
    const config = JSON.parse(localStorage.getItem('cndlpsych_config') || '{}');
    const overlay = document.getElementById('apriltag-overlay');
    if (config.apriltag && config.apriltag.enableApriltags) {
        overlay.classList.remove('hidden');
        const tagSize = config.apriltag.apriltagSize || 75;
        const tags = overlay.querySelectorAll('img');
        tags.forEach(tag => {
            tag.style.width = `${tagSize}px`;
            tag.style.height = `${tagSize}px`;
        });
    } else {
        overlay.classList.add('hidden');
    }

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
                    const parsedNum = parseInt(rawParticipantId, 10);
                    const formattedId = "sub-" + (isNaN(parsedNum) ? "001" : String(parsedNum).padStart(3, '0'));
                    response.participant_id = formattedId;
                    participantId = formattedId;
                }
                await logOrUpdateParticipant(participantId, response);
                logger.participantId = participantId;
            }

            // 2. Session form completion: save responses dynamically to 'sessions' mapping participant_id
            if (data.formId === 'session') {
                const response = data.response || {};
                const rawSessionNumber = response.session_number || Object.values(response)[0];
                if (rawSessionNumber) {
                    const parsedNum = parseInt(rawSessionNumber, 10);
                    const formattedSession = "ses-" + (isNaN(parsedNum) ? "01" : String(parsedNum).padStart(2, '0'));
                    response.session_number = formattedSession;
                    sessionNumber = formattedSession;
                }
                const sDocId = await logOrUpdateSession(participantId, sessionNumber, response);
                if (sDocId) {
                    sessionDocId = sDocId;
                }
                logger.sessionNumber = sessionNumber;
                logger.sessionDocId = sessionDocId;
            }

            // 3. Save individual trial metrics to 'trials'
            await logDataToFirebase('trials', {
                ...data,
                participant_id: participantId,
                session_id: sessionDocId || sessionNumber || null
            });
        },
        on_finish: async function () {
            logger.logEvent('experiment_finish');

            // Remove the scroll lock listener
            window.removeEventListener('scroll', forceScrollTop);

            const finalParticipantId = participantId || 'subject';
            const finalSessionId = sessionNumber || 'session';

            // Turn off camera and stop recorder immediately (turns off indicators)
            await stopRecording();

            // Hide jspsych container, apriltag overlay, and show done panel
            document.getElementById('jspsych-container').classList.add('hidden');
            const overlay = document.getElementById('apriltag-overlay');
            if (overlay) overlay.classList.add('hidden');

            const donePanel = document.getElementById('done-panel');
            donePanel.classList.remove('hidden');

            // Check if BIDS directory linked and auto-save
            const bidsStatus = document.getElementById('bids-autosave-status');
            if (window.bidsDirectoryHandle) {
                bidsStatus.style.display = 'block';
                bidsStatus.textContent = 'Auto-saving to BIDS directory...';
                bidsStatus.className = 'status-badge disconnected'; // Use disconnected temporary style
                
                try {
                    await saveSessionDataToBids(
                        window.bidsDirectoryHandle,
                        finalParticipantId,
                        finalSessionId,
                        jsPsych.data.get().values(),
                        logger.getBuffer(),
                        getWebcamBlob(),
                        getScreenBlob()
                    );
                    bidsStatus.textContent = `Auto-saved to BIDS: ${finalParticipantId}/${finalSessionId}/eeg/`;
                    bidsStatus.className = 'status-badge connected';
                } catch (err) {
                    console.error("Auto-save to BIDS failed:", err);
                    bidsStatus.textContent = `Auto-save to BIDS failed: ${err.message || err}`;
                    bidsStatus.className = 'status-badge disconnected';
                }
            } else {
                bidsStatus.style.display = 'none';
            }

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

    // Load blocks dynamically from timeline.yaml
    let blocksConfig = null;
    try {
        const response = await fetch('timeline.yaml');
        if (response.ok) {
            const yamlText = await response.text();
            if (typeof jsyaml !== 'undefined') {
                const parsed = jsyaml.load(yamlText);
                blocksConfig = parsed.blocks;
            }
        }
    } catch (e) {
        console.error("Failed to load timeline.yaml, using fallback configuration:", e);
    }

    if (!blocksConfig || !Array.isArray(blocksConfig)) {
        console.log("Using built-in fallback timeline configuration.");
        blocksConfig = [
            {
                id: "setup_surveys",
                module: "survey",
                config: { forms_file: "forms.yaml" }
            },
            {
                id: "main_task",
                module: "keyboard_task",
                trials: null
            }
        ];
    }

    // Dynamic import and build of each block
    for (const block of blocksConfig) {
        try {
            const blockModule = await import(`./blocks/${block.module}.js`);
            const blockTimeline = await blockModule.createTimeline(block);
            timeline.push(...blockTimeline);
        } catch (error) {
            console.error(`Failed to dynamically load block "${block.id}" using module "${block.module}":`, error);
        }
    }

    jsPsych.run(timeline);
}
