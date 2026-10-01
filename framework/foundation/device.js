// Device profiles: capability detection, selection (auto | prompt | fixed) and the
// rejection path. Environment reading takes the window object as an argument so the
// logic is testable without a browser.

/** Built-in profile conditions, in detection order (same shape as device.profiles.<id>.when). */
export const BUILTIN_PROFILE_CONDITIONS = {
  desktop: { pointer: 'fine', hover: 'hover' },
  phone: { pointer: 'coarse', touch: true, max_width_px: 599 },
  tablet: { pointer: 'coarse', touch: true, min_width_px: 600 },
};

/**
 * Snapshot of what the browser can do. `short_side_px` is the shorter side of the
 * screen in CSS px, so rotating a phone does not turn it into a tablet.
 * `keyboard` is assumed on devices whose primary pointer is fine (it cannot be detected).
 */
export function readEnvironment(win = globalThis) {
  const query = (text) => win.matchMedia?.(text).matches ?? false;
  const pointer = query('(pointer: fine)') ? 'fine' : query('(pointer: coarse)') ? 'coarse' : 'none';
  const touchPoints = win.navigator?.maxTouchPoints ?? 0;
  const screen = win.screen ?? {};
  const width = win.innerWidth ?? screen.width ?? 0;
  const height = win.innerHeight ?? screen.height ?? 0;
  return {
    pointer,
    hover: query('(hover: hover)') ? 'hover' : 'none',
    keyboard: pointer === 'fine',
    touch: touchPoints > 0,
    touch_points: touchPoints,
    short_side_px: Math.min(screen.width ?? width, screen.height ?? height),
    screen: { w: screen.width ?? 0, h: screen.height ?? 0, dpr: win.devicePixelRatio ?? 1 },
    viewport: { w: width, h: height },
    orientation: width >= height ? 'landscape' : 'portrait',
    user_agent: win.navigator?.userAgent ?? '',
    platform: win.navigator?.platform,
    language: win.navigator?.language,
  };
}

/** Does the environment satisfy a profile's `when` block? Every listed key must hold. */
export function matchesWhen(when, env) {
  return Object.entries(when).every(([key, expected]) => {
    switch (key) {
      case 'pointer': return env.pointer === expected;
      case 'hover': return env.hover === expected;
      case 'keyboard': return env.keyboard === expected;
      case 'touch': return env.touch === expected;
      case 'min_width_px': return env.short_side_px >= expected;
      case 'max_width_px': return env.short_side_px <= expected;
      case 'orientation': return env.orientation === expected;
      default: throw new TypeError(`unknown device condition "${key}"`);
    }
  });
}

/** Profile id -> `when`: custom profiles first (they win ties), then the built-ins they do not replace. */
export function profileConditions(deviceSpec = {}) {
  const custom = Object.fromEntries(Object.entries(deviceSpec.profiles ?? {}).map(([id, { when }]) => [id, when]));
  const builtin = Object.fromEntries(Object.entries(BUILTIN_PROFILE_CONDITIONS).filter(([id]) => !(id in custom)));
  return { ...custom, ...builtin };
}

/** Every profile whose conditions the environment meets, in detection order. */
export function detectCandidates(env, deviceSpec) {
  return Object.entries(profileConditions(deviceSpec)).filter(([, when]) => matchesWhen(when, env)).map(([id]) => id);
}

/**
 * Choose the active profile.
 * @param {{select?: 'auto'|'prompt'|'fixed', fixed?: string}} deviceSpec
 * @param {{env: object, chosen?: string, override?: string}} input
 *   `chosen` is the participant's answer when select is "prompt"; `override` (e.g. from a
 *   URL parameter) wins over everything.
 * @returns {{profile: string|null, reason: string, candidates: string[], pending?: boolean}}
 *   profile is null when nothing matches; `pending` means a prompt answer is still needed
 */
export function resolveProfile(deviceSpec = {}, { env, chosen, override }) {
  const known = Object.keys(profileConditions(deviceSpec));
  const candidates = detectCandidates(env, deviceSpec);
  const pick = (profile, reason) => {
    if (!known.includes(profile)) throw new RangeError(`unknown device profile "${profile}"`);
    return { profile, reason, candidates };
  };
  if (override !== undefined) return pick(override, 'override');
  switch (deviceSpec.select ?? 'auto') {
    case 'fixed': return pick(deviceSpec.fixed, 'fixed');
    case 'prompt': return chosen === undefined ? { profile: null, reason: 'prompt', candidates, pending: true } : pick(chosen, 'prompt');
    default: return { profile: candidates[0] ?? null, reason: 'auto', candidates };
  }
}

export function rejectionMessage(deviceSpec, profile, allowed) {
  if (deviceSpec.rejected_message) return deviceSpec.rejected_message;
  const what = profile ? `this kind of device (${profile})` : 'this device';
  return `This experiment cannot run on ${what}. Please use: ${allowed.join(', ')}.`;
}

/**
 * The device check of the lifecycle. Emits `device.profile`; when the profile is not
 * allowed (or nothing matched) it also emits `session.end` with reason device_rejected.
 * @param {{emit: (event: object) => object}} bus
 * @returns {{admitted: boolean, profile: string|null, reason: string, candidates: string[], message?: string, pending?: boolean}}
 */
export function admitDevice(bus, deviceSpec = {}, input) {
  const resolved = resolveProfile(deviceSpec, input);
  if (resolved.pending) return { admitted: false, ...resolved };

  const allowed = deviceSpec.allowed ?? Object.keys(profileConditions(deviceSpec));
  bus.emit({
    source: 'system',
    type: 'device.profile',
    data: { profile: resolved.profile ?? 'unknown', reason: resolved.reason, candidates: resolved.candidates },
  });
  if (resolved.profile !== null && allowed.includes(resolved.profile)) return { admitted: true, ...resolved };

  bus.emit({ source: 'system', type: 'session.end', data: { reason: 'device_rejected' } });
  return { admitted: false, ...resolved, message: rejectionMessage(deviceSpec, resolved.profile, allowed) };
}

/** The `device` block of the session record. */
export function deviceRecord(env, { profile, reason }, calibration) {
  return {
    profile,
    profile_reason: reason,
    user_agent: env.user_agent,
    ...(env.platform ? { platform: env.platform } : {}),
    ...(env.language ? { language: env.language } : {}),
    screen: env.screen,
    viewport: env.viewport,
    pointer: env.pointer,
    hover: env.hover,
    touch_points: env.touch_points,
    keyboard: env.keyboard,
    ...(calibration ? { calibration } : {}),
  };
}
