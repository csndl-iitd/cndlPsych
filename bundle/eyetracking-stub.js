// What `import('webgazer')` resolves to in the core bundle, which does not contain WebGazer
// (it is GPL-3.0-or-later; the core is MIT). The real module is the add-on folder
// `expfw-eyetracking/` next to `expfw/`; this loads it when eye tracking is used, and says what
// to do when it is not there.
import { ADDON_MISSING } from '../framework/pipeline/gaze.js';

const url = new URL('../expfw-eyetracking/webgazer.js', import.meta.url).href;

let addOn;
try {
  addOn = await import(/* @vite-ignore */ url);
} catch (cause) {
  throw Object.assign(new Error('Eye tracking is switched on, but the expfw-eyetracking add-on is not installed. Copy the expfw-eyetracking folder next to expfw/ (it is GPL-licensed software, which is why it is separate), or switch eyetracking off.', { cause }), { code: ADDON_MISSING });
}

export default addOn.default;
export const { version, solutionPath } = addOn;
