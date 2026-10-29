import { expect, test } from '@playwright/test';
import { sessionProblems } from '../../tools/validators.js';
import { answerPostTask, continueDeviceScreen, finished, installAutopilot, passEntryScreens, recorded, startSession } from '../../tools/e2e/session-helpers.js';
import { installFakeSerial, installFakeUsb, serialWrites, sinksMerge, startTestRelay } from '../../tools/e2e/trigger-helpers.js';

test.setTimeout(180_000);

const FAST = { debug: { enabled: true, time_scale: 0.2 } };
const ofType = (events, type) => events.filter((e) => e.type === type);
const stopped = [];
test.afterEach(async () => { await Promise.all(stopped.splice(0).map((relay) => relay.close())); });

async function withRelay(testInfo, options) {
  const started = await startTestRelay(testInfo, options);
  stopped.push(started.relay);
  return started;
}

// What the example's trigger rules send, by value (spec/examples).
const EXPECTED_COUNTS = {
  9: 2, // flash and oddball instruction pages (search_instructions has no trigger)
  11: 10, 10: 10, // flash_black / flash_white, 10 trials
  1: 5, // fixation_plus in the 5 oddball trials
  21: 5, // resp_correct: the second oddball_Ǝ of each trial
  30: 10, 31: 10, 32: 10, 33: 10, // visual search: fixation, onset, next, offset x 10 trials
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [100 + i, 10])), // oddball letters, 2 per trial x 5 trials
};

test('the example sends its triggers to a serial device and, through the relay, to a second sink', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Web Serial exists only on desktop Chromium; phones use a websocket sink (covered below)');
  const { pair, port } = await withRelay(testInfo);
  await installFakeSerial(page);
  await startSession(page, { merge: { ...FAST, ...sinksMerge(port) } });
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page, { connect: true });
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');
  const { events, record } = await recorded(page);

  // Every trigger the rules produced was sent to both sinks, with the cause time and hand-off time.
  const sent = ofType(events, 'trigger.sent');
  expect(ofType(events, 'trigger.dropped')).toEqual([]);
  const bySink = (id) => sent.filter((e) => e.data.sink === id);
  const values = (list) => list.map((e) => e.data.value);
  expect(values(bySink('eeg_serial'))).toEqual(values(bySink('lab_ws')));
  const counts = {};
  for (const value of values(bySink('eeg_serial'))) counts[value] = (counts[value] ?? 0) + 1;
  expect(counts).toEqual(EXPECTED_COUNTS);
  expect(sent.every((e) => e.data.t_sent >= e.data.t_event && e.caused_by === e.data.event_seq)).toBe(true);
  expect(values(bySink('eeg_serial'))[0]).toBe(9);

  // Bytes: the serial device got each value followed by the reset byte; the relay forwarded the same values.
  const written = await serialWrites(page);
  const sentValues = values(bySink('eeg_serial'));
  expect(written.filter((bytes) => bytes[0] !== 0).map((bytes) => bytes[0])).toEqual(sentValues);
  expect(written.every((bytes) => bytes.length === 1)).toBe(true);
  expect(written.filter((bytes) => bytes[0] === 0).length).toBeGreaterThan(100);
  await expect.poll(() => pair.b.received.length).toBe(sentValues.length);
  expect(pair.b.received).toEqual(sentValues);

  // Both sinks connected before recording; the log has their status and the ack round trips.
  const statuses = ofType(events, 'sink.status').map((e) => [e.data.sink, e.data.state]);
  expect(statuses.slice(0, 4)).toEqual([['eeg_serial', 'connecting'], ['eeg_serial', 'connected'], ['lab_ws', 'connecting'], ['lab_ws', 'connected']]);
  expect(events[0].type).toBe('session.start');
  expect(ofType(events, 'sink.sync').length).toBeGreaterThan(50);
  expect(ofType(events, 'sink.sync').every((e) => e.data.offset_ms === null && e.data.rtt_ms >= 0)).toBe(true);

  expect(record.sinks.trigger).toEqual([
    { id: 'eeg_serial', type: 'serial', format: 'raw', required: true, connected: true, transport: 'serial' },
    { id: 'lab_ws', type: 'websocket', format: 'ndjson', required: false, connected: true },
  ]);
  expect(sessionProblems(record)).toEqual([]);
  expect(await page.evaluate(() => window.__serial.opened)).toEqual({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
});

test('on a phone the same triggers go through a websocket sink and the relay', async ({ page, isMobile }, testInfo) => {
  test.skip(!isMobile, 'covers the touch devices; desktop is covered above');
  const { pair, port } = await withRelay(testInfo);
  const sink = sinksMerge(port).triggers.sinks[1];
  await startSession(page, { merge: { ...FAST, triggers: { sinks: [{ ...sink, required: true }] }, device: { allowed: ['phone', 'tablet'] } } });
  await installAutopilot(page, { touch: true });
  await passEntryScreens(page);
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');
  const { events } = await recorded(page);
  const sentValues = ofType(events, 'trigger.sent').map((e) => e.data.value);
  expect(sentValues.length).toBe(Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0));
  await expect.poll(() => pair.b.received.length).toBe(sentValues.length);
  expect(pair.b.received).toEqual(sentValues);
});

test('on a phone a serial sink talks to the device over WebUSB, and the raw traffic is kept with times', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Android Chrome has WebUSB and no Web Serial; the desktop uses Web Serial');
  await installFakeUsb(page);
  const sink = { id: 'rx', type: 'serial', format: 'raw', template: '{value:02x}', required: true, capture: { raw: true } };
  await startSession(page, { merge: { ...FAST, triggers: { sinks: [sink] }, device: { allowed: ['phone', 'tablet'] } } });
  await installAutopilot(page, { touch: true });
  await passEntryScreens(page, { connect: true });
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');
  const { events, record } = await recorded(page);

  const sent = ofType(events, 'trigger.sent').map((e) => e.data.value);
  expect(sent.length).toBeGreaterThan(50);
  expect((await page.evaluate(() => window.__usb.writes)).map((bytes) => bytes[0])).toEqual(expect.arrayContaining(sent.slice(0, 3)));
  expect(await page.evaluate(() => window.__usb.control)).toEqual([0x20, 0x22]); // line coding, then DTR and RTS

  const pieces = await page.evaluate(async () => (await window.sessionStore.readStreams()).map((piece) => ({ segment: piece.segment, chunks: piece.chunks, data: [...piece.data] })));
  const chunks = pieces.flatMap((piece) => piece.chunks);
  const text = (dir) => new TextDecoder().decode(Uint8Array.from(pieces.flatMap((piece) => { let at = 0; return piece.chunks.flatMap((chunk) => { const part = chunk.dir === dir ? piece.data.slice(at, at + chunk.n) : []; at += chunk.n; return part; }); })));
  expect(pieces.every((piece) => piece.segment === 1)).toBe(true);
  expect(text('rx')).toMatch(/^[0-9A-F]{4}7FF\n/); // the device's lines, as they came
  expect(text('rx')).toContain('ECHO ');
  expect(chunks.filter((chunk) => chunk.dir === 'tx').length).toBe(await page.evaluate(() => window.__usb.writes.length)); // every write, the reset bytes too
  expect(chunks.every((chunk, i) => i === 0 || chunk.t >= chunks[i - 1].t - 50)).toBe(true); // in capture order; a write is stamped when it begins, so it can trail a read that arrived while it was in progress
  expect(record.sinks.trigger[0]).toMatchObject({ id: 'rx', transport: 'webusb', connected: true });
  expect(record.sinks.trigger[0].capture.rx_bytes).toBeGreaterThan(100);
  expect(sessionProblems(record)).toEqual([]);
});

test('a required sink that cannot connect blocks the session; cancelling leaves no trace', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Web Serial is desktop only');
  const { port } = await withRelay(testInfo);
  await installFakeSerial(page, { rejectPicks: 1 });
  await startSession(page, { merge: { ...FAST, ...sinksMerge(port) } });
  await passEntryScreens(page, { connect: true });
  await expect(page.getByText('Could not connect')).toBeVisible();
  await expect(page.getByText('No port selected by the user.')).toBeVisible();
  await continueDeviceScreen(page, 'cancel');
  expect(await finished(page)).toBe('sink_failed');
  const { events, record } = await recorded(page);
  expect(events).toEqual([]);
  expect(record).toBeNull();
  expect(await page.evaluate(() => window.sessionServices.bus.lastSeq)).toBe(-1);
  await expect(page.getByText('cannot start. Nothing has been stored')).toBeVisible();
});

test('a required sink can be retried after a failed connection', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Web Serial is desktop only');
  const { port } = await withRelay(testInfo);
  await installFakeSerial(page, { rejectPicks: 1 });
  await startSession(page, { merge: { ...FAST, ...sinksMerge(port) } });
  await passEntryScreens(page, { connect: true });
  await continueDeviceScreen(page, 'retry');
  await expect.poll(async () => (await recorded(page)).events.length).toBeGreaterThan(3);
  const { events, record } = await recorded(page);
  expect(ofType(events, 'sink.status').filter((e) => e.data.sink === 'eeg_serial').map((e) => e.data.state)).toEqual(['connecting', 'error', 'connecting', 'connected']);
  expect(record.sinks.trigger[0]).toMatchObject({ id: 'eeg_serial', connected: true });
});

test('an optional sink that cannot connect is a warning, and the session goes on', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'uses the serial sink as the required one');
  await installFakeSerial(page);
  // No relay is running: lab_ws (required: false) cannot connect.
  await startSession(page, { merge: { ...FAST, ...sinksMerge(testInfo.parallelIndex + 19_900) } });
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page, { connect: true });
  await page.locator('[data-name="difficulty"]').waitFor({ timeout: 120_000 });
  await answerPostTask(page);
  expect(await finished(page)).toBe('complete');
  const { events, record } = await recorded(page);

  const lab = ofType(events, 'sink.status').filter((e) => e.data.sink === 'lab_ws');
  expect(lab.map((e) => e.data.state)).toEqual(['connecting', 'error']);
  expect(lab[1].data.detail).toContain('could not connect');
  const warning = ofType(events, 'system.warning').find((e) => e.data.code === 'sink_unavailable');
  expect(warning.data.detail).toEqual({ sink: 'lab_ws' });
  expect(record.sinks.trigger.map((s) => [s.id, s.connected])).toEqual([['eeg_serial', true], ['lab_ws', false]]);
  // Its triggers are dropped as disconnected; the serial sink got everything.
  expect(new Set(ofType(events, 'trigger.dropped').map((e) => [e.data.sink, e.data.reason].join(':')))).toEqual(new Set(['lab_ws:disconnected']));
  expect(ofType(events, 'trigger.sent').every((e) => e.data.sink === 'eeg_serial')).toBe(true);
  expect(ofType(events, 'trigger.sent')).toHaveLength(Object.values(EXPECTED_COUNTS).reduce((a, b) => a + b, 0));
});

test('losing a required sink during the session stops it with an error', async ({ page, isMobile }, testInfo) => {
  test.skip(isMobile, 'Web Serial is desktop only');
  const { port } = await withRelay(testInfo);
  await installFakeSerial(page, { failAfter: 12 });
  await startSession(page, { merge: { ...FAST, ...sinksMerge(port) } });
  await installAutopilot(page, { touch: false });
  await passEntryScreens(page, { connect: true });
  expect(await finished(page)).toBe('error');
  const { events, record } = await recorded(page);
  expect(ofType(events, 'sink.status').some((e) => e.data.sink === 'eeg_serial' && e.data.state === 'disconnected')).toBe(true);
  expect(ofType(events, 'system.error').at(-1).data).toMatchObject({ code: 'exception', fatal: true });
  expect(ofType(events, 'system.error').at(-1).data.message).toContain('eeg_serial');
  expect(events.at(-1)).toMatchObject({ type: 'session.end', data: { reason: 'error' } });
  expect(record).toMatchObject({ status: 'error', end_reason: 'error' });
  expect(sessionProblems(record)).toEqual([]);
});

test('without any sink the session needs no device screen', async ({ page }) => {
  await startSession(page, { merge: { ...FAST, triggers: { sinks: [] } } });
  await passEntryScreens(page);
  await expect.poll(async () => (await recorded(page)).events.length).toBeGreaterThan(3);
  const { record } = await recorded(page);
  expect(record.sinks).toEqual({ storage: ['local'] });
});
