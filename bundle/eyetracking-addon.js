// The eye tracking add-on's entry: WebGazer plus where its face model lives and its version.
// WebGazer is GPL-3.0-or-later, so this is built into its own folder (dist/expfw-eyetracking),
// separate from the MIT-licensed core; see LICENSE-eyetracking.md.
import webgazer from 'webgazer';
import manifest from 'webgazer/package.json';

export default webgazer;
export const version = manifest.version;
/** The face model files are served next to this script. */
export const solutionPath = new URL('mediapipe/face_mesh', import.meta.url).href;
