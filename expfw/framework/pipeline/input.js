// The only place raw DOM input listeners exist (hard rule 4). Normalises keyboard and
// pointer input into bus events: stage coordinates, `trusted`, and the gestures that the
// current scope enables. Tasks and rules never attach listeners; they use the bus.
//
// Page lifecycle (visibilitychange, pagehide, focus, blur) is reported here too, because this is
// the one module that listens to the DOM.
//
// What is recorded (and what is not):
//  - key events: every key except while an editable field has focus (typed answers in
//    forms are never logged); consumed keys carry `consumed: true`.
//  - pointer presses (down, up, cancel) and every gesture the participant makes (tap, long press,
//    swipe, drag), whatever the scope: the log is a record of what the participant did, not only
//    of what the task listens for. Mouse movement without a button is never logged (it only
//    reports activity for the cursor).
import { createCounter, createRecognizer } from './gestures.js';
import { schedule as defaultSchedule } from '../foundation/clock.js';

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const POINTER_TYPES = new Set(['mouse', 'touch', 'pen']);
const ALL_GESTURES = ['tap', 'longpress', 'swipe', 'drag'];

/**
 * @param {{bus: object, stage: object, doc?: Document, schedule?: Function}} options
 *   `stage` is the object returned by createStage (root, hit, toStage, lengthToPx, shorterSide).
 */
export function createInput({ bus, stage, doc = stage.root.ownerDocument, schedule = defaultSchedule }) {
  const win = doc.defaultView;
  const removers = [];
  const activityHandlers = [];
  const leaveHandlers = [];
  let consumer = () => false;
  let scope = { gestures: [], paddingPx: 0 };

  const emit = (type, data, t) => bus.emit({ source: 'input', type, data, t });
  // Two recognizers see every press: the scope's one reports the gestures the task listens for (with the
  // scope's thresholds and path recording), the observer reports every other gesture so that the log is
  // complete. They share the id of the press, so the events of one gesture can be put together.
  const nextGesture = createCounter();
  let gestureId = 0;
  const shared = {
    now: () => win.performance.now(),
    hit: (cx, cy, padding) => stage.hit(cx, cy, padding),
    toPx: (length) => stage.lengthToPx(length),
    shorterSide: () => stage.shorterSide,
    schedule,
    nextId: () => gestureId,
  };
  const recognizer = createRecognizer({ ...shared, emit });
  const listensFor = (type) => scope.gestures.some((name) => type === `input.${name}` || type.startsWith(`input.${name}.`));
  const observer = createRecognizer({ ...shared, emit: (type, data, t) => { if (!listensFor(type)) emit(type, data, t); } });

  observer.configure({ gestures: ALL_GESTURES });

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  }

  // ---- keyboard ----------------------------------------------------------------
  function onKey(type) {
    return (event) => {
      if (event.target?.closest?.(EDITABLE)) return;
      const data = { key: event.key, code: event.code, repeat: event.repeat, trusted: event.isTrusted };
      const candidate = { type, data, t: event.timeStamp, block: bus.context.block, trial: bus.context.trial, phase: bus.context.phase };
      const consumed = consumer(candidate);
      if (consumed) {
        data.consumed = true;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      emit(type, data, event.timeStamp);
    };
  }

  // ---- pointer -----------------------------------------------------------------
  function sampleOf(phase, event) {
    const { x, y } = stage.toStage(event.clientX, event.clientY);
    return {
      phase, id: event.pointerId, t: event.timeStamp, cx: event.clientX, cy: event.clientY, x, y,
      pointerType: POINTER_TYPES.has(event.pointerType) ? event.pointerType : 'mouse',
      trusted: event.isTrusted,
      ...(event.pressure > 0 ? { pressure: event.pressure } : {}),
    };
  }

  function pointerEvent(phase, event) {
    const sample = sampleOf(phase, event);
    if (sample.pointerType === 'mouse' && phase === 'down' && event.button !== 0) return;
    if (phase === 'move') {
      activityHandlers.forEach((handler) => handler({ cx: sample.cx, cy: sample.cy, pointer_type: sample.pointerType, t: sample.t }));
      feed(sample);
      return;
    }
    const found = stage.hit(sample.cx, sample.cy, scope.paddingPx);
    bus.emit({
      source: 'input',
      type: `input.pointer.${phase}`,
      t: sample.t,
      data: {
        pointer_id: sample.id, pointer_type: sample.pointerType, button: event.button, x: sample.x, y: sample.y,
        cx: sample.cx, cy: sample.cy, inside_stage: sample.x >= 0 && sample.x <= 1 && sample.y >= 0 && sample.y <= 1,
        target: found ? found.ref : null,
        ...(sample.pressure === undefined ? {} : { pressure: sample.pressure }),
        trusted: sample.trusted,
      },
    });
    if (phase === 'down') gestureId = nextGesture();
    feed(sample);
  }

  function feed(sample) {
    recognizer.pointer(sample);
    observer.pointer(sample);
  }

  function cancelAll(reason) {
    recognizer.cancel(reason);
    observer.cancel(reason);
  }

  const { root } = stage;
  listen(doc, 'keydown', onKey('input.key.down'), { capture: true });
  listen(doc, 'keyup', onKey('input.key.up'), { capture: true });
  for (const phase of ['down', 'move', 'up', 'cancel']) listen(root, `pointer${phase}`, (event) => pointerEvent(phase, event));
  listen(root, 'contextmenu', (event) => event.preventDefault());
  listen(win, 'blur', () => {
    cancelAll('blur');
    bus.emit({ source: 'system', type: 'page.focus', data: { focused: false } });
  });
  listen(win, 'focus', () => bus.emit({ source: 'system', type: 'page.focus', data: { focused: true } }));

  // The page going away: record visibility and tell listeners (storage flushes) while we still can.
  const leave = () => leaveHandlers.forEach((handler) => handler());
  listen(doc, 'visibilitychange', () => {
    if (doc.visibilityState !== 'visible' && doc.visibilityState !== 'hidden') return;
    bus.emit({ source: 'system', type: 'page.visibility', data: { state: doc.visibilityState } });
    if (doc.visibilityState === 'hidden') leave();
  });
  listen(win, 'pagehide', leave);

  return {
    /**
     * Apply the resolved input scope of the current block / trial (one profile's scope).
     * @param {{gestures?: string[], gesture_thresholds?: object, fire_on?: string, pointer_path?: boolean|object, hit_padding?: number|string, cursor?: object}} resolved
     */
    configure(resolved = {}) {
      const paddingPx = resolved.hit_padding === undefined ? 0 : stage.lengthToPx(resolved.hit_padding);
      scope = { gestures: resolved.gestures ?? [], paddingPx };
      recognizer.configure({ ...resolved, hitPaddingPx: paddingPx });
      observer.configure({ gesture_thresholds: resolved.gesture_thresholds, gestures: ALL_GESTURES, hitPaddingPx: paddingPx });
    },
    /** The mapping decides which key presses it swallows; it is asked before the event is emitted. */
    setConsumer(fn) { consumer = fn; },
    /** Mouse movement for the cursor module: handler({cx, cy, pointer_type, t}). Returns an unsubscribe. */
    onActivity(handler) {
      activityHandlers.push(handler);
      return () => activityHandlers.splice(activityHandlers.indexOf(handler), 1);
    },
    /** The page is being hidden or closed (pagehide, tab hidden): handler() should flush what it holds. */
    onLeave(handler) {
      leaveHandlers.push(handler);
      return () => leaveHandlers.splice(leaveHandlers.indexOf(handler), 1);
    },
    /** Abandon any gesture in progress (e.g. at a phase change). */
    cancelGesture(reason = 'phase_end') { cancelAll(reason); },
    dispose() {
      cancelAll('other');
      removers.splice(0).forEach((remove) => remove());
    },
  };
}
