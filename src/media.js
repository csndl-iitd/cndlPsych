let webcamStream = null;
let screenStream = null;
let webcamRecorder = null;
let screenRecorder = null;

let webcamChunks = [];
let screenChunks = [];

export function hasWebcamStream() {
    return !!(webcamStream && webcamStream.active);
}

export function hasScreenStream() {
    return !!(screenStream && screenStream.active);
}

export function getMediaTrackDetails() {
    const details = {
        webcam: { current: null, min: null, max: null },
        screen: { current: null, min: null, max: null }
    };

    if (webcamStream) {
        const track = webcamStream.getVideoTracks()[0];
        if (track) {
            const settings = track.getSettings();
            details.webcam.current = settings.frameRate || null;

            if (typeof track.getCapabilities === 'function') {
                const caps = track.getCapabilities();
                if (caps.frameRate) {
                    details.webcam.min = caps.frameRate.min || null;
                    details.webcam.max = caps.frameRate.max || null;
                }
            }
        }
    }

    if (screenStream) {
        const track = screenStream.getVideoTracks()[0];
        if (track) {
            const settings = track.getSettings();
            details.screen.current = settings.frameRate || null;

            if (typeof track.getCapabilities === 'function') {
                const caps = track.getCapabilities();
                if (caps.frameRate) {
                    details.screen.min = caps.frameRate.min || null;
                    details.screen.max = caps.frameRate.max || null;
                }
            }
        }
    }

    return details;
}

export async function requestMediaPermissions(recordWebcam, recordScreen, webcamFps = null, screenFps = null) {
    try {
        if (recordWebcam) {
            const videoConstraints = webcamFps ? { frameRate: { ideal: Number(webcamFps) } } : true;
            webcamStream = await navigator.mediaDevices.getUserMedia({
                video: videoConstraints,
                audio: true
            });
        }
        if (recordScreen) {
            const videoConstraints = screenFps ? { frameRate: { ideal: Number(screenFps) } } : true;
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: videoConstraints,
                audio: false,
                preferCurrentTab: true
            });
        }
        return true;
    } catch (err) {
        console.error("Media permission denied:", err);
        return false;
    }
}

export function startRecording() {
    webcamChunks = [];
    screenChunks = [];

    if (webcamStream) {
        webcamRecorder = new MediaRecorder(webcamStream);
        webcamRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
                webcamChunks.push(e.data);
            }
        };
        webcamRecorder.start();
    }
    if (screenStream) {
        screenRecorder = new MediaRecorder(screenStream);
        screenRecorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) {
                screenChunks.push(e.data);
            }
        };
        screenRecorder.start();
    }
}

export function stopRecording() {
    if (webcamRecorder && webcamRecorder.state !== 'inactive') {
        webcamRecorder.stop();
    }
    if (screenRecorder && screenRecorder.state !== 'inactive') {
        screenRecorder.stop();
    }

    // Stop streams immediately to turn off indicators (webcam light)
    if (webcamStream) {
        webcamStream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
        });
        webcamStream = null;
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            try { track.stop(); } catch (e) {}
        });
        screenStream = null;
    }
}

export function downloadWebcam(participantId = 'subject') {
    if (webcamChunks.length > 0) {
        downloadMedia(webcamChunks, `${participantId}_webcam.webm`);
    } else {
        console.warn("No webcam chunks recorded.");
    }
}

export function downloadScreen(participantId = 'subject') {
    if (screenChunks.length > 0) {
        downloadMedia(screenChunks, `${participantId}_screen.webm`);
    } else {
        console.warn("No screen chunks recorded.");
    }
}

export function resetRecordingChunks() {
    webcamChunks = [];
    screenChunks = [];
}

function downloadMedia(chunks, filename) {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
