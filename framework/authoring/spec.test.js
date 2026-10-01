import { describe, expect, it } from 'vitest';
import { parseYaml } from './spec.js';

describe('parseYaml', () => {
  it('keeps `on:` as the string key "on" (YAML 1.2), never boolean true', () => {
    const parsed = parseYaml('match:\n  on: input.tap\n  off: yes\n');
    expect(Object.keys(parsed.match)).toEqual(['on', 'off']);
    expect(parsed.match.off).toBe('yes');
  });

  it('reads 16:9 as a string and supports merge keys', () => {
    expect(parseYaml('a: 16:9\nb: &x {c: 1}\nd:\n  <<: *x\n  e: 2\n')).toEqual({ a: '16:9', b: { c: 1 }, d: { c: 1, e: 2 } });
  });

  it('rejects duplicate keys', () => {
    expect(() => parseYaml('a: 1\na: 2\n')).toThrow(/duplicated mapping key/);
  });
});
