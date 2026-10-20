// The webcam video written straight to a file on disk, through the File System Access API
// (Chrome and Edge on a computer). The participant or experimenter picks the file once, at the start,
// and the recorder's pieces are appended to it as they arrive: no copy is kept in the browser and the
// export does not carry the video. Pieces of a WebM recording, joined in order, are one playable file.
//
// The browser writes into a temporary file and puts it in place of the chosen file only when the stream
// is closed at the end of the recording. A page that is closed, reloaded or crashes before that leaves
// the chosen file empty: in a test (the page's private file system) a reload mid-recording left a file
// of 0 bytes. Whether Chrome's temporary file on a real disk can be recovered was not tried. A session
// that must survive an interruption should use `save: browser`, which keeps the pieces as they arrive.

/** Can this browser save to a file the user picks? */
export const canPickFile = (win = globalThis) => typeof win.showSaveFilePicker === 'function';

/**
 * Ask where to save. Must run inside a click (the picker needs a user gesture).
 * @param {{suggestedName: string, mime: string, win?: object}} options
 * @returns {Promise<FileSystemFileHandle>} rejects with an AbortError when the picker is cancelled
 */
export function pickVideoFile({ suggestedName, mime, win = globalThis }) {
  const type = String(mime).split(';')[0];
  const extension = suggestedName.slice(suggestedName.lastIndexOf('.'));
  return win.showSaveFilePicker({ suggestedName, types: [{ description: 'Video', accept: { [type]: [extension] } }] });
}

/**
 * Open the file for appending.
 * @param {FileSystemFileHandle} handle
 * @returns {Promise<{name: string, bytes: number, write: (blob: Blob) => Promise<void>, close: () => Promise<void>}>}
 */
export async function openVideoSink(handle) {
  const writable = await handle.createWritable();
  let bytes = 0;
  let closed = false;
  return {
    name: handle.name,
    get bytes() { return bytes; },
    async write(blob) {
      await writable.write(blob);
      bytes += blob.size;
    },
    /** Finish the file. Harmless when called twice. */
    async close() {
      if (closed) return;
      closed = true;
      await writable.close();
    },
  };
}
