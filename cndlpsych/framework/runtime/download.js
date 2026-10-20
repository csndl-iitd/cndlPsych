// Hand a file to the browser's download. A programmatic click on a temporary link is the
// standard way; it is not an event listener.
import { schedule } from '../foundation/clock.js';
import { webcamFiles } from '../storage/export.js';

/** @param {{name: string, data: Uint8Array|string|Blob, type?: string}} file */
export function downloadFile(doc, { name, data, type = 'application/zip' }) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  doc.body.append(link);
  link.click();
  link.remove();
  schedule(10_000, () => URL.revokeObjectURL(url));
}

/**
 * Download the webcam video the browser kept for a session (when it was not written to a file on disk), one file per
 * recording, apart from the zip.
 * @param {{readMedia?: (key?: string) => Promise<object[]>}} store
 * @param {object} record session record
 * @param {string} [key] the stored session (the current one by default)
 */
export async function downloadWebcamVideo(doc, store, record, key) {
  for (const file of webcamFiles(record, (await store.readMedia?.(key)) ?? [])) downloadFile(doc, { name: file.name, data: file.blob, type: file.blob.type });
}
