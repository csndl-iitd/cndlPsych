// The part of a session that new and resumed sessions share: run the blocks, then end the session.
import { runBlocks } from './run-blocks.js';
import { completeSession, stopSession } from './finish.js';

/**
 * @param {{
 *   run: {services: object, project: object, refresh: Promise<{frameMs: number}|null>},
 *   store: object, profile: string, inputProfiles: string[], seed: number, answers: object, resume: object|null,
 *   finish: (reason: string) => Promise<object>, eye: {beforeBlock: Function, stop: Function},
 * }} options `resume` is where to carry on (see run-blocks.js), or null for a new session
 * @returns {Promise<{status: string, record: object, error?: Error}>}
 */
export async function conductSession({ run, store, profile, inputProfiles, seed, answers, resume, finish, eye }) {
  const { services, project, refresh } = run;
  services.setSessionContext(answers);
  services.setInputProfiles(inputProfiles);
  const measured = await refresh;
  if (measured) services.setFrameMs(measured.frameMs);
  try {
    await runBlocks({ services, plan: project.plan, profile, seed, answers, resume, beforeBlock: eye.beforeBlock, trialLimit: run.mode?.trialLimit });
  } catch (error) {
    return stopSession({ services, finish, eye, error });
  }
  return completeSession({ services, project, store, finish, eye, mode: run.mode });
}
