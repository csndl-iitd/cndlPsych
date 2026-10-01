// Hand a file to the browser's download. A programmatic click on a temporary link is the
// standard way; it is not an event listener.
import { schedule } from '../foundation/clock.js';

/** @param {{name: string, data: Uint8Array|string, type?: string}} file */
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
