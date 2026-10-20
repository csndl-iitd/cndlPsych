// The only place the runtime reaches jsPsych itself (besides the bridge): creating the
// instance and running nodes. jsPsych is imported only in pipeline/bridge.js and here.
import { initJsPsych } from 'jspsych';

/**
 * @param {{display: HTMLElement, extensions: Function[]}} options `extensions` are extension classes (the bridge's)
 */
export function createJsPsych({ display, extensions }) {
  return initJsPsych({ display_element: display, extensions: extensions.map((type) => ({ type })) });
}

/** Run nodes to completion. A timeline can be run many times on one instance (blocks, screens). */
export async function runNodes(jsPsych, nodes) {
  await jsPsych.run(nodes);
}
