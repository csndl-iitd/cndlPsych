import { describe, expect, it } from 'vitest';
import { eventProblems } from '../../tools/validators.js';
import {
  admitDevice, detectCandidates, deviceRecord, inputProfiles, matchesWhen, profileConditions, readEnvironment, rejectionMessage, resolveProfile,
} from './device.js';
import { createBus } from './events.js';

/** A window-like object for the given capabilities. */
function fakeWindow({ pointer, hover, touchPoints = 0, screen, inner = screen, ua = 'test-agent', anyFine = false, anyHover = false }) {
  const media = {
    '(pointer: fine)': pointer === 'fine', '(pointer: coarse)': pointer === 'coarse', '(hover: hover)': hover === 'hover',
    '(any-pointer: fine)': anyFine, '(any-hover: hover)': anyHover,
  };
  return {
    matchMedia: (query) => ({ matches: media[query] ?? false }),
    navigator: { maxTouchPoints: touchPoints, userAgent: ua, platform: 'TestOS', language: 'en-GB' },
    screen: { width: screen[0], height: screen[1] },
    innerWidth: inner[0],
    innerHeight: inner[1],
    devicePixelRatio: 2,
  };
}

const DEVICES = {
  desktop: { pointer: 'fine', hover: 'hover', screen: [1920, 1080] },
  laptop: { pointer: 'fine', hover: 'hover', screen: [1440, 900] },
  touchLaptop: { pointer: 'fine', hover: 'hover', touchPoints: 10, screen: [1536, 864] },
  phone: { pointer: 'coarse', hover: 'none', touchPoints: 5, screen: [412, 915] },
  phoneLandscape: { pointer: 'coarse', hover: 'none', touchPoints: 5, screen: [915, 412], inner: [915, 360] },
  smallPhone: { pointer: 'coarse', hover: 'none', touchPoints: 5, screen: [360, 640] },
  tablet: { pointer: 'coarse', hover: 'none', touchPoints: 5, screen: [800, 1280] },
  tabletLandscape: { pointer: 'coarse', hover: 'none', touchPoints: 5, screen: [1280, 800] },
  // a touch tablet with a mouse and a keyboard attached (tablet mode of a convertible): primary input is touch
  surface: { pointer: 'coarse', hover: 'none', touchPoints: 10, screen: [1368, 912], anyFine: true, anyHover: true },
  bigPhoneEdge: { pointer: 'coarse', hover: 'none', touchPoints: 5, screen: [600, 1000] },
};
const env = (name) => readEnvironment(fakeWindow(DEVICES[name]));

describe('readEnvironment', () => {
  it('reads capabilities, sizes and identity', () => {
    expect(env('phone')).toMatchObject({
      pointer: 'coarse', hover: 'none', keyboard: false, touch: true, touch_points: 5, short_side_px: 412,
      orientation: 'portrait', user_agent: 'test-agent', platform: 'TestOS', language: 'en-GB',
      screen: { w: 412, h: 915, dpr: 2 }, viewport: { w: 412, h: 915 },
    });
  });

  it('assumes a keyboard on fine-pointer devices only', () => {
    expect(env('desktop').keyboard).toBe(true);
    expect(env('tablet').keyboard).toBe(false);
  });

  it('survives a window with no media queries (pointer none)', () => {
    expect(readEnvironment({ screen: { width: 100, height: 200 } })).toMatchObject({ pointer: 'none', hover: 'none', touch: false, short_side_px: 100 });
  });
});

describe('built-in profile detection', () => {
  it.each([
    ['desktop', 'desktop'], ['laptop', 'desktop'], ['touchLaptop', 'desktop'],
    ['phone', 'phone'], ['phoneLandscape', 'phone'], ['smallPhone', 'phone'],
    ['tablet', 'tablet'], ['tabletLandscape', 'tablet'], ['bigPhoneEdge', 'tablet'],
  ])('%s is a %s', (device, expected) => {
    expect(detectCandidates(env(device), {})).toEqual([expected]);
  });

  it('finds no candidate for an environment nothing matches', () => {
    expect(detectCandidates(readEnvironment({}), {})).toEqual([]);
  });
});

describe('matchesWhen', () => {
  const phone = env('phone');
  it.each([
    [{ pointer: 'coarse' }, true], [{ pointer: 'fine' }, false], [{ hover: 'none' }, true], [{ keyboard: false }, true], [{ touch: true }, true],
    [{ min_width_px: 400 }, true], [{ min_width_px: 500 }, false], [{ max_width_px: 412 }, true], [{ max_width_px: 411 }, false],
    [{ orientation: 'portrait' }, true], [{ orientation: 'landscape' }, false],
    [{ pointer: 'coarse', min_width_px: 500 }, false], [{}, true],
  ])('%j -> %s', (when, expected) => {
    expect(matchesWhen(when, phone)).toBe(expected);
  });

  it('rejects unknown conditions', () => {
    expect(() => matchesWhen({ colour: 'red' }, phone)).toThrow(/unknown device condition/);
  });
});

describe('custom profiles', () => {
  it('adds profiles, which win ties against built-ins', () => {
    const spec = { profiles: { kiosk: { when: { pointer: 'coarse', orientation: 'landscape' } } } };
    expect(detectCandidates(env('tabletLandscape'), spec)).toEqual(['kiosk', 'tablet']);
    expect(detectCandidates(env('tablet'), spec)).toEqual(['tablet']);
  });

  it('replaces a built-in profile of the same id', () => {
    const spec = { profiles: { tablet: { when: { pointer: 'coarse', min_width_px: 900 } } } };
    expect(profileConditions(spec).tablet).toEqual({ pointer: 'coarse', min_width_px: 900 });
    expect(detectCandidates(env('tablet'), spec)).toEqual([]);
  });
});

describe('resolveProfile', () => {
  it('auto: the first candidate, with all candidates listed', () => {
    const spec = { profiles: { kiosk: { when: { pointer: 'coarse' } } } };
    expect(resolveProfile(spec, { env: env('phone') })).toEqual({ profile: 'kiosk', reason: 'auto', candidates: ['kiosk', 'phone'] });
  });

  it('auto: null profile when nothing matches', () => {
    expect(resolveProfile({}, { env: readEnvironment({}) })).toEqual({ profile: null, reason: 'auto', candidates: [] });
  });

  it('fixed ignores the device', () => {
    expect(resolveProfile({ select: 'fixed', fixed: 'tablet' }, { env: env('desktop') })).toMatchObject({ profile: 'tablet', reason: 'fixed' });
  });

  it('prompt waits for the answer, then uses it', () => {
    expect(resolveProfile({ select: 'prompt' }, { env: env('desktop') })).toMatchObject({ profile: null, pending: true, reason: 'prompt' });
    expect(resolveProfile({ select: 'prompt' }, { env: env('desktop'), chosen: 'phone' })).toMatchObject({ profile: 'phone', reason: 'prompt' });
  });

  it('an override wins over every mode', () => {
    expect(resolveProfile({ select: 'fixed', fixed: 'tablet' }, { env: env('desktop'), override: 'phone' })).toMatchObject({ profile: 'phone', reason: 'override' });
  });

  it('rejects a profile that does not exist', () => {
    expect(() => resolveProfile({ select: 'prompt' }, { env: env('desktop'), chosen: 'watch' })).toThrow(/unknown device profile "watch"/);
  });
});

describe('admitDevice and the rejection path', () => {
  function setup() {
    const bus = createBus({ clock: { now: () => 5 }, validate: eventProblems });
    const events = [];
    bus.on('*', (event) => events.push(event));
    return { bus, events };
  }

  it('admits an allowed device and records device.profile only', () => {
    const { bus, events } = setup();
    const result = admitDevice(bus, { allowed: ['desktop', 'phone'] }, { env: env('phone') });
    expect(result).toMatchObject({ admitted: true, profile: 'phone', reason: 'auto' });
    expect(events.map((e) => e.type)).toEqual(['device.profile']);
    expect(events[0].data).toEqual({ profile: 'phone', reason: 'auto', candidates: ['phone'] });
  });

  it('rejects a device that is not allowed: device.profile, then session.end device_rejected', () => {
    const { bus, events } = setup();
    const result = admitDevice(bus, { allowed: ['desktop'] }, { env: env('phone') });
    expect(result.admitted).toBe(false);
    expect(result.message).toContain('desktop');
    expect(events.map((e) => e.type)).toEqual(['device.profile', 'session.end']);
    expect(events[1].data).toEqual({ reason: 'device_rejected' });
    expect(events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('rejects a device that matches no profile, recording profile "unknown"', () => {
    const { bus, events } = setup();
    const result = admitDevice(bus, {}, { env: readEnvironment({}) });
    expect(result).toMatchObject({ admitted: false, profile: null });
    expect(events[0].data.profile).toBe('unknown');
    expect(events[1].data.reason).toBe('device_rejected');
  });

  it('uses the rejected_message from experiment.yaml', () => {
    const { bus } = setup();
    const result = admitDevice(bus, { allowed: ['desktop'], rejected_message: 'Please use a computer.' }, { env: env('tablet') });
    expect(result.message).toBe('Please use a computer.');
  });

  it('emits nothing while a prompt answer is pending', () => {
    const { bus, events } = setup();
    expect(admitDevice(bus, { select: 'prompt' }, { env: env('desktop') })).toMatchObject({ admitted: false, pending: true });
    expect(events).toEqual([]);
  });

  it('allows every known profile when allowed is not set', () => {
    const { bus } = setup();
    expect(admitDevice(bus, {}, { env: env('tablet') }).admitted).toBe(true);
  });
});

describe('rejectionMessage', () => {
  it('names the device kind and the allowed ones', () => {
    expect(rejectionMessage({}, 'phone', ['desktop'])).toBe('This experiment cannot run on this kind of device (phone). Please use: desktop.');
    expect(rejectionMessage({}, null, ['desktop', 'tablet'])).toBe('This experiment cannot run on this device. Please use: desktop, tablet.');
  });
});

describe('deviceRecord', () => {
  it('builds the session record device block', () => {
    const record = deviceRecord(env('phone'), { profile: 'phone', reason: 'auto' }, { method: 'none' });
    expect(record).toMatchObject({ profile: 'phone', profile_reason: 'auto', pointer: 'coarse', hover: 'none', keyboard: false, touch_points: 5, calibration: { method: 'none' } });
    expect(deviceRecord(env('desktop'), { profile: 'desktop', reason: 'fixed' })).not.toHaveProperty('calibration');
  });
});

describe('inputProfiles', () => {
  it('a touch tablet with a mouse and keyboard uses the bindings of the tablet, desktop and phone profiles together', () => {
    const surface = env('surface');
    expect(resolveProfile({}, { env: surface }).profile).toBe('tablet'); // its primary input is touch
    expect(inputProfiles(surface, {}, 'tablet')).toEqual(['tablet', 'desktop', 'phone']);
  });

  it('a touch laptop (fine primary pointer, touch screen) gets both desktop and touch bindings', () => {
    expect(inputProfiles(env('touchLaptop'), {}, 'desktop')).toEqual(['desktop', 'phone', 'tablet']);
  });

  it.each([
    ['a desktop without touch', 'desktop', 'desktop', ['desktop']],
    ['a phone', 'phone', 'phone', ['phone', 'tablet']],
  ])('%s', (_label, device, active, expected) => {
    expect(inputProfiles(env(device), {}, active)).toEqual(expected);
  });

  it('ignores profiles that only talk about size, and honours custom conditions', () => {
    const spec = { profiles: { narrow: { when: { max_width_px: 400 } }, kiosk: { when: { touch: true, keyboard: false } } } };
    expect(inputProfiles(env('phone'), spec, 'phone')).toEqual(['phone', 'kiosk', 'tablet']);
    expect(inputProfiles(env('desktop'), spec, 'desktop')).toEqual(['desktop']);
  });
});

describe('deviceRecord input profiles', () => {
  const base = { user_agent: 'x', screen: {}, viewport: {} };
  it('lists them only when there are several', () => {
    expect(deviceRecord(base, { profile: 'tablet', reason: 'auto', inputProfiles: ['tablet', 'desktop'] }).input_profiles).toEqual(['tablet', 'desktop']);
    expect(deviceRecord(base, { profile: 'tablet', reason: 'auto', inputProfiles: ['tablet'] }).input_profiles).toBeUndefined();
  });
});
