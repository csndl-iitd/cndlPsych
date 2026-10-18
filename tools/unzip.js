// Test support: an independent zip reader (central directory walk, CRC check), so the zip
// writer is verified by code that shares nothing with it.
import { crc32 as nodeCrc32 } from 'node:zlib';

/** An independent zip reader: walks the central directory and checks every CRC. Returns the bytes of each file by name. */
export function unzipBytes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  if (view.getUint32(end, true) !== 0x06054b50) throw new Error('not a zip: no end-of-central-directory');
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error('bad central directory entry');
    const [method, crc, size, nameLength, extraLength, commentLength, localOffset] = [
      view.getUint16(cursor + 10, true), view.getUint32(cursor + 16, true), view.getUint32(cursor + 24, true),
      view.getUint16(cursor + 28, true), view.getUint16(cursor + 30, true), view.getUint16(cursor + 32, true), view.getUint32(cursor + 42, true),
    ];
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('bad local header');
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(dataStart, dataStart + size);
    if (method !== 0) throw new Error('only stored entries are supported');
    if (nodeCrc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    files[name] = data;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** The same, with every file read as UTF-8 text (for archives of text files). */
export function unzip(bytes) {
  return Object.fromEntries(Object.entries(unzipBytes(bytes)).map(([name, data]) => [name, new TextDecoder().decode(data)]));
}
