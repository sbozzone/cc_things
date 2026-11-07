import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown } from '../markdown';
import { Markdown } from '@/ui/Markdown';

const shed = '| Specification | Feet | Inches |\n|----------------|------|--------|\n| Exterior Width | 5.8 | 69.6" |\n| Interior Width | 5.2 | 62.4" |';

describe('Markdown note tables', () => {
  it('renders the shed dimensions as a table with semantic headers', () => {
    const blocks = parseMarkdown(shed);
    expect(blocks[0]?.type).toBe('table');
    const html = renderToStaticMarkup(createElement(Markdown, { source: shed }));
    expect(html).toContain('<table');
    expect(html.match(/scope="col"/g)).toHaveLength(3);
    expect(html).toContain('Exterior Width');
    expect(html).toContain('69.6&quot;');
    expect(html).not.toContain('----------------');
  });

  it('supports alignment, escaped pipes, inline formatting and incomplete rows', () => {
    const table = parseMarkdown('Name | Size | Count\n:--- | :---: | ---:\n**A** \\| B | 5\nC | 6 | 2 | extra')[0];
    expect(table?.type).toBe('table');
    if (table?.type !== 'table') return;
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.rows[0]![0]![0]!.type).toBe('strong');
    expect(table.rows[0]![0]![1]).toEqual({ type: 'text', value: ' | B' });
    expect(table.rows[0]![2]).toEqual([]);
    expect(table.rows[1]).toHaveLength(3);
  });

  it('keeps code fences and malformed tables literal, and never interprets HTML', () => {
    expect(parseMarkdown('```\n' + shed + '\n```')[0]?.type).toBe('codeBlock');
    expect(parseMarkdown('A | B\n--- | not a divider')[0]?.type).toBe('paragraph');
    const html = renderToStaticMarkup(createElement(Markdown, { source: '| Header |\n| --- |\n| <script>alert(1)</script> |' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
