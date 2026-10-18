// Webcam recording: the camera (and optionally the microphone) is recorded with the browser's
// MediaRecorder for the whole session. The video is cut into pieces of `chunk_s` seconds; each piece
// is handed to `saveChunk` (the local store) as soon as it exists, so an interrupted session loses at
// most the last piece. Concatenated in order, the pieces are one playable file.
//
// The bus gets webcam.start (with the page clock at the moment the recorder started, time 0 of the
// video), webcam.chunk, webcam.stop and webcam.error. How closely video time 0 is the first frame is
// not known (the recorder reports its start, the first frame comes shortly after), so the video is
// aligned to the log to within a few frames at best; nothing here measured that.

const DEFAULTS = { audio: false, video: { width: 640, height: 480, fps: 30, facing: 'user' }, bitrate_kbps: 1000, chunk_s: 10, on_denied: 'abort' };
const MIME_TYPES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
const MIME_TYPES_WITH_AUDIO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', ...MIME_TYPES];

/** The recording settings with the defaults filled in. */
export function webcamSettings(config = {}) {
  return { ...DEFAULTS, ...config, video: { ...DEFAULTS.video, ...config.video } };
}

/** The best container this browser can record, or null. */
export function pickMime(MediaRecorderClass, audio) {
  return (audio ? MIME_TYPES_WITH_AUDIO : MIME_TYPES).find((type) => MediaRecorderClass?.isTypeSupported?.(type)) ?? null;
}

function failure(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return { code: 'denied', message: 'The camera (or microphone) was not allowed.' };
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'NotReadableError':
      return { code: 'no_camera', message: `No usable camera: ${error.message || error.name}` };
    default:
      return { code: 'no_camera', message: String(error?.message ?? error) };
  }
}

/**
 * @param {{
 *   bus: object, clock: {now: () => number}, config?: object,
 *   saveChunk: (chunk: {segment: number, index: number, blob: Blob, t: number}) => Promise<void>,
 *   firstSegment?: number,
 *   mediaDevices?: MediaDevices, MediaRecorderClass?: typeof MediaRecorder,
 * }} options `firstSegment` is the number of the first recording of this page run (a resumed session carries on counting)
 */
export function createWebcam({
  bus, clock, config, saveChunk, firstSegment = 1,
  mediaDevices = globalThis.navigator?.mediaDevices, MediaRecorderClass = globalThis.MediaRecorder,
}) {
  const settings = webcamSettings(config);
  const totals = { segments: 0, chunks: 0, bytes: 0, duration_ms: 0, errors: 0 };
  let active = null; // {recorder, stream, segment, startedAt, chunks, bytes, pending, stopping}
  let given = null; // the settings the camera actually gave
  let mime = null;
  let denied = false;
  let storageFailed = false;

  function emitError(code, message) {
    totals.errors += 1;
    bus.emit({ source: 'system', type: 'webcam.error', data: { code, message } });
  }

  function keepChunk(run, blob) {
    const index = run.chunks;
    run.chunks += 1;
    run.bytes += blob.size;
    totals.chunks += 1;
    totals.bytes += blob.size;
    bus.emit({ source: 'system', type: 'webcam.chunk', data: { segment: run.segment, index, bytes: blob.size } });
    run.pending = run.pending.then(() => saveChunk({ segment: run.segment, index, blob, t: clock.now() })).catch((error) => {
      if (storageFailed) return;
      storageFailed = true;
      emitError('storage_failed', `The video could not be saved: ${error?.message ?? error}`);
    });
  }

  async function open() {
    if (!mediaDevices?.getUserMedia || !MediaRecorderClass) return { ok: false, code: 'unsupported', message: 'This browser cannot record video.' };
    mime = pickMime(MediaRecorderClass, settings.audio);
    if (mime === null) return { ok: false, code: 'unsupported', message: 'This browser has no video format it can record.' };
    const { width, height, fps, facing } = settings.video;
    try {
      const stream = await mediaDevices.getUserMedia({
        video: { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps }, facingMode: facing },
        audio: settings.audio,
      });
      return { ok: true, stream };
    } catch (error) {
      return { ok: false, ...failure(error) };
    }
  }

  return {
    settings,

    /**
     * Ask for the camera and start recording.
     * @returns {Promise<{ok: true} | {ok: false, code: string, message: string}>}
     */
    async start() {
      const opened = await open();
      if (!opened.ok) {
        denied = true;
        emitError(opened.code, opened.message);
        return opened;
      }
      const { stream } = opened;
      const track = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
      given = { width: track.width, height: track.height, fps: track.frameRate };
      totals.segments += 1;
      const run = { segment: firstSegment + totals.segments - 1, chunks: 0, bytes: 0, pending: Promise.resolve(), startedAt: null, stopping: null };
      const recorder = new MediaRecorderClass(stream, { mimeType: mime, videoBitsPerSecond: settings.bitrate_kbps * 1000 });
      const current = { ...run, recorder, stream };
      active = current;
      const started = new Promise((resolve) => { recorder.onstart = resolve; });
      recorder.ondataavailable = (event) => { if (event.data?.size) keepChunk(current, event.data); };
      recorder.onerror = (event) => emitError('recorder_error', String(event.error?.message ?? 'the recorder failed'));
      recorder.start(settings.chunk_s * 1000);
      await started;
      current.startedAt = clock.now();
      bus.emit({
        source: 'system',
        type: 'webcam.start',
        data: { segment: current.segment, mime, t_start: current.startedAt, audio: settings.audio, ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined)) },
      });
      return { ok: true };
    },

    /** Stop recording and wait until everything is saved. Safe to call when nothing is recording. */
    async stop(reason = 'session_end') {
      const run = active;
      if (!run) return;
      active = null;
      const stopped = new Promise((resolve) => { run.recorder.onstop = resolve; });
      if (run.recorder.state !== 'inactive') run.recorder.stop();
      await stopped;
      run.stream.getTracks().forEach((track) => track.stop());
      await run.pending;
      const duration = clock.now() - run.startedAt;
      totals.duration_ms += duration;
      bus.emit({ source: 'system', type: 'webcam.stop', data: { segment: run.segment, reason, chunks: run.chunks, bytes: run.bytes, duration_ms: duration } });
    },

    /** The page is going away: ask the recorder for what it holds, so it can be saved. */
    flush() {
      if (active?.recorder.state === 'recording') active.recorder.requestData();
    },

    /** The `webcam` part of the session record. */
    summary() {
      return {
        enabled: true,
        ...(denied ? { camera_denied: true } : {}),
        ...(totals.segments ? {
          mime, audio: settings.audio, segments: totals.segments, chunks: totals.chunks, bytes: totals.bytes, duration_ms: Math.round(totals.duration_ms),
          video: Object.fromEntries(Object.entries(given ?? {}).filter(([, value]) => value !== undefined)),
        } : {}),
        errors: totals.errors,
      };
    },
  };
}
