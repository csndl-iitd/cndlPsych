import { initFirebase } from './firebase.js';
import { setTriggerMode, connectDevice } from './triggers.js';
import { requestMediaPermissions, startRecording } from './media.js';
import { runExperiment } from './experiment.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // UI Elements
    const fbSaveBtn = document.getElementById('save-fb-btn');
    const fbStatus = document.getElementById('fb-status');
    const triggerRadios = document.getElementsByName('trigger-mode');
    const wsConfig = document.getElementById('websocket-config');
    const triggerConnectBtn = document.getElementById('connect-trigger-btn');
    const triggerStatus = document.getElementById('trigger-status');
    const mediaBtn = document.getElementById('test-media-btn');
    const mediaStatus = document.getElementById('media-status');
    const startBtn = document.getElementById('start-experiment-btn');

    // Firebase Config
    fbSaveBtn.addEventListener('click', () => {
        const apiKey = document.getElementById('fb-apikey').value;
        const authDomain = document.getElementById('fb-authdomain').value;
        const projectId = document.getElementById('fb-projectid').value;
        
        if (!apiKey || !authDomain || !projectId) {
            alert("Please fill all Firebase fields");
            return;
        }

        const success = initFirebase({ apiKey, authDomain, projectId });
        if (success) {
            fbStatus.textContent = 'Configured';
            fbStatus.classList.remove('disconnected');
            fbStatus.classList.add('connected');
        }
    });

    // Trigger Config
    triggerRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const mode = e.target.value;
            if (mode === 'websocket') {
                wsConfig.classList.remove('hidden');
            } else {
                wsConfig.classList.add('hidden');
            }
            // Update trigger mode internally
            setTriggerMode(mode, { url: document.getElementById('ws-url').value });
        });
    });

    triggerConnectBtn.addEventListener('click', async () => {
        const mode = document.querySelector('input[name="trigger-mode"]:checked').value;
        if (mode === 'none') return;
        
        if (mode === 'websocket') {
            const url = document.getElementById('ws-url').value;
            setTriggerMode(mode, { url });
            triggerStatus.textContent = 'Connected (WS)';
            triggerStatus.classList.remove('disconnected');
            triggerStatus.classList.add('connected');
        } else {
            const connected = await connectDevice();
            if (connected) {
                triggerStatus.textContent = `Connected (${mode})`;
                triggerStatus.classList.remove('disconnected');
                triggerStatus.classList.add('connected');
            } else {
                alert(`Failed to connect to ${mode}. Did you grant permission?`);
            }
        }
    });

    // Media Config
    mediaBtn.addEventListener('click', async () => {
        const recordWebcam = document.getElementById('record-webcam').checked;
        const recordScreen = document.getElementById('record-screen').checked;
        
        if (!recordWebcam && !recordScreen) {
            alert("Please select at least one media type to record.");
            return;
        }
        
        const success = await requestMediaPermissions(recordWebcam, recordScreen);
        if (success) {
            mediaStatus.textContent = 'Ready';
            mediaStatus.classList.remove('disconnected');
            mediaStatus.classList.add('connected');
        }
    });

    // Start Experiment
    startBtn.addEventListener('click', () => {
        const recordWebcam = document.getElementById('record-webcam').checked;
        const recordScreen = document.getElementById('record-screen').checked;
        if (recordWebcam || recordScreen) {
            startRecording();
        }
        runExperiment();
    });
});
