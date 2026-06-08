import { initFirebase, downloadAllFirestoreData } from './firebase.js';
import { setTriggerMode, connectDevice, autoConnectDevice, isTriggerConnected, getTriggerMode, sendTrigger } from './triggers.js';
import { requestMediaPermissions, startRecording, hasWebcamStream, hasScreenStream, getMediaTrackDetails, downloadWebcam, downloadScreen, resetRecordingChunks } from './media.js';
import { runExperiment } from './experiment.js';
import { syncFirestoreToBids } from './bids.js';


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

    // UI Elements - Target FPS inputs
    const webcamTargetFps = document.getElementById('webcam-target-fps');
    const screenTargetFps = document.getElementById('screen-target-fps');
    const fpsConfigSection = document.getElementById('fps-config-section');

    // UI Elements - BIDS
    const linkBidsBtn = document.getElementById('link-bids-btn');
    const bidsStatus = document.getElementById('bids-status');
    const bidsPathDisplay = document.getElementById('bids-path-display');
    const syncBidsBtn = document.getElementById('sync-bids-btn');

    // UI Elements - Done Panel
    const returnDashboardBtn = document.getElementById('return-dashboard-btn');

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
        const enableFirestore = document.getElementById('fb-firestore-recording').checked;
        const mode = document.querySelector('input[name="trigger-mode"]:checked')?.value || 'none';
        const wsUrl = document.getElementById('ws-url').value.trim();
        const format = document.getElementById('trigger-format').value;
        const recordWebcam = document.getElementById('record-webcam').checked;
        const recordScreen = document.getElementById('record-screen').checked;
        const webcamFps = webcamTargetFps.value.trim();
        const screenFps = screenTargetFps.value.trim();

        const config = {
            firebase: { apiKey, authDomain, projectId, enableFirestore },
            trigger: { mode, wsUrl, format },
            media: { recordWebcam, recordScreen, webcamFps, screenFps }
        };
        localStorage.setItem('cndlpsych_config', JSON.stringify(config));
        return config;
    }

    // Checking if firebase is configured
    function isFirebaseConfigured(config) {
        if (config && config.firebase && config.firebase.enableFirestore === false) {
            return true; // Local-only mode: valid without credentials
        }
        return !!(config && config.firebase && config.firebase.apiKey && config.firebase.authDomain && config.firebase.projectId);
    }

    function updateUIFromConfig(config) {
        if (config.firebase) {
            document.getElementById('fb-apikey').value = config.firebase.apiKey || '';
            document.getElementById('fb-authdomain').value = config.firebase.authDomain || '';
            document.getElementById('fb-projectid').value = config.firebase.projectId || '';
            document.getElementById('fb-firestore-recording').checked = config.firebase.enableFirestore !== false;
        }

        if (config.trigger) {
            const mode = config.trigger.mode || 'none';
            const radio = document.querySelector(`input[name="trigger-mode"][value="${mode}"]`);
            if (radio) radio.checked = true;

            const wsUrl = document.getElementById('ws-url');
            if (wsUrl) wsUrl.value = config.trigger.wsUrl || '';

            const format = config.trigger.format || 'character';
            document.getElementById('trigger-format').value = format;

            if (mode === 'websocket') {
                wsConfig.classList.remove('hidden');
            } else {
                wsConfig.classList.add('hidden');
            }
        }

        if (config.media) {
            document.getElementById('record-webcam').checked = !!config.media.recordWebcam;
            document.getElementById('record-screen').checked = !!config.media.recordScreen;
            webcamTargetFps.value = config.media.webcamFps || '';
            screenTargetFps.value = config.media.screenFps || '';
            updateFpsConfigSectionVisibility();
        }
    }

    function updateDashboardSummary(config) {
        const fbProjectSpan = document.getElementById('summary-firebase-project');
        const triggerModeSpan = document.getElementById('summary-trigger-mode');
        const mediaOptionsSpan = document.getElementById('summary-media-options');

        if (isFirebaseConfigured(config)) {
            if (config.firebase && config.firebase.enableFirestore === false) {
                fbProjectSpan.textContent = "Local Mode";
                fbProjectSpan.className = "value text-success";
            } else {
                fbProjectSpan.textContent = config.firebase.projectId;
                fbProjectSpan.className = "value text-success";
            }
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

    function updateFpsConfigSectionVisibility() {
        const recordWebcam = document.getElementById('record-webcam').checked;
        const recordScreen = document.getElementById('record-screen').checked;
        if (recordWebcam || recordScreen) {
            fpsConfigSection.classList.remove('hidden');
        } else {
            fpsConfigSection.classList.add('hidden');
        }
    }

    function updateFpsInfoLabels() {
        const details = getMediaTrackDetails();
        const webcamInfo = document.getElementById('webcam-fps-info');
        const screenInfo = document.getElementById('screen-fps-info');
        const recordWebcam = document.getElementById('record-webcam').checked;
        const recordScreen = document.getElementById('record-screen').checked;

        if (recordWebcam && details.webcam.current) {
            let text = `Current: ${details.webcam.current} fps`;
            if (details.webcam.min !== null && details.webcam.max !== null) {
                text += ` (Range: ${details.webcam.min}-${details.webcam.max})`;
            }
            webcamInfo.textContent = text;
        } else {
            webcamInfo.textContent = "";
        }

        if (recordScreen && details.screen.current) {
            let text = `Current: ${details.screen.current} fps`;
            if (details.screen.min !== null && details.screen.max !== null) {
                text += ` (Range: ${details.screen.min}-${details.screen.max})`;
            }
            screenInfo.textContent = text;
        } else {
            screenInfo.textContent = "";
        }
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
                const webcamFps = webcamTargetFps.value.trim();
                const screenFps = screenTargetFps.value.trim();

                const success = await requestMediaPermissions(recordWebcam, recordScreen, webcamFps, screenFps);
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
            if (config.firebase && config.firebase.enableFirestore === false) {
                fbStatus.textContent = 'Local Mode';
            } else {
                fbStatus.textContent = 'Configured';
            }
            fbStatus.classList.remove('disconnected');
            fbStatus.classList.add('connected');
        }

        // Init Trigger mode
        const trigMode = config.trigger?.mode || 'none';
        setTriggerMode(trigMode, { url: config.trigger?.wsUrl, format: config.trigger?.format });

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
        const enableFirestore = document.getElementById('fb-firestore-recording').checked;
        const apiKey = document.getElementById('fb-apikey').value.trim();
        const authDomain = document.getElementById('fb-authdomain').value.trim();
        const projectId = document.getElementById('fb-projectid').value.trim();

        if (enableFirestore && (!apiKey || !authDomain || !projectId)) {
            alert("Please fill all Firebase fields, or disable Firestore Recording for local-only mode.");
            return;
        }

        const success = initFirebase({ apiKey, authDomain, projectId, enableFirestore });
        if (success) {
            if (!enableFirestore) {
                fbStatus.textContent = 'Local Mode';
            } else {
                fbStatus.textContent = 'Configured';
            }
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
        updateFpsConfigSectionVisibility();
    });
    document.getElementById('record-screen').addEventListener('change', () => {
        saveAllSettingsToCache();
        updateFpsConfigSectionVisibility();
    });

    // Target FPS input changes auto-save
    webcamTargetFps.addEventListener('input', () => {
        saveAllSettingsToCache();
    });
    screenTargetFps.addEventListener('input', () => {
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

        const webcamFps = webcamTargetFps.value.trim();
        const screenFps = screenTargetFps.value.trim();

        const success = await requestMediaPermissions(recordWebcam, recordScreen, webcamFps, screenFps);
        if (success) {
            mediaStatus.textContent = 'Ready';
            mediaStatus.classList.remove('disconnected');
            mediaStatus.classList.add('connected');

            // Autodetect capabilities and show information
            updateFpsInfoLabels();

            // Auto-populate target inputs with autodetected values if currently empty
            const details = getMediaTrackDetails();
            if (recordWebcam && details.webcam.current && !webcamTargetFps.value) {
                webcamTargetFps.value = details.webcam.current;
            }
            if (recordScreen && details.screen.current && !screenTargetFps.value) {
                screenTargetFps.value = details.screen.current;
            }

            // Save settings to cache
            saveAllSettingsToCache();
        }
    });

    // View toggling
    editSettingsBtn.addEventListener('click', () => {
        dashboardPanel.classList.add('hidden');
        settingsPanel.classList.remove('hidden');
        updateFpsConfigSectionVisibility();
        if (hasWebcamStream() || hasScreenStream()) {
            updateFpsInfoLabels();
        }
    });

    settingsBackBtn.addEventListener('click', () => {
        const currentConfig = saveAllSettingsToCache();
        updateDashboardSummary(currentConfig);
        settingsPanel.classList.add('hidden');
        dashboardPanel.classList.remove('hidden');
    });

    // Return to Dashboard from Done Screen
    returnDashboardBtn.addEventListener('click', () => {
        // Reset recording chunks to free memory
        resetRecordingChunks();

        // Show dashboard, hide done screen
        document.getElementById('done-panel').classList.add('hidden');
        document.getElementById('app-background').classList.remove('hidden');
        dashboardPanel.classList.remove('hidden');
    });

    // -------------------------------------------------------------
    // BIDS Directory Handle Persistence & UI Helpers
    // -------------------------------------------------------------
    const DB_NAME = "BidsWorkspaceDB";
    const STORE_NAME = "handles";
    const KEY = "bids_root";

    function getStoredDirectoryHandle() {
        return new Promise((resolve) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = (e) => {
                const db = e.target.result;
                try {
                    const transaction = db.transaction(STORE_NAME, "readonly");
                    const store = transaction.objectStore(STORE_NAME);
                    const getReq = store.get(KEY);
                    getReq.onsuccess = () => resolve(getReq.result || null);
                    getReq.onerror = () => resolve(null);
                } catch (err) {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null);
        });
    }

    function storeDirectoryHandle(handle) {
        return new Promise((resolve) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = (e) => {
                const db = e.target.result;
                try {
                    const transaction = db.transaction(STORE_NAME, "readwrite");
                    const store = transaction.objectStore(STORE_NAME);
                    store.put(handle, KEY);
                    transaction.oncomplete = () => resolve(true);
                } catch (err) {
                    resolve(false);
                }
            };
            request.onerror = () => resolve(false);
        });
    }

    function updateBidsUIStatus(dirName, needsGrant = false) {
        if (!dirName) {
            bidsStatus.textContent = 'Not Linked';
            bidsStatus.className = 'status-badge disconnected';
            bidsPathDisplay.textContent = 'No directory linked';
            syncBidsBtn.classList.add('hidden');
            return;
        }

        if (needsGrant) {
            bidsStatus.textContent = 'Needs Grant';
            bidsStatus.className = 'status-badge disconnected';
            bidsPathDisplay.textContent = `Configured: ${dirName} (Click 'Link' to grant access)`;
            syncBidsBtn.classList.add('hidden');
        } else {
            bidsStatus.textContent = 'Linked';
            bidsStatus.className = 'status-badge connected';
            bidsPathDisplay.textContent = `Directory: ${dirName}`;
            syncBidsBtn.classList.remove('hidden');
        }
    }

    // Auto-load stored BIDS directory
    getStoredDirectoryHandle().then(async (handle) => {
        if (handle) {
            try {
                const opts = { mode: 'readwrite' };
                const perm = await handle.queryPermission(opts);
                if (perm === 'granted') {
                    window.bidsDirectoryHandle = handle;
                    updateBidsUIStatus(handle.name);
                } else {
                    updateBidsUIStatus(handle.name, true);
                }
            } catch (err) {
                console.error("Error querying permissions for saved directory handle:", err);
                updateBidsUIStatus(handle.name, true);
            }
        } else {
            updateBidsUIStatus(null);
        }
    });

    // Link BIDS Button click
    linkBidsBtn.addEventListener('click', async () => {
        try {
            let handle = window.bidsDirectoryHandle;
            if (!handle) {
                handle = await getStoredDirectoryHandle();
            }
            if (handle) {
                const opts = { mode: 'readwrite' };
                const perm = await handle.requestPermission(opts);
                if (perm === 'granted') {
                    window.bidsDirectoryHandle = handle;
                    updateBidsUIStatus(handle.name);
                    return;
                }
            }

            if (typeof window.showDirectoryPicker !== 'function') {
                alert("Your browser does not support the File System Access API. Please use a Chromium-based browser (Chrome, Edge, Opera) to link local directories.");
                return;
            }

            const newHandle = await window.showDirectoryPicker();
            window.bidsDirectoryHandle = newHandle;
            await storeDirectoryHandle(newHandle);
            updateBidsUIStatus(newHandle.name);
        } catch (err) {
            console.error("Error linking BIDS directory:", err);
            alert("Could not access directory: " + (err.message || err));
        }
    });

    // Sync Firestore to BIDS Button click
    syncBidsBtn.addEventListener('click', async () => {
        if (!window.bidsDirectoryHandle) {
            alert("Please link a BIDS directory first.");
            return;
        }

        const bidsSyncStatus = document.getElementById('bids-sync-status');
        bidsSyncStatus.textContent = "Syncing Firestore data...";
        bidsSyncStatus.className = "text-accent";
        syncBidsBtn.disabled = true;

        try {
            const dbData = await downloadAllFirestoreData();
            if (!dbData) {
                bidsSyncStatus.textContent = "Error: Firestore not initialized or recording is disabled.";
                bidsSyncStatus.className = "text-error";
                syncBidsBtn.disabled = false;
                return;
            }
            await syncFirestoreToBids(window.bidsDirectoryHandle, dbData);
            bidsSyncStatus.textContent = "Sync completed successfully! BIDS files generated.";
            bidsSyncStatus.className = "text-success";
        } catch (err) {
            console.error("BIDS Sync error:", err);
            bidsSyncStatus.textContent = `Sync failed: ${err.message || err}`;
            bidsSyncStatus.className = "text-error";
        } finally {
            syncBidsBtn.disabled = false;
            setTimeout(() => {
                bidsSyncStatus.textContent = "";
            }, 5000);
        }
    });

    // Start Experiment buttons
    startBtn.addEventListener('click', startExperimentWithPermissions);
    dashboardStartBtn.addEventListener('click', startExperimentWithPermissions);
});
