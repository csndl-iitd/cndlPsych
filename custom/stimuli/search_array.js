/** @type {import('../../cndlpsych/types').StimulusGenerator} */
export default {
  doc: 'Randomly scattered letters with two roles: target (E) and distractor (the mirror image of E). Size makes a search harder (small) or easier; colours make it bottom-up (the targets stand out by colour) instead of top-down (found only by the shape).',

  params: {
    targets:           { type: 'integer', default: 2,   min: 1, unit: 'count' },
    distractors:       { type: 'integer', default: 10,  min: 0, unit: 'count' },
    glyph:             { type: 'string',  default: 'E' },
    mirror_distractors: { type: 'boolean', default: true },   // distractors are the glyph flipped left to right
    size:              { type: 'string',  default: '28px' },    // font size of the letters; the frame around each letter scales with it
    target_color:      { type: 'string',  default: '#ffffff' },
    distractor_color:  { type: 'string',  default: '#ffffff' },
    min_distance:      { type: 'length',  default: 0.12 },
    margin:            { type: 'length',  default: 0.06 },
  },

  css: `.glyph { position: absolute; transform: translate(-50%, -50%);
                 font-family: 'Courier New', monospace; line-height: 1; text-align: center;
                 white-space: pre; user-select: none; }
         .glyph .flip { display: inline-block; transform: scaleX(-1); }`,

  generate({ params: p, rng, layout }) {
    const items = rng.shuffle([
      ...Array(p.targets).fill({ role: 'target', color: p.target_color, flipped: false }),
      ...Array(p.distractors).fill({ role: 'distractor', color: p.distractor_color, flipped: p.mirror_distractors }),
    ])
    const points = layout.scatter(items.length, { minDistance: p.min_distance, margin: p.margin })
    const letter = (item) => (item.flipped ? `<span class="flip">${p.glyph}</span>` : p.glyph)

    const html = items
      .map((item, i) => `<div class="glyph" data-role="${item.role}" data-id="${i}" style="${layout.at(points[i])} font-size: ${p.size}; color: ${item.color};">###\n#${letter(item)}#\n###</div>`)
      .join('')

    return { html, data: { items: items.map((item, i) => ({ ...item, ...points[i] })) } }
  },
}
