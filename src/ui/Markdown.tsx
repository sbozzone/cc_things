'use client';

import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/core/markdown';

/**
 * Renders note markdown as React elements (R27).
 *
 * Nothing is ever inserted as HTML, so formatting cannot execute embedded markup, and
 * the underlying source stays exactly as the user typed it.
 */

function renderInline(nodes: Inline[], keyPrefix = ''): ReactNode {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}${index}`;
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{node.value}</Fragment>;
      case 'strong':
        return <strong key={key} className="font-semibold">{renderInline(node.children, `${key}.`)}</strong>;
      case 'em':
        return <em key={key}>{renderInline(node.children, `${key}.`)}</em>;
      case 'strike':
        return <s key={key} className="text-muted">{renderInline(node.children, `${key}.`)}</s>;
      case 'mark':
        return <mark key={key} className="rounded bg-[var(--accent-soft)] px-0.5 text-ink">{renderInline(node.children, `${key}.`)}</mark>;
      case 'code':
        return <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">{node.value}</code>;
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {renderInline(node.children, `${key}.`)}
          </a>
        );
    }
  });
}

function renderBlock(block: Block, index: number): ReactNode {
  const key = `b${index}`;
  switch (block.type) {
    case 'heading': {
      const sizes = { 1: 'text-[17px]', 2: 'text-[15px]', 3: 'text-[14px]' } as const;
      const Tag = (['h3', 'h4', 'h5'] as const)[block.level - 1] ?? 'h4';
      return <Tag key={key} className={`mt-2 font-semibold ${sizes[block.level]}`}>{renderInline(block.children, `${key}.`)}</Tag>;
    }
    case 'paragraph':
      return <p key={key} className="whitespace-pre-wrap">{renderInline(block.children, `${key}.`)}</p>;
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-line-strong pl-3 text-muted">
          {renderInline(block.children, `${key}.`)}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre key={key} className="overflow-x-auto rounded-md bg-surface-2 p-2 font-mono text-[12.5px] scroll-area">
          <code>{block.value}</code>
        </pre>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag key={key} className={`ml-4 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, i) => <li key={i}>{renderInline(item, `${key}.${i}.`)}</li>)}
        </Tag>
      );
    }
    case 'taskList':
      return (
        <ul key={key} className="ml-1 space-y-0.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              {/* Markdown task text is presentation only; it is not a checklist record. */}
              <span aria-hidden="true" className="mt-[3px] text-muted">{item.checked ? '☑' : '☐'}</span>
              <span className={item.checked ? 'text-muted line-through' : ''}>{renderInline(item.children, `${key}.${i}.`)}</span>
            </li>
          ))}
        </ul>
      );
  }
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  if (source.trim().length === 0) return null;
  const blocks = parseMarkdown(source);
  return <div className={`space-y-1.5 text-[14px] leading-relaxed ${className}`}>{blocks.map(renderBlock)}</div>;
}
