import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref, toPlainText } from '../markdown';

describe('note formatting (R27)', () => {
  it('parses the supported inline styles', () => {
    expect(parseInline('a **bold** b')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' b' },
    ]);
    expect(parseInline('~~gone~~')[0]?.type).toBe('strike');
    expect(parseInline('==note==')[0]?.type).toBe('mark');
    expect(parseInline('*soft*')[0]?.type).toBe('em');
    expect(parseInline('`code`')[0]).toEqual({ type: 'code', value: 'code' });
  });

  it('parses blocks', () => {
    const blocks = parseMarkdown('# Title\n\n- one\n- two\n\n> quoted\n\n```\nraw\n```');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'quote', 'codeBlock']);
  });

  it('keeps markdown task-list text separate from checklist records', () => {
    const blocks = parseMarkdown('- [x] done\n- [ ] todo');
    expect(blocks[0]?.type).toBe('taskList');
    if (blocks[0]?.type === 'taskList') {
      expect(blocks[0].items.map((i) => i.checked)).toEqual([true, false]);
    }
  });

  it('never produces a link for an unsafe scheme', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('https://example.com')).toBe('https://example.com');

    const parsed = parseInline('[click](javascript:alert(1))');
    expect(parsed.every((n) => n.type !== 'link')).toBe(true);
  });

  it('treats raw HTML as literal text, never as markup', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>');
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', value: '<script>alert(1)</script>' }] },
    ]);
  });

  it('preserves the source for round-tripping', () => {
    const source = '# Heading\n\nSome **bold** text with a [link](https://example.com).';
    expect(toPlainText(source)).toContain('link (https://example.com)');
  });
});
