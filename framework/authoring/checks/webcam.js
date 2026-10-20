// The webcam recording stays on the computer (a file, or the browser until it is downloaded). It is not sent to Firebase.
import { profileConditions } from '../../foundation/device.js';
import { FILES } from '../context.js';

export function checkWebcam(ctx) {
  const { webcam, storage, device } = ctx.experiment;
  if (!webcam?.enabled) return;
  const { report } = ctx;
  const known = Object.keys(profileConditions(device));
  (webcam.profiles ?? []).forEach((id, i) => {
    if (!known.includes(id)) report.error('webcam-profile', FILES.experiment, ['webcam', 'profiles', i], `"${id}" is not a device profile (${known.join(', ')})`);
  });
  if (storage?.firebase?.enabled) {
    report.warn('webcam-not-uploaded', FILES.experiment, ['webcam', 'enabled'], 'the video is saved to a file on the computer (or kept in the browser and downloaded as its own file); it is never in the exported zip and is not uploaded to Firebase, which stores the events only');
  }
}
