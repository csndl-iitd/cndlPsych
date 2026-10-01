import { describe, expect, it } from 'vitest';
import { createRng } from '../../foundation/rng.js';
import { defaultParams, escapeHtml, fillTemplate, renderStimulus } from './render.js';

const hint = (name) => ({ go: 'Press SPACE', next: 'tap both targets' })[name];
const render = (stimulus, extra = {}) => renderStimulus({ name: 's', ...stimulus }, { hint, ...extra });

describe('escapeHtml', () => {
  it('escapes the characters that could start markup', () => {
    expect(escapeHtml('<b a="1">&')).toBe('&lt;b a=&quot;1&quot;&gt;&amp;');
  });
});

describe('fillTemplate', () => {
  it.each([
    ['{{go.hint}} now', { hint }, 'Press SPACE now'],
    ['{{ go.hint }}', { hint }, 'Press SPACE'],
    ['{{unknown.hint}}!', { hint }, '!'],
    ['level {{n}}', { hint, vars: { n: 3 } }, 'level 3'],
    ['{{missing}}x', { hint }, 'x'],
    ['{{a}}{{b}}', { hint, vars: { a: 'x', b: 'y' } }, 'xy'],
    ['plain {single} braces', { hint }, 'plain {single} braces'],
  ])('%s', (text, lookup, expected) => {
    expect(fillTemplate(text, lookup)).toBe(expected);
  });
});

describe('renderStimulus', () => {
  it('text: escaped, sized, centred, with hint templates filled', () => {
    const { html } = render({ type: 'text', text: '<{{go.hint}}>', size: '72px', weight: 'bold', color: '#fff', font: 'Inter, sans-serif' });
    expect(html).toContain('&lt;Press SPACE&gt;');
    expect(html).toContain('font-size:72px;color:#fff;font-family:Inter, sans-serif;font-weight:bold;');
    expect(html).toContain('data-stimulus="s"');
    expect(html).toContain('display:flex;align-items:center;justify-content:center;');
  });

  it('text: a numeric size is pixels; position places the box at a stage point', () => {
    const { html } = render({ type: 'text', text: 'x', size: 40, position: { x: 0.25, y: 0.75 } });
    expect(html).toContain('font-size:40px;');
    expect(html).toContain('position:absolute;left:25%;top:75%;transform:translate(-50%,-50%);');
    expect(html).not.toContain('align-items:center');
  });

  it('html: raw markup is kept, the named style goes on an inner panel, hints are filled', () => {
    const { html } = render({ type: 'html', html: '<p>{{next.hint}}</p>', style: 'panel' }, { styles: { panel: { 'max-width': '600px', padding: '35px' } } });
    expect(html).toContain('<div style="max-width:600px;padding:35px;"><p>tap both targets</p></div>');
    expect(html.indexOf('max-width')).toBeGreaterThan(html.indexOf('align-items:center'));
  });

  it('inline style objects and extra classes are applied', () => {
    const { html } = render({ type: 'text', text: 'x', style: { 'letter-spacing': '2px' }, class: 'big' });
    expect(html).toContain('class="expfw-stimulus big"');
    expect(html).toContain('letter-spacing:2px;');
  });

  it('fill: covers the viewport by default, or just the stage', () => {
    expect(render({ type: 'fill', color: '#000' }).html).toContain('position:fixed;inset:0;background:#000;');
    expect(render({ type: 'fill', color: '#fff', cover: 'stage' }).html).toContain('position:absolute;inset:0;background:#fff;');
  });

  it.each([['circle', '<circle'], ['square', '<rect x="10"'], ['rect', '<rect x="0"'], ['cross', '<path']])('shape %s', (shape, marker) => {
    const { html } = render({ type: 'shape', shape, size: 80, color: 'red' });
    expect(html).toContain(marker);
    expect(html).toContain('fill="red"');
    expect(html).toContain('width="80px"');
  });

  it('image and audio escape their attributes; audio carries its volume', () => {
    expect(render({ type: 'image', src: 'a"b.png', alt: '<x>', fit: 'cover' }).html).toContain('src="a&quot;b.png" alt="&lt;x&gt;"');
    expect(render({ type: 'image', src: 'a.png', fit: 'cover' }).html).toContain('object-fit:cover');
    const audio = render({ type: 'audio', src: 'tone.mp3', loop: true, volume: 0.4 }).html;
    expect(audio).toContain('<audio src="tone.mp3" autoplay loop data-volume="0.4">');
  });

  it('blank is an empty box', () => {
    expect(render({ type: 'blank' }).html).toBe('<div class="expfw-stimulus" data-stimulus="s" style=""></div>');
  });

  it('custom generators: defaults from the manifest, rng and layout injected, data and css returned', () => {
    const generator = {
      params: { n: { type: 'integer', default: 3 }, label: { type: 'string', default: 'a' } },
      css: '.g{}',
      generate: ({ params, rng, trial }) => ({ html: `<i>${params.n}${params.label}${rng.int(1, 1)}t${trial}</i>`, data: { n: params.n } }),
    };
    const out = render({ type: 'gen', params: { label: 'z' } }, { generators: { gen: generator }, generatorContext: { rng: createRng(1), trial: 4 } });
    expect(out.html).toContain('<i>3z1t4</i>');
    expect(out).toMatchObject({ data: { n: 3 }, css: '.g{}' });
  });

  it('custom generator: unknown type is an error', () => {
    expect(() => render({ type: 'nope' })).toThrow(/no generator for stimulus type "nope"/);
  });

  it('keeps the {{param}} variables of a stimulus and of the call', () => {
    const { html } = render({ type: 'text', text: '{{a}}-{{b}}', params: { a: 'x' } }, { vars: { b: 'y' } });
    expect(html).toContain('x-y');
  });
});

describe('defaultParams', () => {
  it('collects declared defaults only', () => {
    expect(defaultParams({ a: { type: 'integer', default: 2 }, b: { type: 'string' }, c: { type: 'boolean', default: false } })).toEqual({ a: 2, c: false });
    expect(defaultParams()).toEqual({});
  });
});
