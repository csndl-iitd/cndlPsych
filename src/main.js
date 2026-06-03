import { initFirebase } from './firebase.js';
import { setTriggerMode, connectDevice, autoConnectDevice, isTriggerConnected, getTriggerMode, sendTrigger } from './triggers.js';
import { requestMediaPermissions, startRecording, hasWebcamStream, hasScreenStream } from './media.js';
import { runExperiment } from './experiment.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // UI Elements - Settings Panel
    const fbSaveBtn = document.getElementById('save-fb-btn');
    const fbStatus = document.getElementById('fb-status');
    const triggerRadios = document.getElementsByName('trigger-mode');
    const wsConfig = document.getElementById('websocket-config');
    const triggerConnectBtn = document.getElementById('connect-trigger-btn');
    const triggerStatus = document.getElementById('trigger-status');
    const mediaBtn = document.getElementById('test-media-btn');
    const mediaStatus = document.getElementById('media-status');
    const startBtn = document.getElementById('start-experiment-btn');
    const settingsBackBtn = document.getElementById('settings-back-btn');

    // UI Elements - Dashboard Panel
    const dashboardPanel = document.getElementById('dashboard-panel');
    const settingsPanel = document.getElementById('settings-panel');
    const dashboardStartBtn = document.getElementById('dashboard-start-btn');
    const editSettingsBtn = document.getElementById('edit-settings-btn');
    const dashboardConnectBtn = document.getElementById('dashboard-connect-btn');
    
    // UI Elements - Test Markers
    const settingsTestBtn = document.getElementById('trigger-test-btn');
    const dashboardTestBtn = document.getElementById('dashboard-test-btn');

    // -------------------------------------------------------------
    // Configuration Caching Helpers
    // -------------------------------------------------------------
    function loadConfig() {
        try {
            return JSON.parse(localStorage.getItem('cndlpsych_config') || '{}');
        } catch (e) {
            console.error("Failed to parse config from localStorage:", e);
            return {};
        }
    }

    function saveAllSettingsToCache() {
        const apiKey = document.getElementById('fb-apikey').value.trim();
        const authDomain = document.getElementById('fb-authdomain').value.trim();
        const projectId = document.getElementById('fb-projectid').value.trim();
        const mode = document.querySelector('input[name="trigger-mode"]:checked')?.value || 'none';
        const wsUrl = document.getElementById('ws-url').value.trim();
        const recordWebcam = document.getElementById('record-webcam').checked;
        const recordScreen = document.getElementById('record-screen').checked;

        const config = {
            firebase: { apiKey, authDomain, projectId },
            trigger: { mode, wsUrl },
            media: { recordWebcam, recordScreen }
        };
        localStorage.setItem('cndlpsych_config', JSON.stringify(config));
        return config;
    }

    function isFirebaseConfigured(config) {
        return !!(config && config.firebase && config.firebase.apiKey && config.firebase.authDomain && config.firebase.projectId);
    }

    function updateUIFromConfig(config) {
        if (config.firebase) {
            document.getElementById('fb-apikey').value = config.firebase.apiKey || '';
            document.getElementById('fb-authdomain').value = config.firebase.authDomain || '';
            document.getElementById('fb-projectid').value = config.firebase.projectId || '';
        }
        
        if (config.trigger) {
            const mode = config.trigger.mode || 'none';
            const radio = document.querySelector(`input[name="trigger-mode"][value="${mode}"]`);
            if (radio) radio.checked = true;
            
            const wsUrl = document.getElementById('ws-url');
            if (wsUrl) wsUrl.value = config.trigger.wsUrl || '';
            
            if (mode === 'websocket') {
                wsConfig.classList.remove('hidden');
            } else {
                wsConfig.classList.add('hidden');
            }
        }
        
        if (config.media) {
            document.getElementById('record-webcam').checked = !!config.media.recordWebcam;
            document.getElementById('record-screen').checked = !!config.media.recordScreen;
        }
    }

    function updateDashboardSummary(config) {
        const fbProjectSpan = document.getElementById('summary-firebase-project');
        const triggerModeSpan = document.getElementById('summary-trigger-mode');
        const mediaOptionsSpan = document.getElementById('summary-media-options');

        if (isFirebaseConfigured(config)) {
            fbProjectSpan.textContent = config.firebase.projectId;
            fbProjectSpan.className = "value text-success";
        } else {
            fbProjectSpan.textContent = "Not Configured";
            fbProjectSpan.className = "value text-error";
        }

        const mode = config.trigger?.mode || 'none';
        if (mode === 'none') {
            triggerModeSpan.textContent = 'None';
        } else if (mode === 'websocket') {
            triggerModeSpan.textContent = `WebSocket (${config.trigger?.wsUrl || ''})`;
        } else if (mode === 'webserial') {
            triggerModeSpan.textContent = 'WebSerial';
        } else if (mode === 'webusb') {
            triggerModeSpan.textContent = 'WebUSB';
        }
        triggerModeSpan.className = "value text-accent";

        const webcam = config.media?.recordWebcam;
        const screen = config.media?.recordScreen;
        const mediaList = [];
        if (webcam) mediaList.push("Webcam 📹");
        if (screen) mediaList.push("Screen 🖥️");
        
        mediaOptionsSpan.textContent = mediaList.length > 0 ? mediaList.join(" + ") : "None";
        mediaOptionsSpan.className = "value";
    }

    function updateTriggerUIStatus() {
        const mode = getTriggerMode();
        const connected = isTriggerConnected();
        
        const triggerStatus = document.getElementById('trigger-status');
        const dbTriggerStatus = document.getElementById('dashboard-trigger-status');
        const triggerTestSection = document.getElementById('trigger-test-section');
        const dbTestControls = document.getElementById('dashboard-test-controls');
        const dbTriggerTestSection = document.getElementById('dashboard-trigger-test');

        if (mode === 'none') {
            dbTriggerTestSection.classList.add('hidden');
            triggerTestSection.classList.add('hidden');
            return;
        }

        dbTriggerTestSection.classList.remove('hidden');
        triggerTestSection.classList.remove('hidden');
        dbTestControls.classList.remove('hidden');

        const statusText = connected ? `Connected (${mode})` : 'Disconnected';
        const addClass = connected ? 'connected' : 'disconnected';
        const removeClass = connected ? 'disconnected' : 'connected';

        // Settings panel badge
        triggerStatus.textContent = statusText;
        triggerStatus.classList.remove(removeClass);
        triggerStatus.classList.add(addClass);

        // Dashboard panel badge
        dbTriggerStatus.textContent = statusText;
        dbTriggerStatus.classList.remove(removeClass);
        dbTriggerStatus.classList.add(addClass);
    }

    // -------------------------------------------------------------
    // Connection and Test Helpers
    // -------------------------------------------------------------
    async function handleConnectDevice() {
        const mode = document.querySelector('input[name="trigger-mode"]:checked').value;
        if (mode === 'none') return;
        
        if (mode === 'websocket') {
            const url = document.getElementById('ws-url').value;
            setTriggerMode(mode, { url });
        } else {
            const connected = await connectDevice();
            if (!connected) {
                alert(`Failed to connect to ${mode}. Did you grant permission?`);
            }
        }
        updateTriggerUIStatus();
    }

    async function testTriggerConnection(inputId, statusId) {
        const value = document.getElementById(inputId).value.trim();
        const statusSpan = document.getElementById(statusId);
        
        if (!value) {
            statusSpan.textContent = "Please enter a marker value";
            statusSpan.className = "text-error";
            return;
        }
        
        try {
            statusSpan.textContent = "Sending...";
            statusSpan.className = "text-accent";
            await sendTrigger(value);
            statusSpan.textContent = `Successfully sent: "${value}"`;
            statusSpan.className = "text-success";
        } catch (err) {
            statusSpan.textContent = `Error: ${err.message || err}`;
            statusSpan.className = "text-error";
        }
        
        setTimeout(() => {
            statusSpan.textContent = "";
        }, 4000);
    }

    async function startExperimentWithPermissions() {
        const recordWebcam = document.getElementById('record-webcam').checked;
        const recordScreen = document.getElementById('record-screen').checked;
        
        if (recordWebcam || recordScreen) {
            const needWebcam = recordWebcam && !hasWebcamStream();
            const needScreen = recordScreen && !hasScreenStream();
            
            if (needWebcam || needScreen) {
                const success = await requestMediaPermissions(recordWebcam, recordScreen);
                if (!success) {
                    alert("Media permissions are required to start the experiment with recording enabled.");
                    return;
                }
                
                // Update settings page status just in case
                mediaStatus.textContent = 'Ready';
                mediaStatus.classList.remove('disconnected');
                mediaStatus.classList.add('connected');
            }
            startRecording();
        }
        runExperiment();
    }

    // -------------------------------------------------------------
    // Initialization
    // -------------------------------------------------------------
    const config = loadConfig();
    const isConfigured = isFirebaseConfigured(config);

    if (isConfigured) {
        // Populate inputs
        updateUIFromConfig(config);
        
        // Init Firebase
        const fbSuccess = initFirebase(config.firebase);
        if (fbSuccess) {
            fbStatus.textContent = 'Configured';
            fbStatus.classList.remove('disconnected');
            fbStatus.classList.add('connected');
        }

        // Init Trigger mode
        const trigMode = config.trigger?.mode || 'none';
        setTriggerMode(trigMode, { url: config.trigger?.wsUrl });
        
        // Attempt Auto Connect
        autoConnectDevice().then(() => {
            updateTriggerUIStatus();
        });

        // Set View to Dashboard
        settingsPanel.classList.add('hidden');
        dashboardPanel.classList.remove('hidden');
        settingsBackBtn.classList.remove('hidden'); // allow going back
        updateDashboardSummary(config);
    } else {
        // Show Settings
        settingsPanel.classList.remove('hidden');
        dashboardPanel.classList.add('hidden');
        settingsBackBtn.classList.add('hidden');
    }

    // Update statuses periodically to capture socket/serial open state updates
    setInterval(updateTriggerUIStatus, 1000);

    // -------------------------------------------------------------
    // Event Listeners
    // -------------------------------------------------------------

    // Firebase Config Save
    fbSaveBtn.addEventListener('click', () => {
        const apiKey = document.getElementById('fb-apikey').value.trim();
        const authDomain = document.getElementById('fb-authdomain').value.trim();
        const projectId = document.getElementById('fb-projectid').value.trim();
        
        if (!apiKey || !authDomain || !projectId) {
            alert("Please fill all Firebase fields");
            return;
        }

        const success = initFirebase({ apiKey, authDomain, projectId });
        if (success) {
            fbStatus.textContent = 'Configured';
            fbStatus.classList.remove('disconnected');
            fbStatus.classList.add('connected');

            // Save and render dashboard
            const newConfig = saveAllSettingsToCache();
            updateDashboardSummary(newConfig);

            settingsPanel.classList.add('hidden');
            dashboardPanel.classList.remove('hidden');
            settingsBackBtn.classList.remove('hidden');
        } else {
            alert("Failed to initialize Firebase. Please verify credentials.");
        }
    });

    // Trigger mode changed
    triggerRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            const mode = e.target.value;
            if (mode === 'websocket') {
                wsConfig.classList.remove('hidden');
            } else {
                wsConfig.classList.add('hidden');
            }
            
            // Update trigger mode internally & save
            const wsUrlVal = document.getElementById('ws-url').value.trim();
            setTriggerMode(mode, { url: wsUrlVal });
            saveAllSettingsToCache();
            updateTriggerUIStatus();
        });
    });

    // WebSocket URL input auto-saves
    document.getElementById('ws-url').addEventListener('input', () => {
        const mode = document.querySelector('input[name="trigger-mode"]:checked').value;
        const wsUrlVal = document.getElementById('ws-url').value.trim();
        setTriggerMode(mode, { url: wsUrlVal });
        saveAllSettingsToCache();
    });

    // Media Options changed auto-saves & visibility
    document.getElementById('record-webcam').addEventListener('change', () => {
        saveAllSettingsToCache();
    });
    document.getElementById('record-screen').addEventListener('change', () => {
        saveAllSettingsToCache();
    });

    // Trigger Connection buttons
    triggerConnectBtn.addEventListener('click', handleConnectDevice);
    dashboardConnectBtn.addEventListener('click', handleConnectDevice);

    // Testing Markers
    settingsTestBtn.addEventListener('click', () => {
        testTriggerConnection('trigger-test-input', 'trigger-test-status');
    });
    dashboardTestBtn.addEventListener('click', () => {
        testTriggerConnection('dashboard-test-input', 'dashboard-test-status');
    });

    // Media Permissions Request button
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
            
            // Save settings to cache
            saveAllSettingsToCache();
        }
    });

    // View toggling
    editSettingsBtn.addEventListener('click', () => {
        dashboardPanel.classList.add('hidden');
        settingsPanel.classList.remove('hidden');
    });

    settingsBackBtn.addEventListener('click', () => {
        const currentConfig = saveAllSettingsToCache();
        updateDashboardSummary(currentConfig);
        settingsPanel.classList.add('hidden');
        dashboardPanel.classList.remove('hidden');
    });

    // Start Experiment buttons
    startBtn.addEventListener('click', startExperimentWithPermissions);
    dashboardStartBtn.addEventListener('click', startExperimentWithPermissions);
});
