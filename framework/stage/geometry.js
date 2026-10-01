// Stage geometry: pure functions, no DOM. Stage coordinates are normalised 0-1 on each
// axis with the origin at the top left; bare lengths are fractions of the stage's
// shorter side (see ARCHITECTURE.md section 4).

/** 'fill', a number (width / height) or '16:9' -> a width / height ratio, or null for fill. */
export function parseAspect(aspect = 'fill') {
  if (aspect === 'fill') return null;
  if (typeof aspect === 'number' && aspect > 0) return aspect;
  const match = /^(\d+):(\d+)$/.exec(String(aspect));
  if (match && Number(match[2]) > 0) return Number(match[1]) / Number(match[2]);
  throw new TypeError(`invalid stage aspect "${aspect}"`);
}

/** The largest rectangle of the given aspect inside the available area, centred. */
export function computeLayout({ width, height, aspect, margin = 0 }) {
  const availW = Math.max(0, width - 2 * margin);
  const availH = Math.max(0, height - 2 * margin);
  const ratio = parseAspect(aspect);
  let w = availW;
  let h = availH;
  if (ratio !== null) {
    if (availW / availH > ratio) w = availH * ratio;
    else h = availW / ratio;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Client pixels -> stage coordinates (may fall outside 0-1 when off the stage). */
export function toStage(rect, cx, cy) {
  return { x: (cx - rect.x) / rect.w, y: (cy - rect.y) / rect.h };
}

export const isInside = ({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1;

/** The CSS reference pixel is 1/96 inch, so 1 mm is about 3.78 CSS px (a real screen may differ). */
export const CSS_PX_PER_MM = 96 / 25.4;

/**
 * A length from YAML in CSS pixels: a bare number is a fraction of the shorter side,
 * 'px' is CSS pixels, '%' is of the stage width. 'mm' uses the calibrated px_per_mm, or the
 * CSS reference size as an estimate; 'deg' needs px_per_mm and viewing_distance_mm.
 * @param {{px_per_mm?: number, viewing_distance_mm?: number}} [calibration]
 */
export function lengthToPx(length, rect, calibration = {}) {
  if (typeof length === 'number') return length * Math.min(rect.w, rect.h);
  const match = /^(\d+(?:\.\d+)?)(mm|px|deg|%)$/.exec(length);
  if (!match) throw new TypeError(`invalid length "${length}"`);
  const value = Number(match[1]);
  switch (match[2]) {
    case 'px': return value;
    case '%': return (value / 100) * rect.w;
    case 'mm': return value * (calibration.px_per_mm ?? CSS_PX_PER_MM);
    default:
      if (!calibration.px_per_mm || !calibration.viewing_distance_mm) throw new RangeError(`"${length}" needs a calibration (px_per_mm and viewing_distance_mm)`);
      return Math.tan((value * Math.PI) / 180) * calibration.viewing_distance_mm * calibration.px_per_mm;
  }
}

/** Does this length depend on a physical-size calibration it may not have? */
export const isEstimated = (length, calibration = {}) => typeof length === 'string' && length.endsWith('mm') && !calibration.px_per_mm;

/** Is a stage point inside a `region` ({x: [from, to], y: [from, to]}; an omitted axis is the whole axis)? */
export function inRegion(point, region = {}) {
  const within = (value, range) => range === undefined || (value >= range[0] && value <= range[1]);
  return within(point.x, region.x) && within(point.y, region.y);
}

/** Parse a data-id attribute: integers stay integers, anything else is a string. */
export const parseTargetId = (value) => (/^-?\d+$/.test(value) ? Number(value) : value);
