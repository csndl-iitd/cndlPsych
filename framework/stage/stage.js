// The letterboxed stage element, hit testing of registered targets, and visual effects.
// Everything the participant sees and touches is laid out inside this element.
import { schedule as defaultSchedule } from '../foundation/clock.js';
import { computeLayout, isEstimated, lengthToPx, parseTargetId, toStage } from './geometry.js';

const TARGET_SELECTOR = '[data-role],[data-id]';

const sameRect = (a, b) => a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

function distanceToRect({ cx, cy }, rect) {
  const dx = Math.max(rect.left - cx, 0, cx - rect.right);
  const dy = Math.max(rect.top - cy, 0, cy - rect.bottom);
  return Math.hypot(dx, dy);
}

/**
 * @param {{root: HTMLElement, bus: object, spec?: object, calibration?: object, schedule?: Function, reserve?: (width: number, height: number) => number}} options
 *   `root` fills the viewport; `spec` is experiment.yaml `stage`; `reserve` is a border the stage must
 *   keep free on every side (overlays), used when larger than `spec.margin`.
 */
export function createStage({ root, bus, spec = {}, calibration = {}, schedule = defaultSchedule, reserve = () => 0 }) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const element = doc.createElement('div');
  element.className = 'expfw-stage';
  root.append(element);

  Object.assign(root.style, {
    position: 'fixed', inset: '0', overflow: 'hidden', touchAction: 'none', userSelect: 'none',
    webkitUserSelect: 'none', background: spec.background ?? '#000000',
  });
  Object.assign(element.style, {
    position: 'absolute', overflow: 'hidden', background: spec.background ?? '#000000', color: spec.color ?? '#ffffff',
    ...(spec.font ? { fontFamily: spec.font } : {}),
  });

  let rect = null;
  let warnedEstimate = false;
  const resizeHandlers = [];

  // Physical lengths without a calibration are an estimate: say so once in the log.
  function convert(length) {
    if (!warnedEstimate && isEstimated(length, calibration)) {
      warnedEstimate = true;
      bus.emit({
        source: 'system',
        type: 'system.warning',
        data: { code: 'uncalibrated_units', message: `"${length}" is converted with the CSS reference size (96 px per inch); it is only an estimate without a calibration` },
      });
    }
    return lengthToPx(length, rect, calibration);
  }

  function marginPx(width, height) {
    const own = spec.margin === undefined ? 0 : lengthToPx(spec.margin, { w: width, h: height }, calibration);
    return Math.max(own, reserve(width, height));
  }

  /** Recompute the stage box; `force` emits stage.resize even if nothing changed (recording just started). */
  function layout(force = false) {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const box = computeLayout({ width, height, aspect: spec.aspect, margin: marginPx(width, height) });
    Object.assign(element.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    const bounds = element.getBoundingClientRect();
    const next = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
    if (!force && sameRect(rect, next)) return;
    rect = next;
    bus.emit({
      source: 'system',
      type: 'stage.resize',
      data: {
        rect,
        viewport: { w: win.innerWidth, h: win.innerHeight },
        dpr: win.devicePixelRatio,
        orientation: win.innerWidth >= win.innerHeight ? 'landscape' : 'portrait',
      },
    });
    resizeHandlers.forEach((handler) => handler(rect));
  }

  const observer = new win.ResizeObserver(() => layout());
  observer.observe(root);
  layout();

  /** Registered target nearest to a client point, within `padding` CSS px of its box. */
  function hit(cx, cy, padding = 0) {
    let best = null;
    for (const candidate of element.querySelectorAll(TARGET_SELECTOR)) {
      const box = candidate.getBoundingClientRect();
      const distance = distanceToRect({ cx, cy }, box);
      if (distance > padding) continue;
      const centre = Math.hypot(cx - (box.left + box.right) / 2, cy - (box.top + box.bottom) / 2);
      if (!best || distance < best.distance || (distance === best.distance && centre < best.centre)) {
        best = { distance, centre, element: candidate, box };
      }
    }
    if (!best) return null;
    const { dataset } = best.element;
    return {
      ref: { id: dataset.id === undefined ? null : parseTargetId(dataset.id), role: dataset.role ?? null },
      box: best.box,
    };
  }

  function elementsFor(ref) {
    if (!ref) return [];
    return [...element.querySelectorAll(TARGET_SELECTOR)].filter((candidate) => {
      const { dataset } = candidate;
      return (ref.id === null || ref.id === undefined || String(ref.id) === dataset.id) && (ref.role === null || ref.role === dataset.role);
    });
  }

  /** Apply an `effect` ({target, add_class, style, revert_after}); `targets` are target refs. */
  function applyEffect(effect, targets = []) {
    const kind = effect.target ?? 'event_target';
    const elements = kind === 'stage' ? [element] : targets.flatMap(elementsFor);
    for (const el of elements) {
      const previous = {};
      if (effect.add_class) el.classList.add(effect.add_class);
      for (const [property, value] of Object.entries(effect.style ?? {})) {
        previous[property] = el.style.getPropertyValue(property);
        el.style.setProperty(property, String(value));
      }
      if (effect.revert_after === undefined) continue;
      schedule(effect.revert_after, () => {
        if (effect.add_class) el.classList.remove(effect.add_class);
        for (const [property, value] of Object.entries(previous)) el.style.setProperty(property, value);
      });
    }
  }

  return {
    element,
    /** The full-viewport container: input listeners attach here so taps in the letterbox are seen. */
    root,
    get rect() { return { ...rect }; },
    get shorterSide() { return Math.min(rect.w, rect.h); },
    toStage: (cx, cy) => toStage(rect, cx, cy),
    lengthToPx: convert,
    hit,
    applyEffect,
    onResize(handler) {
      resizeHandlers.push(handler);
      return () => resizeHandlers.splice(resizeHandlers.indexOf(handler), 1);
    },
    layout,
    dispose() {
      observer.disconnect();
      element.remove();
    },
  };
}
