import { describe, expect, it } from 'vitest';
import { assignedSubject, remoteFailedMessage } from './remote.js';

describe('assignedSubject', () => {
  it('leaves the field alone without Firebase', async () => {
    expect(await assignedSubject(null)).toEqual({});
  });

  it('hides it for public participants (the number is assigned later)', async () => {
    expect(await assignedSubject({ access: 'public' })).toEqual({ hidden: true });
  });

  it('prefills the suggestion for the experimenter, locked unless overriding is allowed', async () => {
    const suggest = async () => ({ n: 3, label: 'sub-003' });
    expect(await assignedSubject({ access: 'controlled', allowOverride: false, suggest })).toEqual({ value: 'sub-003', locked: true });
    expect(await assignedSubject({ access: 'controlled', allowOverride: true, suggest })).toEqual({ value: 'sub-003', locked: false });
  });
});

describe('remoteFailedMessage', () => {
  it('says what failed and that nothing was stored', () => {
    expect(remoteFailedMessage('offline')).toContain('offline');
    expect(remoteFailedMessage('offline')).toContain('Nothing has been stored');
  });
});
