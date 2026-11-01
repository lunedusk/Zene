import { createElement, type CSSProperties, type ReactNode } from 'react';
import type { LayoutConfig, StyleConfig } from './types.js';
import { layoutToCss, styleToCss, type CssMap } from './layoutStyle.js';
import { useCompositionRuntime } from './context.js';

type IntrinsicTag =
  | 'div'
  | 'section'
  | 'article'
  | 'header'
  | 'footer'
  | 'nav'
  | 'aside'
  | 'main'
  | 'ul'
  | 'ol'
  | 'li'
  | 'form'
  | 'figure'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'p'
  | 'span'
  | 'a'
  | 'img'
  | 'hr';

export interface NodeFrameProps {
  as?: IntrinsicTag;
  nodeId: string;
  className?: string;
  layout?: LayoutConfig;
  style?: StyleConfig;
  children?: ReactNode;
  role?: string;
  ariaLabel?: string;
  href?: string;
  target?: string;
  rel?: string;
  src?: string;
  alt?: string;
  headingLevel?: number;
  styleOverride?: CssMap;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * Applies canonical layout/style semantics to a semantic element.
 * Editor selection/hover affordances are attached here so they never alter
 * document data and never appear in preview/published output.
 */
export function NodeFrame({
  as = 'div',
  nodeId,
  className,
  layout,
  style,
  children,
  role,
  ariaLabel,
  href,
  target,
  rel,
  src,
  alt,
  onClick,
  onSubmit,
  styleOverride,
}: NodeFrameProps) {
  const runtime = useCompositionRuntime();
  const editor = runtime.mode === 'editor';
  const css: CSSProperties = {
    ...(layoutToCss(layout) as CSSProperties),
    ...(styleToCss(style) as CSSProperties),
    ...(styleOverride as CSSProperties | undefined),
  };
  const props: Record<string, unknown> = {
    'data-node-id': nodeId,
    'data-layout': layout?.mode,
    className: `zc-node ${className ?? ''}`.trim(),
    style: css,
    role,
    'aria-label': ariaLabel,
    href,
    target,
    rel,
    src,
    alt,
  };
  if (editor) {
    props['data-zc-editor'] = 'true';
    const selected =
      runtime.selectedNodeIds?.includes(nodeId) === true ||
      runtime.selectedNodeId === nodeId;
    props['data-selected'] = selected ? 'true' : undefined;
    props['onPointerDown'] = (event: React.PointerEvent<HTMLElement>) => {
      event.stopPropagation();
      runtime.onSelectNode?.(nodeId, event.shiftKey ? 'toggle' : 'replace');
    };
    props['onMouseEnter'] = () => runtime.onHoverNode?.(nodeId);
    props['onMouseLeave'] = () => runtime.onHoverNode?.(null);
    props['tabIndex'] = -1;
  }
  if (onClick) props['onClick'] = onClick;
  if (onSubmit) props['onSubmit'] = onSubmit;
  return createElement(as, props, children);
}
