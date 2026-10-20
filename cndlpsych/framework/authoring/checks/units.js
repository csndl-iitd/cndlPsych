// Physical units (mm, deg) only mean something with a viewing-distance / pixel-size calibration.
import { FILES, writtenScopes } from '../context.js';

const PHYSICAL = /^\d+(\.\d+)?(mm|deg)$/;

function* physicalLengths(node, path = []) {
  if (typeof node === 'string') {
    if (PHYSICAL.test(node)) yield { path, value: node };
  } else if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* physicalLengths(item, [...path, i]);
  } else if (node && typeof node === 'object') {
    for (const [key, item] of Object.entries(node)) yield* physicalLengths(item, [...path, key]);
  }
}

export function checkUnits(ctx) {
  const calibrated = ['card', 'manual'].includes(ctx.experiment.device?.calibration?.mode);
  if (calibrated) return;
  const warn = (file, path, value) => ctx.report.warn('units-need-calibration', file, path,
    `${value} needs a physical-size calibration; set device.calibration.mode (card or manual) or the size is only an estimate`);

  const { overlay, eyetracking } = ctx.experiment;
  for (const [key, section] of [['overlay', overlay], ['eyetracking', eyetracking]]) {
    for (const { path, value } of physicalLengths(section, [key])) warn(FILES.experiment, path, value);
  }
  ctx.stimuliDoc.stimuli?.forEach((entry, i) => {
    for (const { path, value } of physicalLengths({ size: entry.size }, ['stimuli', i])) warn(FILES.stimuli, path, value);
  });
  for (const { file, path, input } of writtenScopes(ctx)) {
    for (const found of physicalLengths(input, path.length ? [...path, 'input'] : ['input'])) warn(file, found.path, found.value);
  }
}
