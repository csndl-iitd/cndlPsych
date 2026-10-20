// Stimulus rendering: a stimulus definition (from the compiled plan) becomes markup for the
// stage. Pure string building, so it is unit-tested without a browser. Custom generators
// (custom/stimuli/*.js) are called through `generators`; their css is returned for the
// caller to inject once.

const BUILTIN_FILL = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const cssPair = ([property, value]) => `${property}:${value};`;
const cssText = (props = {}) => Object.entries(props).map(cssPair).join('');
const sizeCss = (size) => (typeof size === 'number' ? `${size}px` : size);

/**
 * Replace {{intent.hint}} and {{variable}} placeholders. Unknown placeholders become empty.
 * @param {{hint: (intent: string) => string|undefined, vars?: Record<string, unknown>}} lookup
 */
export function fillTemplate(text, { hint, vars = {} }) {
  return text.replace(/\{\{\s*([a-z][a-z0-9_]*)(?:\.(hint))?\s*\}\}/g, (_match, name, kind) => {
    const value = kind === 'hint' ? hint(name) : vars[name];
    return value === undefined || value === null ? '' : String(value);
  });
}

function positionCss(position) {
  if (!position) return '';
  return `position:absolute;left:${position.x * 100}%;top:${position.y * 100}%;transform:translate(-50%,-50%);`;
}

function styleCss(stimulus, styles) {
  const named = typeof stimulus.style === 'string' ? styles[stimulus.style] : stimulus.style;
  return cssText(named);
}

function textBody(stimulus, template) {
  const css = [
    stimulus.size === undefined ? '' : `font-size:${sizeCss(stimulus.size)};`,
    stimulus.color ? `color:${stimulus.color};` : '',
    stimulus.font ? `font-family:${stimulus.font};` : '',
    stimulus.weight === undefined ? '' : `font-weight:${stimulus.weight};`,
    stimulus.align ? `text-align:${stimulus.align};` : '',
  ].join('');
  return `<div style="${css}">${escapeHtml(template(stimulus.text))}</div>`;
}

function shapeBody(stimulus) {
  const size = sizeCss(stimulus.size ?? 100);
  const fill = stimulus.color ?? 'currentColor';
  const shapes = {
    circle: '<circle cx="50" cy="50" r="50"/>',
    square: '<rect x="10" y="10" width="80" height="80"/>',
    rect: '<rect x="0" y="25" width="100" height="50"/>',
    cross: '<path d="M40 0h20v40h40v20H60v40H40V60H0V40h40z"/>',
  };
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" fill="${fill}">${shapes[stimulus.shape]}</svg>`;
}

function mediaBody(stimulus) {
  if (stimulus.type === 'image') {
    return `<img src="${escapeHtml(stimulus.src)}" alt="${escapeHtml(stimulus.alt ?? '')}" style="max-width:100%;max-height:100%;object-fit:${stimulus.fit ?? 'contain'};">`;
  }
  const volume = stimulus.volume === undefined ? '' : ` data-volume="${stimulus.volume}"`;
  return `<audio src="${escapeHtml(stimulus.src)}" autoplay${stimulus.loop ? ' loop' : ''}${volume}></audio>`;
}

/**
 * @param {object} stimulus entry of plan.stimuli (each already expanded)
 * @param {{styles?: object, hint: Function, vars?: object, generators?: Record<string, object>, generatorContext?: object}} options
 * @returns {{html: string, data: object, css?: string}} `data` is merged into the trial's data by generators
 */
export function renderStimulus(stimulus, { styles = {}, hint, vars = {}, generators = {}, generatorContext }) {
  const template = (text) => fillTemplate(text, { hint, vars: { ...stimulus.params, ...vars } });
  const classes = ['cndlpsych-stimulus', stimulus.class].filter(Boolean).join(' ');
  const wrap = (css, body) => `<div class="${classes}" data-stimulus="${escapeHtml(stimulus.name)}" style="${css}">${body}</div>`;
  // The named style goes on the stimulus box, or on an inner panel when the body carries it (html).
  const placed = (body, { bodyStyled = false } = {}) => {
    const layout = stimulus.position ? positionCss(stimulus.position) : BUILTIN_FILL;
    return wrap(`${layout}${bodyStyled ? '' : styleCss(stimulus, styles)}`, body);
  };

  switch (stimulus.type) {
    case 'html': return { html: placed(`<div style="${styleCss(stimulus, styles)}">${template(stimulus.html)}</div>`, { bodyStyled: true }), data: {} };
    case 'text': return { html: placed(textBody(stimulus, template)), data: {} };
    case 'image': case 'audio': return { html: placed(mediaBody(stimulus)), data: {} };
    case 'shape': return { html: placed(shapeBody(stimulus)), data: {} };
    case 'blank': return { html: wrap('', ''), data: {} };
    case 'fill': {
      const position = stimulus.cover === 'stage' ? 'absolute' : 'fixed';
      return { html: wrap(`position:${position};inset:0;background:${stimulus.color};${styleCss(stimulus, styles)}`, ''), data: {} };
    }
    default: {
      const generator = generators[stimulus.type];
      if (!generator) throw new Error(`no generator for stimulus type "${stimulus.type}"`);
      const params = { ...defaultParams(generator.params), ...stimulus.params };
      const generated = generator.generate({ ...generatorContext, params });
      return { html: wrap(`position:absolute;inset:0;${styleCss(stimulus, styles)}`, generated.html), data: generated.data ?? {}, css: generator.css };
    }
  }
}

/** Parameter defaults declared by a custom module's manifest. */
export function defaultParams(declared = {}) {
  return Object.fromEntries(Object.entries(declared).filter(([, decl]) => decl.default !== undefined).map(([name, decl]) => [name, decl.default]));
}
