import { describe, expect, it, vi } from 'vitest';

const asked = [];
vi.mock('../../authoring/modules/survey.js', () => ({ askAction: async (_screen, options) => { asked.push(options.message); } }));
const { signInRemote } = await import('./remote-sign-in.js');

const remote = (access, errors) => {
  const queue = [...errors];
  return { access, config: { access, web_config: { projectId: 'p' } }, signIn: async () => { const error = queue.shift(); if (error) throw error; } };
};

describe('signInRemote', () => {
  it('asks again when the Google window was closed, and signs in on the second try', async () => {
    asked.length = 0;
    const failure = await signInRemote({}, remote('controlled', [Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' })]));
    expect(failure).toBeNull();
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('Press Continue to try again');
  });

  it('gives up with an explanation on an error that trying again cannot fix', async () => {
    asked.length = 0;
    const failure = await signInRemote({}, remote('controlled', [Object.assign(new Error('x'), { code: 'auth/operation-not-allowed' })]));
    expect(failure).toContain('Google sign-in is not switched on');
    expect(asked).toHaveLength(1);
  });

  it('public mode signs in without asking', async () => {
    asked.length = 0;
    expect(await signInRemote({}, remote('public', []))).toBeNull();
    expect(asked).toEqual([]);
  });
});
