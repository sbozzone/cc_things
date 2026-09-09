/**
 * Markdown styling for notes (R27).
 *
 * The parser produces a token tree that the UI renders as React elements. Raw HTML is
 * never interpreted, so formatting can never execute embedded HTML or script — the
 * source text is preserved verbatim for editing and export.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'mark'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'quote'; children: Inline[] }
  | { type: 'codeBlock'; value: string }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  /** Markdown task-list text renders as text; it never becomes a checklist record. */
  | { type: 'taskList'; items: { checked: boolean; children: Inline[] }[] };

const SAFE_SCHEME = /^(https?:|mailto:|tel:)/i;

/** Only well-known schemes survive, so `javascript:` links cannot be produced. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (SAFE_SCHEME.test(trimmed)) return trimmed;
  if (/^[\w.-]+@[\w.-]+\.\w+$/.test(trimmed)) return `mailto:${trimmed}`;
  if (/^\//.test(trimmed)) return trimmed;
  return null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer.length > 0) {
      out.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };

  const pairs = [['**', 'strong'], ['~~', 'strike'], ['==', 'mark']] as const;
  let i = 0;

  while (i < text.length) {
    const rest = text.slice(i);

    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flush();
      out.push({ type: 'code', value: code[1] as string });
      i += code[0].length;
      continue;
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (link) {
      flush();
      const href = safeHref(link[2] as string);
      // An unsupported scheme is shown as literal source rather than becoming a link.
      if (href) out.push({ type: 'link', href, children: parseInline(link[1] as string) });
      else out.push({ type: 'text', value: link[0] });
      i += link[0].length;
      continue;
    }

    const bare = /^(https?:\/\/[^\s<>()]+)/.exec(rest);
    if (bare) {
      const href = safeHref(bare[1] as string);
      if (href) {
        flush();
        out.push({ type: 'link', href, children: [{ type: 'text', value: bare[1] as string }] });
        i += bare[0].length;
        continue;
      }
    }

    let matched = false;
    for (const [marker, type] of pairs) {
      if (!rest.startsWith(marker)) continue;
      const end = rest.indexOf(marker, marker.length);
      if (end <= marker.length) continue;
      flush();
      out.push({ type, children: parseInline(rest.slice(marker.length, end)) } as Inline);
      i += end + marker.length;
      matched = true;
      break;
    }
    if (matched) continue;

    for (const ch of ['*', '_']) {
      if (rest[0] !== ch) continue;
      const second = rest[1];
      if (second === undefined || /\s/.test(second) || second === ch) continue;
      const end = rest.indexOf(ch, 1);
      if (end <= 1) continue;
      flush();
      out.push({ type: 'em', children: parseInline(rest.slice(1, end)) });
      i += end + 1;
      matched = true;
      break;
    }
    if (matched) continue;

    buffer += text[i];
    i += 1;
  }
  flush();
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    if (line.trim().startsWith('```')) {
      flushParagraph();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] as string).trim().startsWith('```')) {
        body.push(lines[i] as string);
        i += 1;
      }
      blocks.push({ type: 'codeBlock', value: body.join('\n') });
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: (heading[1] as string).length as 1 | 2 | 3,
        children: parseInline(heading[2] as string),
      });
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      blocks.push({ type: 'quote', children: parseInline(quote[1] as string) });
      continue;
    }

    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      flushParagraph();
      const items: { checked: boolean; children: Inline[] }[] = [
        { checked: (task[1] as string).toLowerCase() === 'x', children: parseInline(task[2] as string) },
      ];
      while (i + 1 < lines.length) {
        const next = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(lines[i + 1] as string);
        if (!next) break;
        items.push({ checked: (next[1] as string).toLowerCase() === 'x', children: parseInline(next[2] as string) });
        i += 1;
      }
      blocks.push({ type: 'taskList', items });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      const items: Inline[][] = [parseInline(((bullet ?? ordered) as RegExpExecArray)[1] as string)];
      while (i + 1 < lines.length) {
        const nextLine = lines[i + 1] as string;
        const next = isOrdered ? /^\s*\d+[.)]\s+(.*)$/.exec(nextLine) : /^\s*[-*+]\s+(.*)$/.exec(nextLine);
        if (!next || /^\s*[-*]\s+\[([ xX])\]/.test(nextLine)) break;
        items.push(parseInline(next[1] as string));
        i += 1;
      }
      blocks.push({ type: 'list', ordered: isOrdered, items });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

/** Plain-text rendering used by the human-readable export and email ingestion. */
export function toPlainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
    .replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/[*_~=`#>]/g, '')
    .trim();
}
