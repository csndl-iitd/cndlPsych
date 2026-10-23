import { describe, expect, it, vi } from 'vitest';

const screens = [];
let answers = [];
vi.mock('../../authoring/modules/survey.js', () => ({
  askAction: async (_screen, options) => {
    screens.push(options);
    return answers.shift();
  },
}));
const { connectSinks } = await import('./trigger-devices.js');

/** A sink set with the given sinks: {id, type, required, connectResults: [ok|error text, ...]}. */
function fakeSinkSet(specs) {
  const skipped = [];
  const sinks = new Map(specs.map((spec) => {
    const results = [...(spec.results ?? [])];
    return [spec.id, { required: spec.required !== false, connects: 0, connect: async function connect() { this.connects += 1; const next = results.shift(); return next === 'ok' || next === undefined ? { ok: true } : { ok: false, error: next }; } }];
  }));
  return { configs: specs.map(({ id, type = 'websocket' }) => ({ id, type })), sinks, skipped, skip: async (id) => { skipped.push(id); } };
}

const run = async (specs, answersGiven, options) => {
  screens.length = 0;
  answers = [...answersGiven];
  const sinkSet = fakeSinkSet(specs);
  const outcome = await connectSinks({}, sinkSet, options);
  return { outcome, sinkSet };
};

describe('connectSinks on a phone or tablet', () => {
  it('does not try a serial sink: it is left out with a warning, and nothing is asked', async () => {
    const { outcome, sinkSet } = await run([{ id: 'eeg', type: 'serial', results: ['no port'] }], [], { mobile: true });
    expect(outcome).toEqual({ ok: true, warnings: [{ id: 'eeg', error: 'Web Serial is not used on phones and tablets' }] });
    expect(sinkSet.skipped).toEqual(['eeg']);
    expect(sinkSet.sinks.get('eeg').connects).toBe(0);
    expect(screens).toEqual([]);
  });

  it('still tries the others (a websocket sink works on a phone), and serial on a computer', async () => {
    const { outcome, sinkSet } = await run([{ id: 'lab' }, { id: 'eeg', type: 'serial' }], ['connect'], { mobile: true });
    expect(outcome.ok).toBe(true);
    expect(sinkSet.sinks.get('lab').connects).toBe(1);
    expect(sinkSet.skipped).toEqual(['eeg']);
    const computer = await run([{ id: 'eeg', type: 'serial' }], ['connect'], { mobile: false });
    expect(computer.sinkSet.sinks.get('eeg').connects).toBe(1);
    expect(computer.sinkSet.skipped).toEqual([]);
  });
});

describe('a required device that cannot connect', () => {
  const choicesOf = (screen) => screen.choices.map((choice) => choice.value);

  it('offers an experimenter to continue without it, and then the session goes on with the sink left out', async () => {
    const { outcome, sinkSet } = await run([{ id: 'lab', results: ['refused'] }], ['skip'], { experimenter: true });
    expect(choicesOf(screens[0])).toEqual(['retry', 'skip', 'cancel']);
    expect(outcome).toMatchObject({ ok: true });
    expect(outcome.warnings[0]).toMatchObject({ id: 'lab' });
    expect(outcome.warnings[0].error).toContain('refused');
    expect(sinkSet.skipped).toEqual(['lab']);
  });

  it('does not offer it when no experimenter is present: retry or cancel, as before', async () => {
    const { outcome } = await run([{ id: 'lab', results: ['refused'] }], ['cancel'], { experimenter: false });
    expect(choicesOf(screens[0])).toEqual(['retry', 'cancel']);
    expect(outcome).toMatchObject({ ok: false, blocked: { id: 'lab' } });
  });

  it('lets an experimenter try again until it connects, and a device that needs a click can be skipped before trying', async () => {
    const retried = await run([{ id: 'lab', results: ['refused', 'ok'] }], ['retry'], { experimenter: true });
    expect(retried.outcome).toEqual({ ok: true, warnings: [] });
    expect(retried.sinkSet.skipped).toEqual([]);

    const skipFirst = await run([{ id: 'eeg', type: 'usb' }], ['skip'], { experimenter: true });
    expect(choicesOf(screens[0])).toEqual(['connect', 'skip']); // a required device, but an experimenter may leave it
    expect(skipFirst.sinkSet.sinks.get('eeg').connects).toBe(0);
    expect(skipFirst.sinkSet.skipped).toEqual(['eeg']);
  });

  it('a participant is not offered to leave out a required device before connecting either', async () => {
    await run([{ id: 'eeg', type: 'usb' }], ['connect'], { experimenter: false });
    expect(choicesOf(screens[0])).toEqual(['connect']);
  });
});
