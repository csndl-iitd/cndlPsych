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

export async function requestMediaPermissions(recordWebcam, recordScreen) {
    try {
        if (recordWebcam) {
            webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
        if (recordScreen) {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
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

export function stopRecordingAndDownload(participantId = 'subject') {
    if (webcamRecorder && webcamRecorder.state !== 'inactive') {
        webcamRecorder.onstop = () => downloadMedia(webcamChunks, `${participantId}_webcam.webm`);
        webcamRecorder.stop();
    }
    if (screenRecorder && screenRecorder.state !== 'inactive') {
        screenRecorder.onstop = () => downloadMedia(screenChunks, `${participantId}_screen.webm`);
        screenRecorder.stop();
    }

    // Stop streams
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
