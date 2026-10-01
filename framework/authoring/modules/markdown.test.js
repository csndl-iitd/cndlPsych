import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdown.js';

describe('markdownToHtml', () => {
  it.each([
    ['# Title', '<h1>Title</h1>'],
    ['### Small', '<h3>Small</h3>'],
    ['one\ntwo', '<p>one two</p>'],
    ['a\n\nb', '<p>a</p>\n<p>b</p>'],
    ['**bold** and *it*', '<p><strong>bold</strong> and <em>it</em></p>'],
    ['- a\n- b', '<ul><li>a</li><li>b</li></ul>'],
    ['* a\n* b', '<ul><li>a</li><li>b</li></ul>'],
    ['1. a\n2) b', '<ol><li>a</li><li>b</li></ol>'],
    ['text\n- item', '<p>text</p>\n<ul><li>item</li></ul>'],
    ['- a\n\nafter', '<ul><li>a</li></ul>\n<p>after</p>'],
    ['[site](https://example.org/x?y=1)', '<p><a href="https://example.org/x?y=1" target="_blank" rel="noopener noreferrer">site</a></p>'],
    ['a\r\nb', '<p>a b</p>'],
    ['', ''],
  ])('%j', (markdown, expected) => {
    expect(markdownToHtml(markdown)).toBe(expected);
  });

  it('never lets author text inject markup or script', () => {
    const html = markdownToHtml('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n**<img src=x onerror=alert(1)>**');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('&lt;script&gt;');
  });

  it('switches between list kinds', () => {
    expect(markdownToHtml('- a\n1. b')).toBe(['<ul><li>a</li></ul>', '<ol><li>b</li></ol>'].join('\n'));
  });
});
