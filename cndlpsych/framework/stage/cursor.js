// Mouse cursor behaviour: hide after a while without movement, show again after moving
// a few pixels. Touch and pen input never touch the cursor. Movement is reported by
// input.js (this module attaches no listeners).
import { schedule as defaultSchedule } from '../foundation/clock.js';

const DEFAULTS = { autohide_ms: 1000, show_on_move_px: 3 };

/**
 * @param {{element: HTMLElement, schedule?: Function}} options `element` gets `cursor: none` while hidden
 */
export function createCursor({ element, schedule = defaultSchedule }) {
  let settings = { ...DEFAULTS };
  let hidden = false;
  let cancelTimer = null;
  let anchor = null;

  function setHidden(value) {
    hidden = value;
    element.style.cursor = value ? 'none' : '';
  }

  function arm(point) {
    cancelTimer?.();
    cancelTimer = null;
    if (settings.autohide_ms <= 0) return;
    cancelTimer = schedule(settings.autohide_ms, () => {
      anchor = point;
      setHidden(true);
    });
  }

  return {
    /** Apply the resolved `cursor` settings of the current scope. */
    configure(next = {}) {
      settings = { ...DEFAULTS, ...next };
      if (settings.autohide_ms <= 0) {
        cancelTimer?.();
        setHidden(false);
      }
    },

    /** A pointer moved (client px). Only mouse movement counts. */
    moved({ cx, cy, pointer_type: pointerType }) {
      if (pointerType !== 'mouse') return;
      const point = { cx, cy };
      if (hidden) {
        const travelled = Math.hypot(cx - anchor.cx, cy - anchor.cy);
        if (travelled < settings.show_on_move_px) return;
        setHidden(false);
      }
      arm(point);
    },

    get hidden() { return hidden; },

    dispose() {
      cancelTimer?.();
      setHidden(false);
    },
  };
}
