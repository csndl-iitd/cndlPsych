import { describe, expect, it } from 'vitest';
import { canPickFile, openVideoSink, pickVideoFile } from './video-file.js';

/** A file handle whose writable stream appends to `file.parts`; nothing is final until close(). */
function fakeHandle(name = 'v.webm') {
  const file = { parts: [], closed: false, calls: [] };
  return {
    file,
    name,
    createWritable: async () => ({
      write: async (blob) => { file.calls.push('write'); file.parts.push(blob); },
      close: async () => { file.calls.push('close'); file.closed = true; },
    }),
  };
}

describe('canPickFile / pickVideoFile', () => {
  it('knows whether the browser has a save picker', () => {
    expect(canPickFile({})).toBe(false);
    expect(canPickFile({ showSaveFilePicker: () => {} })).toBe(true);
  });

  it('asks for a file of the right type and name', async () => {
    let asked;
    const handle = fakeHandle();
    const win = { showSaveFilePicker: async (options) => { asked = options; return handle; } };
    expect(await pickVideoFile({ suggestedName: 'sub-001_ses-01_webcam.webm', mime: 'video/webm;codecs=vp9', win })).toBe(handle);
    expect(asked).toEqual({ suggestedName: 'sub-001_ses-01_webcam.webm', types: [{ description: 'Video', accept: { 'video/webm': ['.webm'] } }] });
  });

  it('lets a cancelled picker reject', async () => {
    const win = { showSaveFilePicker: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); } };
    await expect(pickVideoFile({ suggestedName: 'v.webm', mime: 'video/webm', win })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('openVideoSink', () => {
  it('appends the pieces in order, counts the bytes, and finishes the file on close', async () => {
    const handle = fakeHandle('out.webm');
    const sink = await openVideoSink(handle);
    await sink.write(new Blob([new Uint8Array(3)]));
    await sink.write(new Blob([new Uint8Array(4)]));
    expect(sink.name).toBe('out.webm');
    expect(sink.bytes).toBe(7);
    expect(handle.file.closed).toBe(false);
    await sink.close();
    await sink.close();
    expect(handle.file.calls).toEqual(['write', 'write', 'close']);
  });
});
