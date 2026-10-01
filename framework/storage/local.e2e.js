import { expect, test } from '@playwright/test';

// The local store against real IndexedDB, driven from inside the page (no session running).
async function openPage(page) {
  await page.goto('/tools/e2e/session.html');
  await page.waitForFunction(() => window.sessionReady === true);
}

const record = (n = 1) => ({ subject_id: `sub-00${n}`, session_id: 'ses-01', started_at: `2026-10-01T10:00:0${n}.000Z` });
const event = (seq) => ({ v: 1, seq, t: seq * 10, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
const dbName = (testInfo) => `expfw-test-${testInfo.parallelIndex}-${testInfo.testId}`;

test('round trip, finish and what findUnfinished reports', async ({ page }, testInfo) => {
  await openPage(page);
  const result = await page.evaluate(async ({ name, rec }) => {
    const mk = (seq) => ({ v: 1, seq, t: seq * 10, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
    const store = window.expfwStorage.createLocalStore({ dbName: name, flushMs: 100 });
    const statuses = [];
    store.onStatus((s) => statuses.push(s.state));
    store.begin(rec);
    for (let seq = 0; seq < 5; seq += 1) store.append(mk(seq));
    const snapshot = await store.snapshot();
    const unfinishedBefore = await store.findUnfinished();
    await store.finish({ ...rec, status: 'complete' });
    const fresh = window.expfwStorage.createLocalStore({ dbName: name });
    return {
      statuses, events: snapshot.events, unfinishedBefore,
      unfinishedAfter: await fresh.findUnfinished(), read: await fresh.read(unfinishedBefore[0].key),
    };
  }, { name: dbName(testInfo), rec: record() });

  expect(result.statuses).toEqual(['opening', 'ready', 'closed']);
  expect(result.events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  expect(result.events[3]).toEqual(event(3));
  expect(result.unfinishedBefore).toHaveLength(1);
  expect(result.unfinishedBefore[0]).toMatchObject({ key: 'sub-001_ses-01_2026-10-01T10:00:01.000Z', lastSeq: 4 });
  expect(result.unfinishedAfter).toEqual([]);
  expect(result.read.record.status).toBe('complete');
  expect(result.read.events).toHaveLength(5);
});

test('a timer flush writes without anyone asking; before it, nothing is on disk', async ({ page }, testInfo) => {
  await openPage(page);
  const result = await page.evaluate(async ({ name, rec }) => {
    const mk = (seq) => ({ v: 1, seq, t: seq, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const writer = window.expfwStorage.createLocalStore({ dbName: name, flushMs: 400 });
    const reader = window.expfwStorage.createLocalStore({ dbName: name });
    writer.begin(rec);
    await wait(100);
    const key = (await reader.findUnfinished())[0].key;
    for (let seq = 0; seq < 6; seq += 1) writer.append(mk(seq));
    const early = (await reader.read(key)).events.length;
    await wait(700);
    const late = (await reader.read(key)).events.length;
    return { early, late, lastSeq: (await reader.findUnfinished())[0].lastSeq };
  }, { name: dbName(testInfo), rec: record() });
  expect(result).toEqual({ early: 0, late: 6, lastSeq: 5 });
});

test('what is on disk is always a gap-free prefix, even across many flushes', async ({ page }, testInfo) => {
  await openPage(page);
  const result = await page.evaluate(async ({ name, rec }) => {
    const mk = (seq) => ({ v: 1, seq, t: seq, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
    const writer = window.expfwStorage.createLocalStore({ dbName: name, flushMs: 5 });
    const reader = window.expfwStorage.createLocalStore({ dbName: name });
    writer.begin(rec);
    const checks = [];
    for (let seq = 0; seq < 700; seq += 1) {
      writer.append(mk(seq));
      if (seq % 70 === 0) await new Promise((resolve) => setTimeout(resolve, 3));
      if (seq % 100 === 99) {
        // last_seq is read first; a flush may land before the events are read, so events can only be ahead of it.
        const [session] = await reader.findUnfinished();
        const events = (await reader.read(session.key)).events;
        checks.push({ seqs: events.map((e) => e.seq), lastSeq: session.lastSeq, settled: false });
      }
    }
    await writer.flush();
    const [session] = await reader.findUnfinished();
    checks.push({ seqs: (await reader.read(session.key)).events.map((e) => e.seq), lastSeq: session.lastSeq, settled: true });
    return checks;
  }, { name: dbName(testInfo), rec: record() });
  for (const { seqs, lastSeq, settled } of result) {
    expect(seqs).toEqual(seqs.map((_, i) => i));
    if (settled) expect(lastSeq).toBe(seqs.length - 1);
    else expect(seqs.length - 1).toBeGreaterThanOrEqual(lastSeq);
  }
  expect(result.at(-1).seqs).toHaveLength(700);
});

test('abandon closes an interrupted session as aborted at its real last event; remove deletes it', async ({ page }, testInfo) => {
  await openPage(page);
  const result = await page.evaluate(async ({ name, rec }) => {
    const mk = (seq) => ({ v: 1, seq, t: seq, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
    const writer = window.expfwStorage.createLocalStore({ dbName: name, flushMs: 50 });
    writer.begin(rec);
    for (let seq = 0; seq < 8; seq += 1) writer.append(mk(seq));
    await writer.flush();
    const store = window.expfwStorage.createLocalStore({ dbName: name });
    const [item] = await store.findUnfinished();
    const closed = await store.abandon(item.key);
    const after = await store.findUnfinished();
    const stillReadable = (await store.read(item.key)).events.length;
    await store.remove(item.key);
    return { item, closed, after, stillReadable, removed: await store.read(item.key) };
  }, { name: dbName(testInfo), rec: record() });
  expect(result.item.lastSeq).toBe(7);
  expect(result.closed).toMatchObject({ status: 'aborted', end_reason: 'aborted', last_seq: 7, subject_id: 'sub-001' });
  expect(result.closed.ended_at).toBe(result.item.updatedAt);
  expect(result.after).toEqual([]);
  expect(result.stillReadable).toBe(8);
  expect(result.removed).toBeNull();
});

test('several sessions are kept apart', async ({ page }, testInfo) => {
  await openPage(page);
  const result = await page.evaluate(async ({ name, records }) => {
    const mk = (seq, n) => ({ v: 1, seq, t: seq, source: 'system', type: 'page.focus', data: { focused: n % 2 === 0 }, block: null, trial: null, phase: null, caused_by: null });
    for (const [i, rec] of records.entries()) {
      const store = window.expfwStorage.createLocalStore({ dbName: name, flushMs: 50 });
      store.begin(rec);
      for (let seq = 0; seq <= i + 1; seq += 1) store.append(mk(seq, i));
      await store.flush();
    }
    const store = window.expfwStorage.createLocalStore({ dbName: name });
    const found = await store.findUnfinished();
    return Promise.all(found.map(async (f) => [f.record.subject_id, f.lastSeq, (await store.read(f.key)).events.length]));
  }, { name: dbName(testInfo), records: [record(1), record(2), record(3)] });
  expect(result.sort()).toEqual([['sub-001', 1, 2], ['sub-002', 2, 3], ['sub-003', 3, 4]]);
});

test('querying old sessions does not create the database', async ({ page }, testInfo) => {
  await openPage(page);
  const name = dbName(testInfo);
  const result = await page.evaluate(async (dbNameValue) => {
    const store = window.expfwStorage.createLocalStore({ dbName: dbNameValue });
    const found = await store.findUnfinished();
    const names = (await indexedDB.databases()).map((d) => d.name);
    return { found, exists: names.includes(dbNameValue) };
  }, name);
  expect(result).toEqual({ found: [], exists: false });
});

test('without IndexedDB the store degrades to memory, says so, and still exports', async ({ page }, testInfo) => {
  await openPage(page);
  const result = await page.evaluate(async ({ name, rec }) => {
    const mk = (seq) => ({ v: 1, seq, t: seq, source: 'system', type: 'page.focus', data: { focused: true }, block: null, trial: null, phase: null, caused_by: null });
    const broken = { open: () => { const req = {}; setTimeout(() => { req.error = new Error('storage is disabled'); req.onerror(); }, 0); return req; } };
    const store = window.expfwStorage.createLocalStore({ indexedDB: broken, dbName: name, flushMs: 20 });
    const statuses = [];
    store.onStatus((s) => statuses.push(s));
    store.begin(rec);
    for (let seq = 0; seq < 4; seq += 1) store.append(mk(seq));
    const snapshot = await store.snapshot();
    await store.finish({ ...rec, status: 'complete' });
    return { statuses, seqs: snapshot.events.map((e) => e.seq), degraded: store.degraded, found: await store.findUnfinished() };
  }, { name: dbName(testInfo), rec: record() });
  expect(result.statuses.map((s) => s.state)).toEqual(['opening', 'degraded', 'closed']);
  expect(result.statuses[1].detail).toContain('storage is disabled');
  expect(result.seqs).toEqual([0, 1, 2, 3]);
  expect(result.degraded).toBe(true);
  expect(result.found).toEqual([]);
});
