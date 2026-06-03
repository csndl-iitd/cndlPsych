let webcamStream = null;
let screenStream = null;
let webcamRecorder = null;
let screenRecorder = null;

let webcamChunks = [];
let screenChunks = [];

export async function requestMediaPermissions(recordWebcam, recordScreen) {
    try {
        if (recordWebcam) {
            webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }
        if (recordScreen) {
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        }
        return true;
    } catch (err) {
        console.error("Media permission denied:", err);
        return false;
    }
}

export function startRecording() {
    if (webcamStream) {
        webcamRecorder = new MediaRecorder(webcamStream);
        webcamRecorder.ondataavailable = e => webcamChunks.push(e.data);
        webcamRecorder.start();
    }
    if (screenStream) {
        screenRecorder = new MediaRecorder(screenStream);
        screenRecorder.ondataavailable = e => screenChunks.push(e.data);
        screenRecorder.start();
    }
}

export function stopRecordingAndDownload() {
    if (webcamRecorder && webcamRecorder.state !== 'inactive') {
        webcamRecorder.onstop = () => downloadMedia(webcamChunks, 'webcam_recording.webm');
        webcamRecorder.stop();
    }
    if (screenRecorder && screenRecorder.state !== 'inactive') {
        screenRecorder.onstop = () => downloadMedia(screenChunks, 'screen_recording.webm');
        screenRecorder.stop();
    }
}

function downloadMedia(chunks, filename) {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
}
