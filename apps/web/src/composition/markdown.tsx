import type { ReactNode } from 'react';

const SAFE_LINK = /^(https?:\/\/|\/|#|mailto:)/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Tokenize **bold**, *italic*, `code`, [label](href)
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*')) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const label = linkMatch?.[1] ?? token;
      const href = linkMatch?.[2] ?? '#';
      nodes.push(
        SAFE_LINK.test(href) ? (
          <a key={key} href={href} rel={href.startsWith('http') ? 'noreferrer noopener' : undefined}>
            {label}
          </a>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/**
 * Safe markdown subset. Never uses dangerouslySetInnerHTML and never emits
 * raw HTML. Supports paragraphs, bullet lists, headings, inline emphasis,
 * inline code, and safe links.
 */
export function renderMarkdown(source: string, keyPrefix = 'md'): ReactNode {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listOrdered = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ');
    blocks.push(<p key={`${keyPrefix}-p-${blocks.length}`}>{inline(text, `${keyPrefix}-${blocks.length}`)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    const items = list.map((item, i) => <li key={`${keyPrefix}-li-${blocks.length}-${i}`}>{inline(item, `${keyPrefix}-${blocks.length}-${i}`)}</li>);
    blocks.push(listOrdered ? <ol key={`${keyPrefix}-ol-${blocks.length}`}>{items}</ol> : <ul key={`${keyPrefix}-ul-${blocks.length}`}>{items}</ul>);
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 2;
      const content = heading[2] ?? '';
      const Tag = (`h${Math.min(6, level + 1)}`) as 'h2' | 'h3' | 'h4' | 'h5';
      blocks.push(<Tag key={`${keyPrefix}-h-${blocks.length}`}>{inline(content, `${keyPrefix}-h-${blocks.length}`)}</Tag>);
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      flushParagraph();
      const nextOrdered = Boolean(ordered);
      if (list.length > 0 && nextOrdered !== listOrdered) flushList();
      listOrdered = nextOrdered;
      list.push((bullet?.[1] ?? ordered?.[1] ?? '').trim());
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return <>{blocks}</>;
}

export function stripMarkdown(source: string): string {
  return escapeHtml(
    source
      .replace(/[*_`#>]/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .trim(),
  );
}
