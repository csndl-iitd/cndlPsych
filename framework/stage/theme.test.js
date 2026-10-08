import { describe, expect, it } from 'vitest';
import { THEME_CSS } from './theme.js';

describe('THEME_CSS', () => {
  it('makes the display scroll vertically and keeps text selectable in forms', () => {
    expect(THEME_CSS).toMatch(/\.expfw-display \{[^}]*overflow-y: auto/);
    expect(THEME_CSS).toMatch(/touch-action: pan-y/);
    expect(THEME_CSS).toMatch(/user-select: text/);
  });

  it('sets every survey colour variable as !important (the library writes its own onto its root element)', () => {
    const declarations = THEME_CSS.match(/^ {2}--sjs-[a-z0-9-]+: .*;$/gm) ?? [];
    expect(declarations.length).toBeGreaterThan(30);
    expect(declarations.filter((line) => !line.endsWith('!important;'))).toEqual([]);
  });

  it('uses one system font stack and no remote font', () => {
    expect(THEME_CSS).toMatch(/font-family: system-ui/);
    expect(THEME_CSS).not.toMatch(/https?:\/\/|@font-face|@import/);
  });

  it('has no light backgrounds: every colour set as a background is dark or transparent', () => {
    const backgrounds = [...THEME_CSS.matchAll(/(?:backcolor[a-z-]*|background[a-z-]*): ?(#[0-9a-f]{6}|transparent)/g)].map((m) => m[1]).filter((v) => v !== 'transparent');
    const light = backgrounds.filter((hex) => [1, 3, 5].every((i) => Number.parseInt(hex.slice(i, i + 2), 16) > 200));
    expect(backgrounds.length).toBeGreaterThan(3);
    expect(light).toEqual([]);
  });
});
