import { describe, expect, it, vi } from 'vitest';

let asked;
vi.mock('../../authoring/modules/survey.js', () => ({ askAction: async (_screen, options) => { asked = options; return 'continue'; } }));
const { askWhenUnavailable, experimenterPresent } = await import('./continue-without.js');

describe('experimenterPresent', () => {
  it('is true for everything except an experiment that participants open by a public Firebase link', () => {
    expect(experimenterPresent({})).toBe(true);
    expect(experimenterPresent({ storage: { local: { enabled: true } } })).toBe(true);
    expect(experimenterPresent({ storage: { firebase: { enabled: true, access: 'controlled' } } })).toBe(true);
    expect(experimenterPresent({ storage: { firebase: { enabled: false, access: 'public' } } })).toBe(true);
    expect(experimenterPresent({ storage: { firebase: { enabled: true, access: 'public' } } })).toBe(false);
  });
});

describe('askWhenUnavailable', () => {
  it('says what could not be used and why, and offers to try again, go on without it, or stop', async () => {
    expect(await askWhenUnavailable({}, { feature: 'the camera recording', why: 'The camera was not allowed.' })).toBe('continue');
    expect(asked.message).toContain('## The camera recording could not be used');
    expect(asked.message).toContain('The camera was not allowed.');
    expect(asked.choices).toEqual([
      { value: 'retry', text: 'Try again' },
      { value: 'continue', text: 'Continue without the camera recording' },
      { value: 'stop', text: 'Stop the session' },
    ]);
  });

  it('leaves out "try again" when that cannot help', async () => {
    await askWhenUnavailable({}, { feature: 'eye tracking', why: 'The add-on is not installed.', retry: false });
    expect(asked.choices.map((choice) => choice.value)).toEqual(['continue', 'stop']);
  });
});
