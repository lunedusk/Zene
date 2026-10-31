import type { Dimension, LayoutConfig, StyleConfig } from './types.js';

export type CssValue = string | number;
export type CssMap = Record<string, CssValue>;

const COLOR_TOKENS = new Set([
  'bg',
  'fg',
  'muted',
  'surface',
  'surface-2',
  'border',
  'accent',
  'accent-fg',
  'success',
  'warning',
  'danger',
  'info',
]);

/** Resolve a semantic token name to its Zene CSS variable; pass through raw colors. */
export function resolveColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (v.startsWith('--')) return `var(${v})`;
  if (COLOR_TOKENS.has(v)) return `var(--color-${v})`;
  if (/^[a-zA-Z0-9#(),.%\s-]{1,80}$/.test(v)) return v;
  return undefined;
}

export function dimensionToCss(dim: Dimension | undefined): CssValue | undefined {
  if (!dim) return undefined;
  const unit = dim.unit ?? 'px';
  switch (dim.mode) {
    case 'auto':
      return 'auto';
    case 'content':
      return 'max-content';
    case 'fill':
      return '100%';
    case 'fixed':
      if (typeof dim.value !== 'number' || !Number.isFinite(dim.value)) return undefined;
      return `${Math.max(0, dim.value)}${unit}`;
    default:
      return undefined;
  }
}

function spacingToCss(
  value: { top?: number; right?: number; bottom?: number; left?: number } | undefined,
): string | undefined {
  if (!value) return undefined;
  const parts = [value.top, value.right, value.bottom, value.left];
  if (parts.every((p) => p === undefined)) return undefined;
  return parts.map((p) => `${Math.max(0, p ?? 0)}px`).join(' ');
}

export function layoutToCss(layout: LayoutConfig | undefined): CssMap {
  const css: CssMap = {};
  if (!layout) return css;
  switch (layout.mode) {
    case 'stack':
      css.display = 'flex';
      css.flexDirection = 'column';
      break;
    case 'row':
      css.display = 'flex';
      css.flexDirection = 'row';
      break;
    case 'grid':
      css.display = 'grid';
      break;
    case 'split':
      css.display = 'grid';
      css.gridTemplateColumns = `${Math.round((layout.ratio ?? 0.5) * 100)}fr ${Math.round((1 - (layout.ratio ?? 0.5)) * 100)}fr`;
      break;
    case 'overlay':
      css.display = 'grid';
      css.gridTemplateColumns = 'minmax(0, 1fr)';
      css.gridTemplateRows = 'minmax(0, 1fr)';
      break;
    case 'flow':
    default:
      css.display = 'block';
      break;
  }
  if (layout.mode === 'grid') {
    css.gridTemplateColumns = `repeat(${Math.max(1, Math.min(24, layout.columns ?? 1))}, minmax(0, 1fr))`;
    if (layout.rows !== undefined) {
      css.gridTemplateRows = `repeat(${Math.max(1, Math.min(24, layout.rows))}, minmax(0, auto))`;
    }
    if (layout.columnGap !== undefined) css.columnGap = `${Math.max(0, layout.columnGap)}px`;
    if (layout.rowGap !== undefined) css.rowGap = `${Math.max(0, layout.rowGap)}px`;
  }
  if (layout.gap !== undefined) css.gap = `${Math.max(0, layout.gap)}px`;
  if (layout.wrap !== undefined && (layout.mode === 'row')) css.flexWrap = layout.wrap ? 'wrap' : 'nowrap';
  if (layout.alignItems) css.alignItems = layout.alignItems;
  if (layout.justify) css.justifyContent = layout.justify;
  if (layout.spans?.column) css.gridColumn = `span ${Math.max(1, layout.spans.column)}`;
  if (layout.spans?.row) css.gridRow = `span ${Math.max(1, layout.spans.row)}`;
  if (layout.place?.column) css.gridColumnStart = Math.max(1, layout.place.column);
  if (layout.place?.row) css.gridRowStart = Math.max(1, layout.place.row);
  if (layout.mode === 'overlay') {
    css.gridArea = '1 / 1 / 2 / 2';
  }
  const width = dimensionToCss(layout.width);
  if (width !== undefined) css.width = width;
  const height = dimensionToCss(layout.height);
  if (height !== undefined) css.height = height;
  const minWidth = dimensionToCss(layout.minWidth);
  if (minWidth !== undefined) css.minWidth = minWidth;
  const maxWidth = dimensionToCss(layout.maxWidth);
  if (maxWidth !== undefined) css.maxWidth = maxWidth;
  const minHeight = dimensionToCss(layout.minHeight);
  if (minHeight !== undefined) css.minHeight = minHeight;
  const maxHeight = dimensionToCss(layout.maxHeight);
  if (maxHeight !== undefined) css.maxHeight = maxHeight;
  if (layout.grow !== undefined) css.flexGrow = Math.max(0, layout.grow);
  if (layout.shrink !== undefined) css.flexShrink = Math.max(0, layout.shrink);
  const basis = dimensionToCss(layout.basis);
  if (basis !== undefined) css.flexBasis = basis;
  if (layout.overflow) css.overflow = layout.overflow;
  if (layout.position) css.position = layout.position;
  if (layout.offsets) {
    if (layout.offsets.top !== undefined) css.top = `${layout.offsets.top}px`;
    if (layout.offsets.right !== undefined) css.right = `${layout.offsets.right}px`;
    if (layout.offsets.bottom !== undefined) css.bottom = `${layout.offsets.bottom}px`;
    if (layout.offsets.left !== undefined) css.left = `${layout.offsets.left}px`;
  }
  if (layout.zIndex !== undefined) css.zIndex = layout.zIndex;
  if (layout.aspectRatio) css.aspectRatio = layout.aspectRatio;
  if (layout.order !== undefined) css.order = layout.order;
  const padding = spacingToCss(layout.padding);
  if (padding) css.padding = padding;
  const margin = spacingToCss(layout.margin);
  if (margin) css.margin = margin;
  if (layout.fullBleed) {
    css.width = '100vw';
    css.marginLeft = 'calc(50% - 50vw)';
    css.marginRight = 'calc(50% - 50vw)';
  }
  return css;
}

export function styleToCss(style: StyleConfig | undefined): CssMap {
  const css: CssMap = {};
  if (!style) return css;
  const bg = style.background;
  if (bg && bg.kind !== 'none') {
    if (bg.kind === 'color' && bg.color) {
      const c = resolveColor(bg.color);
      if (c) css.background = c;
    } else if (bg.kind === 'gradient' && bg.gradient) {
      if (/^[a-zA-Z0-9#(),.%\s-]{1,200}$/.test(bg.gradient)) css.background = bg.gradient;
    } else if (bg.kind === 'image' && bg.imageUrl) {
      const overlay = bg.overlay ? resolveColor(bg.overlay) : undefined;
      const image = `url("${bg.imageUrl.replace(/"/g, '%22')}")`;
      css.backgroundImage = overlay ? `linear-gradient(${overlay}, ${overlay}), ${image}` : image;
      css.backgroundSize = bg.size ?? 'cover';
      css.backgroundPosition = bg.position ?? 'center';
      css.backgroundRepeat = 'no-repeat';
    }
  }
  if (style.color) {
    const c = resolveColor(style.color);
    if (c) css.color = c;
  }
  if (style.fontFamily) {
    css.fontFamily =
      style.fontFamily === 'sans'
        ? 'var(--font-sans)'
        : style.fontFamily === 'mono'
          ? 'var(--font-mono)'
          : style.fontFamily === 'serif'
            ? 'ui-serif, Georgia, serif'
            : style.fontFamily.slice(0, 80);
  }
  if (style.fontSize !== undefined) css.fontSize = `${Math.max(8, Math.min(160, style.fontSize))}px`;
  if (style.fontWeight !== undefined) css.fontWeight = Math.max(100, Math.min(900, style.fontWeight));
  if (style.lineHeight !== undefined) css.lineHeight = Math.max(0.8, Math.min(3, style.lineHeight));
  if (style.letterSpacing !== undefined) css.letterSpacing = `${style.letterSpacing}px`;
  if (style.textAlign) css.textAlign = style.textAlign;
  if (style.border) {
    const b = style.border;
    if (b.style && b.style !== 'none') {
      css.border = `${Math.max(0, b.width ?? 1)}px ${b.style} ${resolveColor(b.color) ?? 'var(--color-border)'}`;
    }
  }
  if (style.radius !== undefined) css.borderRadius = `${Math.max(0, style.radius)}px`;
  if (style.shadow && style.shadow !== 'none') {
    css.boxShadow = style.shadow === 'lg' ? 'var(--shadow-lg, var(--shadow-md))' : `var(--shadow-${style.shadow})`;
  }
  if (style.opacity !== undefined) css.opacity = Math.max(0, Math.min(1, style.opacity));
  if (style.blur !== undefined && style.blur > 0) {
    css.backdropFilter = `blur(${Math.max(0, Math.min(40, style.blur))}px)`;
  }
  if (style.stickyTop !== undefined) {
    css.position = 'sticky';
    css.top = `${style.stickyTop}px`;
  }
  return css;
}

export function themeTokensToCss(tokens: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens ?? {})) {
    if (!/^--[a-zA-Z0-9-]{1,60}$/.test(key)) continue;
    if (typeof value !== 'string' || value.length > 120) continue;
    out[key] = value;
  }
  return out;
}
