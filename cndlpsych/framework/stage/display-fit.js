// Where the display (what jsPsych draws: forms, instructions, stimuli) sits on the screen.
//
// The stage is inset by the border the overlays need (AprilTags in the corners, the photodiode patch), so that
// stimuli never sit under them. Forms and text do not need the stage's coordinates, and on a phone that border
// on all four sides leaves a column too narrow to read (and text wider than it is cut off). So:
//  - while a block of stimuli runs ('stage'), the display is exactly the stage, so that positions in the
//    display are stage positions (hit testing, layouts);
//  - for forms, instructions and messages ('text'), it is the stage plus the border on the one axis where the
//    corners do not reach it: left and right on a tall screen (the tags are in the top and bottom bands), top and
//    bottom on a wide one (the tags are in the left and right bands). The tags never overlap it.

/**
 * @param {{x: number, y: number, w: number, h: number}} rect the stage, in client px
 * @param {{w: number, h: number}} viewport
 * @param {number} border the border the overlays need (px)
 * @param {'stage'|'text'} mode
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function displayBox(rect, viewport, border, mode) {
  if (mode === 'stage' || border <= 0) return { ...rect };
  const wide = viewport.w >= viewport.h;
  const before = (start) => Math.min(border, Math.max(0, start));
  const after = (end, size) => Math.min(border, Math.max(0, size - end));
  const left = wide ? 0 : before(rect.x);
  const right = wide ? 0 : after(rect.x + rect.w, viewport.w);
  const top = wide ? before(rect.y) : 0;
  const bottom = wide ? after(rect.y + rect.h, viewport.h) : 0;
  return { x: rect.x - left, y: rect.y - top, w: rect.w + left + right, h: rect.h + top + bottom };
}

/**
 * The display stays inside the stage element (hit testing and effects look for targets there); in text mode it
 * reaches out of it, which is why the stage element then stops clipping.
 * @param {{display: HTMLElement, root: HTMLElement, stage: {rect: object, element: HTMLElement, onResize: Function}, border: (w: number, h: number) => number}} options
 * @returns {{mode: (name: 'stage'|'text') => void}}
 */
export function createDisplayFit({ display, root, stage, border }) {
  let current = 'text';
  Object.assign(display.style, { color: stage.element.style.color, background: stage.element.style.background });

  function fit() {
    const { rect } = stage;
    const viewport = { w: root.clientWidth, h: root.clientHeight };
    const box = displayBox(rect, viewport, border(viewport.w, viewport.h), current);
    const reach = (value) => (value === 0 ? '0px' : `${-value}px`);
    Object.assign(display.style, {
      left: reach(rect.x - box.x), top: reach(rect.y - box.y), right: reach(box.x + box.w - rect.x - rect.w), bottom: reach(box.y + box.h - rect.y - rect.h),
      overflow: current === 'stage' ? 'hidden' : '',
    });
    stage.element.style.overflow = current === 'stage' ? 'hidden' : 'visible';
  }

  stage.onResize(fit);
  fit();
  return {
    mode(name) {
      current = name;
      fit();
    },
  };
}
