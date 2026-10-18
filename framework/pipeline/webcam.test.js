import { describe, expect, it } from 'vitest';
import { createBus } from '../foundation/events.js';
import { createWebcam, pickMime, webcamSettings } from './webcam.js';

/** A MediaRecorder that produces a 10-byte piece per requestData() and one more at stop(). */
function fakeRecorderClass(supported = ['video/webm;codecs=vp9', 'video/webm']) {
  return class FakeRecorder {
    static isTypeSupported = (type) => supported.includes(type);

    constructor(stream, options) {
      this.stream = stream;
      this.options = options;
      this.state = 'inactive';
      FakeRecorder.last = this;
    }

    start(timeslice) {
      this.timeslice = timeslice;
      this.state = 'recording';
      queueMicrotask(() => this.onstart?.());
    }

    requestData() { this.ondataavailable?.({ data: new Blob([new Uint8Array(10)]) }); }

    stop() {
      this.requestData();
      this.state = 'inactive';
      queueMicrotask(() => this.onstop?.());
    }
  };
}

function fakeCamera({ error } = {}) {
  const stopped = [];
  const calls = [];
  const track = { getSettings: () => ({ width: 640, height: 480, frameRate: 30 }), stop: () => stopped.push(true) };
  return {
    stopped,
    calls,
    getUserMedia: async (constraints) => {
      calls.push(constraints);
      if (error) throw Object.assign(new Error('x'), { name: error });
      return { getVideoTracks: () => [track], getTracks: () => [track] };
    },
  };
}

function setup({ config = {}, camera = fakeCamera(), supported, saveChunk, firstSegment } = {}) {
  let now = 1000;
  const clock = { now: () => { now += 50; return now; } };
  const bus = createBus({ clock });
  const log = [];
  bus.on('*', (event) => log.push(event));
  bus.startRecording();
  const saved = [];
  const Recorder = fakeRecorderClass(supported);
  const webcam = createWebcam({
    bus, clock, config, firstSegment, mediaDevices: camera, MediaRecorderClass: Recorder, saveChunk: saveChunk ?? (async (chunk) => { saved.push(chunk); }),
  });
  const events = () => log.filter((e) => e.type.startsWith('webcam.'));
  return { webcam, camera, saved, events, Recorder };
}

describe('settings and formats', () => {
  it('fills in the defaults', () => {
    expect(webcamSettings({ enabled: true })).toMatchObject({ audio: false, bitrate_kbps: 1000, chunk_s: 10, on_denied: 'abort', video: { width: 640, height: 480, fps: 30, facing: 'user' } });
    expect(webcamSettings({ video: { width: 1280 } }).video).toEqual({ width: 1280, height: 480, fps: 30, facing: 'user' });
  });

  it('picks the first supported container, with sound codecs only when sound is asked for', () => {
    const Recorder = fakeRecorderClass(['video/webm;codecs=vp8', 'video/webm;codecs=vp8,opus']);
    expect(pickMime(Recorder, false)).toBe('video/webm;codecs=vp8');
    expect(pickMime(Recorder, true)).toBe('video/webm;codecs=vp8,opus');
    expect(pickMime(fakeRecorderClass([]), false)).toBeNull();
  });
});

describe('recording', () => {
  it('asks the camera for the configured size, starts the recorder and logs webcam.start with the page clock', async () => {
    const { webcam, camera, events, Recorder } = setup({ config: { video: { width: 1280, height: 720, fps: 24 }, chunk_s: 5, bitrate_kbps: 500 } });
    expect(await webcam.start()).toEqual({ ok: true });
    expect(camera.calls[0].video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 }, facingMode: 'user' });
    expect(camera.calls[0].audio).toBe(false);
    expect(Recorder.last.options).toEqual({ mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 500_000 });
    expect(Recorder.last.timeslice).toBe(5000);
    const [start] = events();
    expect(start).toMatchObject({ type: 'webcam.start', data: { segment: 1, mime: 'video/webm;codecs=vp9', audio: false, width: 640, height: 480, fps: 30 } });
    expect(start.data.t_start).toBeGreaterThan(1000);
  });

  it('hands every piece to the store in order and logs it; stop waits for the last one and releases the camera', async () => {
    const { webcam, camera, saved, events, Recorder } = setup();
    await webcam.start();
    Recorder.last.requestData();
    Recorder.last.requestData();
    await webcam.stop();
    expect(saved.map((chunk) => [chunk.segment, chunk.index, chunk.blob.size])).toEqual([[1, 0, 10], [1, 1, 10], [1, 2, 10]]);
    expect(events().map((e) => e.type)).toEqual(['webcam.start', 'webcam.chunk', 'webcam.chunk', 'webcam.chunk', 'webcam.stop']);
    expect(events().at(-1).data).toMatchObject({ segment: 1, reason: 'session_end', chunks: 3, bytes: 30 });
    expect(camera.stopped).toHaveLength(1);
    expect(webcam.summary()).toMatchObject({ enabled: true, segments: 1, chunks: 3, bytes: 30, mime: 'video/webm;codecs=vp9', video: { width: 640, height: 480, fps: 30 }, errors: 0 });
  });

  it('numbers the recording after the ones already in a resumed session', async () => {
    const { webcam, events } = setup({ firstSegment: 3 });
    await webcam.start();
    await webcam.stop();
    expect(events()[0].data.segment).toBe(3);
  });

  it('stop is harmless when nothing is recording', async () => {
    const { webcam, events } = setup();
    await webcam.stop();
    expect(events()).toEqual([]);
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['NotFoundError', 'no_camera'],
    ['OverconstrainedError', 'no_camera'],
  ])('a camera error %s is reported as %s, logged, and nothing records', async (name, code) => {
    const { webcam, events } = setup({ camera: fakeCamera({ error: name }) });
    const result = await webcam.start();
    expect(result).toMatchObject({ ok: false, code });
    expect(events().map((e) => [e.type, e.data.code])).toEqual([['webcam.error', code]]);
    expect(webcam.summary()).toMatchObject({ enabled: true, camera_denied: true, errors: 1 });
    expect(webcam.summary()).not.toHaveProperty('segments');
  });

  it('says so when the browser cannot record video at all', async () => {
    const { webcam } = setup({ supported: [] });
    expect(await webcam.start()).toMatchObject({ ok: false, code: 'unsupported' });
    const bare = createWebcam({ bus: createBus({ clock: { now: () => 0 } }), clock: { now: () => 0 }, saveChunk: async () => {}, mediaDevices: undefined, MediaRecorderClass: undefined });
    expect(await bare.start()).toMatchObject({ ok: false, code: 'unsupported' });
  });

  it('logs one storage_failed when saving fails, and keeps recording', async () => {
    const { webcam, events, Recorder } = setup({ saveChunk: async () => { throw new Error('disk full'); } });
    await webcam.start();
    Recorder.last.requestData();
    await webcam.stop();
    const failures = events().filter((e) => e.type === 'webcam.error');
    expect(failures).toHaveLength(1);
    expect(failures[0].data).toMatchObject({ code: 'storage_failed' });
    expect(events().at(-1).type).toBe('webcam.stop');
  });

  it('asks the recorder for its data when the page is going away', async () => {
    const { webcam, saved, Recorder } = setup();
    await webcam.start();
    webcam.flush();
    await webcam.stop();
    expect(saved).toHaveLength(2);
    expect(Recorder.last.state).toBe('inactive');
  });
});
