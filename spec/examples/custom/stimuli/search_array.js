/** @type {import('../../../types').StimulusGenerator} */
export default {
  doc: 'Randomly scattered glyph array with two roles: target and distractor.',

  params: {
    targets:          { type: 'integer', default: 2,   min: 1, unit: 'count' },
    distractors:      { type: 'integer', default: 10,  min: 0, unit: 'count' },
    target_glyph:     { type: 'string',  default: 'E' },
    distractor_glyph: { type: 'string',  default: 'Ǝ' },
    min_distance:     { type: 'length',  default: 0.12 },
    margin:           { type: 'length',  default: 0.06 },
  },

  css: `.glyph { position: absolute; transform: translate(-50%, -50%);
                 font: 28px/1 'Courier New', monospace; text-align: center;
                 white-space: pre; user-select: none; }`,

  generate({ params: p, rng, layout }) {
    const items = rng.shuffle([
      ...Array(p.targets).fill({ role: 'target', glyph: p.target_glyph }),
      ...Array(p.distractors).fill({ role: 'distractor', glyph: p.distractor_glyph }),
    ])
    const points = layout.scatter(items.length, { minDistance: p.min_distance, margin: p.margin })

    const html = items
      .map((item, i) => `<div class="glyph" data-role="${item.role}" data-id="${i}" style="${layout.at(points[i])}">###\n#${item.glyph}#\n###</div>`)
      .join('')

    return { html, data: { items: items.map((item, i) => ({ ...item, ...points[i] })) } }
  },
}
