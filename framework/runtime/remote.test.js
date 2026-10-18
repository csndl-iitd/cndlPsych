import { describe, expect, it } from 'vitest';
import { assignedSubject, explainRemoteError, remoteFailedMessage } from './remote.js';

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

describe('explainRemoteError', () => {
  const controlled = { access: 'controlled', experiment_id: 'reaction-task', web_config: { projectId: 'cndlpsych' } };

  it('says which sign-in method to switch on, and where, when the provider is not enabled', () => {
    const text = explainRemoteError({ code: 'auth/operation-not-allowed' }, controlled);
    expect(text).toContain('Google sign-in is not switched on for the project "cndlpsych"');
    expect(text).toContain('Authentication > Sign-in method');
    expect(text).toContain('(auth/operation-not-allowed)');
    expect(explainRemoteError({ code: 'auth/operation-not-allowed' }, { ...controlled, access: 'public' })).toContain('Anonymous sign-in');
  });

  it('names the host that must be authorised', () => {
    expect(explainRemoteError({ code: 'auth/unauthorized-domain' }, controlled, 'lab.example.org')).toContain('"lab.example.org" is not an authorised domain');
  });

  it('explains a refused database request by mode: admins list for controlled, rules for public', () => {
    expect(explainRemoteError({ code: 'permission-denied' }, controlled)).toContain('experiments/reaction-task/admins/<email>');
    expect(explainRemoteError({ code: 'permission-denied' }, { ...controlled, access: 'public' })).toContain('firestore.public.rules');
  });

  it('passes an unknown error through as it is', () => {
    expect(explainRemoteError(new Error('something else'), controlled)).toBe('something else');
  });
});
