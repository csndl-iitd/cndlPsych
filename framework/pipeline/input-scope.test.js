import { describe, expect, it } from 'vitest';
import { mergeScopes } from './input-scope.js';

const desktop = {
  intents: { go: { bindings: [{ key: ' ' }], hint: 'Press SPACE' } },
  rules: [{ id: 'space_done', match: { on: 'input.key.down', where: { key: ' ' } }, emit: { intent: 'next' } }],
  gestures: [],
  fire_on: 'up',
  show_zones: false,
  cursor: { autohide_ms: 1000 },
};
const tablet = {
  intents: { go: { bindings: [{ tap: true }], hint: 'Tap the screen' } },
  rules: [{ id: 'two_taps', match: { on: 'input.tap' }, emit: { intent: 'next' } }],
  gestures: ['tap'],
  fire_on: 'down',
  show_zones: true,
  cursor: { autohide_ms: 50 },
  hit_padding: '12mm',
};

describe('mergeScopes', () => {
  it('returns the primary scope itself when there is nothing to add', () => {
    expect(mergeScopes(desktop)).toBe(desktop);
    expect(mergeScopes(desktop, [])).toBe(desktop);
    expect(mergeScopes(desktop, [undefined])).toBe(desktop);
  });

  it('lets an intent be answered by the keys and the taps of both profiles, with a hint that names both', () => {
    const merged = mergeScopes(desktop, [tablet]);
    expect(merged.intents.go.bindings).toEqual([{ key: ' ' }, { tap: true }]);
    expect(merged.intents.go.hint).toBe('Press SPACE or tap the screen');
  });

  it('adds the rules and the gestures, and takes everything else from the device\'s own profile', () => {
    const merged = mergeScopes(desktop, [tablet]);
    expect(merged.rules.map((rule) => rule.id)).toEqual(['space_done', 'two_taps']);
    expect(merged.gestures).toEqual(['tap']);
    expect(merged).toMatchObject({ fire_on: 'up', show_zones: false, cursor: { autohide_ms: 1000 }, hit_padding: '12mm' });
  });

  it('does not repeat identical bindings, hints or rules from three profiles', () => {
    const phone = { ...tablet, hit_padding: '14mm' };
    const merged = mergeScopes(tablet, [phone, desktop]);
    expect(merged.intents.go.bindings).toEqual([{ tap: true }, { key: ' ' }]);
    expect(merged.intents.go.hint).toBe('Tap the screen or press SPACE');
    expect(merged.rules.map((rule) => rule.id)).toEqual(['two_taps', 'space_done']);
    expect(merged.hit_padding).toBe('14mm'); // the more generous tap target
  });

  it('adds intents that only another profile defines, and leaves the inputs untouched', () => {
    const other = { intents: { skip: { bindings: [{ key: 'Escape' }] } }, rules: [], gestures: [] };
    const merged = mergeScopes(desktop, [other]);
    expect(Object.keys(merged.intents)).toEqual(['go', 'skip']);
    expect(desktop.intents.go.bindings).toEqual([{ key: ' ' }]);
  });
});
