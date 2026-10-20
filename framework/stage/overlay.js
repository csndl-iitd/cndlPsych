// Optional overlays drawn over the whole viewport, outside the stage: AprilTags in the four
// corners (for locating the screen in a video of it) and a photodiode patch that changes on
// stimulus onsets (for measuring display latency with a light sensor). They reserve a border
// around the stage so stimuli never sit under them.
import { compileStep } from '../foundation/matcher.js';
import { AVAILABLE_TAG_IDS, TAG_FAMILY } from '../foundation/overlay-spec.js';
import { lengthToPx } from './geometry.js';
import { TAG36H11 } from './tag-images.js';

const CORNERS = ['tl', 'tr', 'br', 'bl']; // tag ids are assigned in this order
const TAG_MODULES = 8; // tag36h11 is 8 x 8 modules including its black border
const DEFAULT_PULSE_MS = 50;

const placement = (corner, inset) => ({
  ...(corner[0] === 't' ? { top: `${inset}px` } : { bottom: `${inset}px` }),
  ...(corner[1] === 'l' ? { left: `${inset}px` } : { right: `${inset}px` }),
});

/**
 * Where the photodiode patch goes: in the corner's margin, next to the tag and never over it. The tag stays
 * in the very corner. On a wide screen the patch sits in the side margin, further from the corner than the
 * tag (above a bottom tag, below a top one); on a tall screen it sits in the top or bottom margin, further
 * from the corner along the edge (right of a left tag, left of a right tag). Without tags it takes the corner.
 */
export function diodePlacement(corner, { tagOuter, gap }, viewport) {
  const along = tagOuter > 0 ? `${gap + tagOuter}px` : '0px';
  const wide = viewport.w >= viewport.h;
  const vertical = corner[0] === 't' ? 'top' : 'bottom';
  const horizontal = corner[1] === 'l' ? 'left' : 'right';
  return wide ? { [horizontal]: '0px', [vertical]: along } : { [vertical]: '0px', [horizontal]: along };
}

/** Sizes in px for an overlay spec: the tag, its quiet zone, the photodiode patch and the gap to the edge. */
function measures(spec, calibration, viewport) {
  const px = (length) => lengthToPx(length, viewport, calibration);
  const tags = spec.apriltags?.enabled ? spec.apriltags : null;
  const diode = spec.photodiode?.enabled ? spec.photodiode : null;
  const tagPx = tags ? px(tags.size ?? '12mm') : 0;
  const quiet = tags ? (tagPx / TAG_MODULES) * (tags.quiet_zone ?? 1) : 0;
  const gap = tags?.margin ? px(tags.margin) : 0;
  return { tags, diode, tagPx, quiet, gap, tagOuter: tags ? tagPx + 2 * quiet : 0, diodePx: diode ? px(diode.size ?? '10mm') : 0 };
}

/**
 * The border (px) the stage must keep free on every side for these overlays; 0 when none are on.
 * @param {object} [spec] experiment.yaml `overlay`
 * @returns {(width: number, height: number) => number}
 */
export function overlayReserve(spec = {}, calibration = {}) {
  return (width, height) => {
    const m = measures(spec, calibration, { w: width, h: height });
    return Math.max(m.tags ? m.tagPx + 2 * m.quiet + m.gap : 0, m.diodePx);
  };
}

/**
 * @param {{root: HTMLElement, bus: object, spec?: object, calibration?: object, viewport: () => {w: number, h: number}, schedule: Function}} options
 *   `root` is the viewport-sized container the stage lives in.
 */
export function createOverlay({ root, bus, spec = {}, calibration = {}, viewport, schedule }) {
  const doc = root.ownerDocument;
  const m = measures(spec, calibration, viewport());
  const elements = [];
  const layer = (style) => {
    const el = doc.createElement('div');
    Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2147483000', boxSizing: 'content-box', ...style });
    root.append(el);
    elements.push(el);
    return el;
  };

  const tags = [];
  if (m.tags) {
    const ids = m.tags.ids ?? AVAILABLE_TAG_IDS;
    CORNERS.forEach((corner, index) => {
      const box = layer({ ...placement(corner, m.gap), padding: `${m.quiet}px`, background: '#fff', width: `${m.tagPx}px`, height: `${m.tagPx}px` });
      box.className = 'expfw-apriltag';
      const img = doc.createElement('img');
      Object.assign(img.style, { width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' });
      img.src = TAG36H11[ids[index]];
      img.alt = '';
      box.append(img);
      tags.push({ id: ids[index], corner, box });
    });
  }

  let lit = false;
  let watcher = null;
  if (m.diode) {
    const corner = m.diode.corner ?? 'bl';
    const patch = layer({ width: `${m.diodePx}px`, height: `${m.diodePx}px`, background: '#000' });
    patch.className = 'expfw-photodiode';
    const place = () => {
      Object.assign(patch.style, { top: '', bottom: '', left: '', right: '' }, diodePlacement(corner, m, viewport()));
    };
    place();
    watcher = new doc.defaultView.ResizeObserver(place);
    watcher.observe(root);
    const triggers = (m.diode.on ?? [{ on: 'phase.onset' }]).map(compileStep);
    const show = (on) => {
      lit = on;
      patch.style.background = on ? '#fff' : '#000';
      bus.emit({ source: 'system', type: 'overlay.photodiode', data: { lit: on, mode: m.diode.mode ?? 'toggle' } });
    };
    bus.on('*', (event) => {
      if (!triggers.some((matches) => matches(event))) return;
      if (m.diode.mode === 'pulse') {
        show(true);
        schedule(m.diode.pulse_ms ?? DEFAULT_PULSE_MS, () => show(false));
      } else {
        show(!lit);
      }
    });
  }

  return {
    /** The `overlays` part of the session record, positions in client px at this moment. */
    record() {
      const out = {};
      if (m.tags) {
        out.apriltags = {
          family: TAG_FAMILY,
          tags: tags.map(({ id, corner, box }) => {
            const r = box.getBoundingClientRect();
            return { id, corner, cx: r.x + r.width / 2, cy: r.y + r.height / 2, size_px: r.width - 2 * m.quiet };
          }),
        };
      }
      if (m.diode) out.photodiode = { corner: m.diode.corner ?? 'bl', size_px: m.diodePx };
      return Object.keys(out).length ? out : undefined;
    },
    get photodiodeLit() { return lit; },
    dispose() { watcher?.disconnect(); elements.forEach((el) => el.remove()); },
  };
}
