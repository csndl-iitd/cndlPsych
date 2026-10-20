// Universal triggers (physical events, values 1-10, photodiode included) and semantic triggers (the intent
// handed to the response window, values from 11) reach a sink without any rules written, in a real browser
// with a synthetic participant (the dry run, with a recording websocket as the sink).
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { dryRun } from './dry-run.js';
import { initProject } from './init.js';

test.setTimeout(180_000);

let dir;
test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'the dry run emulates the devices itself; run once');
  dir = join(mkdtempSync(join(tmpdir(), 'cndlpsych-universal-')), 'study');
  initProject(dir);
  appendFileSync(join(dir, 'experiment.yaml'), `
triggers:
  sinks:
    - { id: lab_ws, type: websocket, url: "ws://localhost:8765", format: ndjson, fields: [seq, value, event, t_event, t_sent], ack: true, required: false }
overlay:
  photodiode: { enabled: true, corner: bl, size: 40px }
`);
});
test.afterEach(() => { if (dir) rmSync(join(dir, '..'), { recursive: true, force: true }); });

/** value -> the event types it was sent for */
const sentFor = (events) => {
  const byValue = new Map();
  const bySeq = new Map(events.map((event) => [event.seq, event]));
  for (const trigger of events.filter((event) => event.type === 'trigger.sent')) {
    const type = bySeq.get(trigger.data.event_seq)?.type;
    byValue.set(trigger.data.value, new Set([...(byValue.get(trigger.data.value) ?? []), type]));
  }
  return byValue;
};

test('a computer: key presses and releases, the photodiode and the intent each have a trigger of their own', async () => {
  const result = await dryRun({ dir, profile: 'desktop', scale: 0.1, timeoutS: 150 });
  expect(result.status, result.stuck).toBe('complete');
  const sent = sentFor(result.events);
  expect([...sent.get(1)]).toEqual(['input.key.down']);
  expect([...sent.get(7)]).toEqual(['input.key.up']);
  expect([...sent.get(9)]).toEqual(['overlay.photodiode']);
  expect([...sent.get(10)]).toEqual(['overlay.photodiode']);
  expect([...sent.get(11)]).toEqual(['bridge.key_injected']); // semantic: go, handed to the response window
  const values = [...sent.keys()];
  expect(values.filter((value) => value >= 1 && value <= 10).every((value) => [1, 7, 9, 10].includes(value))).toBe(true); // no pointer or gesture on a keyboard run
  expect(result.events.filter((e) => e.type === 'system.error')).toEqual([]);
});

test('a phone: touch presses, taps and releases have universal triggers, and the intent the same semantic one', async () => {
  const result = await dryRun({ dir, profile: 'phone', scale: 0.1, timeoutS: 150 });
  expect(result.status, result.stuck).toBe('complete');
  const sent = sentFor(result.events);
  expect([...sent.get(2)]).toEqual(['input.pointer.down']);
  expect([...sent.get(3)]).toEqual(['input.tap']);
  expect([...sent.get(8)]).toEqual(['input.pointer.up']);
  expect([...sent.get(11)]).toEqual(['bridge.key_injected']);
});
