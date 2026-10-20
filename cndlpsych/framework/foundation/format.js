// How a trigger becomes bytes or text (ARCHITECTURE.md section 7). Pure: used by the
// compiler (to reject bad templates) and by the sinks at run time.
//
//  raw       bytes. Without a template: one byte, the value. With a template: space-separated
//            hex bytes, where {value:02x} stands for the value, e.g. "AA {value:02x} 55".
//  ndjson    one JSON object per line with the selected fields.
//  template  text with {field} / {field:spec} substitution, interpreted by the receiver.
//
// No chip-specific logic lives here: the framework only pushes bytes or strings.

export const TRIGGER_FIELDS = [
  'seq', 'value', 'event', 'rule', 't_event', 't_sent', 'time_origin_ms', 'session_id',
  'block', 'trial', 'phase', 'stimulus', 'correct', 'rt_ms', 'profile',
];
export const DEFAULT_NDJSON_FIELDS = ['seq', 'value', 'event', 't_event', 't_sent'];
export const NEWLINES = { lf: '\n', crlf: '\r\n', none: '' };

const PLACEHOLDER = /\{([a-z_]+)(?::([^}]*))?\}/g;
const SPEC = /^(0)?(\d+)?(?:\.(\d+))?([xXdfs])?$/;
const RAW_VALUE_TOKEN = /^\{value:0?[12]?[xX]\}$/;
const HEX_BYTE = /^[0-9a-fA-F]{1,2}$/;

function pad(text, width, zero, numeric) {
  if (width === undefined || text.length >= width) return text;
  if (zero && numeric) return text.padStart(width, '0');
  return numeric ? text.padStart(width, ' ') : text.padEnd(width, ' ');
}

/** Format one value with a mini format spec: [0][width][.precision][x|X|d|f|s], e.g. 02x, 5d, .3f. */
export function formatValue(value, spec = '') {
  if (value === undefined || value === null) return '';
  const match = SPEC.exec(spec);
  if (!match) throw new TypeError(`invalid format spec "${spec}"`);
  const [, zero, width, precision, type] = match;
  const w = width === undefined ? undefined : Number(width);
  const numeric = typeof value === 'number';
  let text;
  if (type === 'x' || type === 'X') {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`"${spec}" needs a non-negative integer, got ${value}`);
    text = value.toString(16);
    if (type === 'X') text = text.toUpperCase();
  } else if (type === 'd') {
    text = String(Math.trunc(Number(value)));
  } else if (type === 'f') {
    text = Number(value).toFixed(precision === undefined ? 6 : Number(precision));
  } else {
    text = String(value);
  }
  return pad(text, w, Boolean(zero), numeric || type === 'x' || type === 'X' || type === 'd' || type === 'f');
}

/** Replace {field} / {field:spec} with the formatted field values (missing fields become empty). */
export function renderTemplate(template, fields) {
  return template.replace(PLACEHOLDER, (_match, name, spec) => formatValue(fields[name], spec ?? ''));
}

/** Field names used by a template. */
export const templateFields = (template) => [...template.matchAll(PLACEHOLDER)].map((match) => match[1]);

/**
 * Problems with a sink's format configuration (empty when fine).
 * @param {{format: string, template?: string, fields?: string[]}} sink
 */
export function sinkProblems(sink) {
  const problems = [];
  if (sink.format === 'raw' && sink.template !== undefined) {
    for (const token of sink.template.trim().split(/\s+/)) {
      if (!RAW_VALUE_TOKEN.test(token) && !HEX_BYTE.test(token)) {
        problems.push(`raw template token "${token}" is not a hex byte or {value:02x}`);
      }
    }
  }
  if (sink.format === 'template' && sink.template !== undefined) {
    for (const name of templateFields(sink.template)) {
      if (!TRIGGER_FIELDS.includes(name)) problems.push(`template field "{${name}}" is not one of: ${TRIGGER_FIELDS.join(', ')}`);
    }
    for (const [, , spec] of sink.template.matchAll(PLACEHOLDER)) {
      if (spec !== undefined && !SPEC.test(spec)) problems.push(`template format spec ":${spec}" is not valid`);
    }
  }
  return problems;
}

/** The bytes a raw sink writes for a value. */
export function rawBytes(sink, value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError(`trigger value ${value} does not fit a byte (0-255)`);
  if (sink.template === undefined) return Uint8Array.of(value);
  const rendered = renderTemplate(sink.template, { value }).trim().split(/\s+/);
  return Uint8Array.from(rendered.map((token) => {
    if (!HEX_BYTE.test(token)) throw new RangeError(`"${token}" does not fit a byte`);
    return Number.parseInt(token, 16);
  }));
}

/**
 * The message for a sink: bytes for `raw`, a string (with the sink's newline) otherwise.
 * @returns {Uint8Array|string}
 */
export function formatMessage(sink, fields) {
  if (sink.format === 'raw') return rawBytes(sink, fields.value);
  const newline = NEWLINES[sink.newline ?? 'lf'];
  if (sink.format === 'ndjson') {
    const selected = sink.fields ?? DEFAULT_NDJSON_FIELDS;
    return `${JSON.stringify(Object.fromEntries(selected.filter((name) => fields[name] !== undefined).map((name) => [name, fields[name]])))}${newline}`;
  }
  if (sink.format === 'template') return `${renderTemplate(sink.template, fields)}${newline}`;
  throw new TypeError(`unknown sink format "${sink.format}"`);
}
