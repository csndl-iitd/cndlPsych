import { describe, expect, it } from 'vitest';
import { formatMessage, formatValue, rawBytes, renderTemplate, sinkProblems, templateFields } from './format.js';

describe('formatValue', () => {
  it.each([
    [10, '02x', '0a'], [10, 'x', 'a'], [255, 'X', 'FF'], [255, '04x', '00ff'], [7, '3d', '  7'], [7, '03d', '007'],
    [3.14159, '.3f', '3.142'], [2, 'f', '2.000000'], ['ab', '', 'ab'], ['ab', '4s', 'ab  '], [true, '', 'true'], [12, '', '12'],
    [undefined, '02x', ''], [null, 'd', ''], [7.9, 'd', '7'],
  ])('%j with %j -> %j', (value, spec, expected) => {
    expect(formatValue(value, spec)).toBe(expected);
  });

  it('rejects bad specs and hex of non-integers', () => {
    expect(() => formatValue(1, 'zz')).toThrow(TypeError);
    expect(() => formatValue(1.5, 'x')).toThrow(RangeError);
    expect(() => formatValue(-1, 'x')).toThrow(RangeError);
  });
});

describe('renderTemplate', () => {
  it('substitutes fields with optional specs and leaves other text alone', () => {
    expect(renderTemplate('T{value:02x}|{event}|{rt_ms:.1f}', { value: 10, event: 'phase.onset', rt_ms: 312.456 })).toBe('T0a|phase.onset|312.5');
    expect(renderTemplate('{trial}/{missing}', { trial: 3 })).toBe('3/');
    expect(renderTemplate('{{literal}}', {})).toBe('{}');
  });

  it('lists the fields it uses', () => {
    expect(templateFields('{value:02x} {event} {value}')).toEqual(['value', 'event', 'value']);
  });
});

describe('rawBytes', () => {
  it.each([
    [undefined, 21, [21]],
    [undefined, 0, [0]],
    [undefined, 255, [255]],
    ['{value:02x}', 10, [10]],
    ['{value:x}', 10, [10]],
    ['{value:X}', 171, [171]],
    ['AA {value:02x} 55', 10, [0xaa, 10, 0x55]],
    ['  01  {value:02x}  ', 255, [1, 255]],
    ['ff', 3, [255]],
  ])('template %j value %d -> %j', (template, value, expected) => {
    expect([...rawBytes({ format: 'raw', template }, value)]).toEqual(expected);
  });

  it('rejects values that do not fit a byte', () => {
    for (const value of [256, -1, 1.5, '3', null]) expect(() => rawBytes({ format: 'raw' }, value)).toThrow(RangeError);
  });
});

describe('sinkProblems', () => {
  it.each([
    [{ format: 'raw' }, 0],
    [{ format: 'raw', template: '{value:02x}' }, 0],
    [{ format: 'raw', template: 'AA {value:02x} 55' }, 0],
    [{ format: 'raw', template: '{value}' }, 1],
    [{ format: 'raw', template: 'AA {value:02x} GG' }, 1],
    [{ format: 'raw', template: '{value:d}' }, 1],
    [{ format: 'template', template: '{value:02x},{event}' }, 0],
    [{ format: 'template', template: '{nope}' }, 1],
    [{ format: 'template', template: '{value:zz}' }, 1],
    [{ format: 'ndjson' }, 0],
  ])('%j -> %d problem(s)', (sink, count) => {
    expect(sinkProblems(sink)).toHaveLength(count);
  });
});

describe('formatMessage', () => {
  const fields = { seq: 12, value: 31, event: 'phase.onset', rule: 'search_onset', t_event: 100.5, t_sent: 101.25, trial: 3, stimulus: 'search_array' };

  it('raw: bytes', () => {
    expect([...formatMessage({ format: 'raw', template: '{value:02x}' }, fields)]).toEqual([31]);
  });

  it('ndjson: the selected fields in order, one line, newline per setting', () => {
    const sink = { format: 'ndjson', fields: ['seq', 'value', 'stimulus', 'correct'] };
    expect(formatMessage(sink, fields)).toBe('{"seq":12,"value":31,"stimulus":"search_array"}\n');
    expect(formatMessage({ ...sink, newline: 'crlf' }, fields)).toMatch(/\r\n$/);
    expect(formatMessage({ ...sink, newline: 'none' }, fields)).toBe('{"seq":12,"value":31,"stimulus":"search_array"}');
  });

  it('ndjson: a default field set when none is selected', () => {
    expect(JSON.parse(formatMessage({ format: 'ndjson' }, fields))).toEqual({ seq: 12, value: 31, event: 'phase.onset', t_event: 100.5, t_sent: 101.25 });
  });

  it('template: substituted text plus newline', () => {
    expect(formatMessage({ format: 'template', template: 'T{value:02x}' }, fields)).toBe('T1f\n');
    expect(formatMessage({ format: 'template', template: 'T{value:02x}', newline: 'none' }, fields)).toBe('T1f');
  });

  it('rejects an unknown format', () => {
    expect(() => formatMessage({ format: 'xml' }, fields)).toThrow(TypeError);
  });
});
