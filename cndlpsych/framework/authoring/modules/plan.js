// response_task planning: which trial instances a block runs and in what order.
// Pure and seeded, so a session's trial list is reproducible from its seed.
import { durationMs } from '../../foundation/clock.js';
import { matchesPredicate } from '../../foundation/matcher.js';

const MAX_SHUFFLE_ATTEMPTS = 1000;

/** Replace {factor} placeholders with the cell's values. */
export function resolveName(name, cell) {
  return name.replace(/\{([a-z][a-z0-9_]*)\}/g, (match, factor) => (factor in cell ? String(cell[factor]) : match));
}

/** Full factorial of the design's factors, in declaration order (first factor varies slowest). */
export function designCells(factors) {
  return Object.entries(factors).reduce(
    (cells, [factor, values]) => cells.flatMap((cell) => values.map((value) => ({ ...cell, [factor]: value }))),
    [{}],
  );
}

function runLength(instances, factor) {
  let longest = 0;
  let run = 0;
  instances.forEach((instance, i) => {
    run = i > 0 && instance.cell[factor] === instances[i - 1].cell[factor] ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return longest;
}

const satisfies = (instances, constraints) => constraints.every(({ max_run: { factor, n } }) => runLength(instances, factor) <= n);

function instancesOf(config) {
  const { design, trials } = config;
  const cells = design ? designCells(design.factors) : [{}];
  const rounds = design?.repetitions ?? 1;
  const list = [];
  const addTrials = (cell) => {
    trials.forEach((def, defIndex) => {
      if (def.applies_to && !matchesPredicate(def.applies_to, cell)) return;
      for (let r = 0; r < (def.repetitions ?? 1); r += 1) list.push({ def, defIndex, cell, conditions: { ...cell, ...def.conditions } });
    });
  };
  if (design) {
    for (let round = 0; round < rounds; round += 1) cells.forEach(addTrials);
  } else {
    addTrials({});
  }
  return list;
}

/**
 * A concrete duration in ms from a duration value; a [min, max] pair is drawn uniformly (jitter).
 * @param {number|string|{frames: number}|Array} spec
 */
export function drawDuration(spec, rng, frameMs) {
  if (Array.isArray(spec)) {
    const [low, high] = spec.map((value) => durationMs(value, frameMs));
    return low + rng.next() * (high - low);
  }
  return durationMs(spec, frameMs);
}

/**
 * The trial instances of a block in presentation order, numbered from 1.
 * `order: shuffle` (the default) shuffles all instances; `sequential` keeps definition order.
 * @param {{trials: object[], order?: 'sequential'|'shuffle', design?: object}} config response_task config
 * @param {object} rng a seeded stream (the block's own fork)
 * @returns {{number: number, def: object, defIndex: number, cell: object, conditions: object}[]}
 */
export function expandInstances(config, rng) {
  const constraints = config.design?.constraints ?? [];
  let ordered = instancesOf(config);
  if ((config.order ?? 'shuffle') === 'shuffle') {
    for (let attempt = 0; attempt < MAX_SHUFFLE_ATTEMPTS; attempt += 1) {
      const candidate = rng.shuffle(ordered);
      if (satisfies(candidate, constraints)) {
        ordered = candidate;
        break;
      }
      if (attempt === MAX_SHUFFLE_ATTEMPTS - 1) throw new Error(`could not satisfy the max_run constraints after ${MAX_SHUFFLE_ATTEMPTS} shuffles; relax them or add trials`);
    }
  } else if (!satisfies(ordered, constraints)) {
    throw new Error('the sequential trial order violates a max_run constraint');
  }
  return ordered.map((instance, i) => ({ number: i + 1, ...instance }));
}

/** Does this block run for this device profile and these answers (subject, session, device)? */
export function blockApplies(planBlock, profile, answers) {
  if (!planBlock.profiles.includes(profile)) return false;
  return planBlock.when === undefined || matchesPredicate(planBlock.when, answers);
}
