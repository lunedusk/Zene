

export type VisibilityLeaf =
  | { type: 'bit'; bit: string }
  | { type: 'owner' }
  | { type: 'authenticated' }
  | { type: 'featureFlag'; flag: string };

export type VisibilityExpr =
  | VisibilityLeaf
  | { type: 'and'; of: VisibilityExpr[] }
  | { type: 'or'; of: VisibilityExpr[] }
  | { type: 'not'; of: VisibilityExpr };

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  section?: 'global' | 'server' | 'owner' | 'plugin' | 'account';
  order?: number;
  icon?: string;
  visibility?: VisibilityExpr;
  requiredCapability?: string;
  requiredBit?: string;
  requiredPlugin?: string;
  children?: NavigationItem[];
  badge?: string;
  context?: 'global' | 'guild' | 'owner';
}

export interface VisibilityContext {
  authenticated: boolean;
  isOwner: boolean;
  bits: ReadonlySet<string>;
  featureFlags?: ReadonlySet<string>;
}

export function evalVisibility(expr: VisibilityExpr | undefined, ctx: VisibilityContext): boolean {
  if (!expr) return true;
  switch (expr.type) {
    case 'authenticated':
      return ctx.authenticated;
    case 'owner':
      return ctx.isOwner || ctx.bits.has('bot.owner');
    case 'bit':
      return ctx.isOwner || ctx.bits.has('bot.owner') || ctx.bits.has(expr.bit);
    case 'featureFlag':
      return ctx.featureFlags?.has(expr.flag) === true;
    case 'and':
      return expr.of.every((e) => evalVisibility(e, ctx));
    case 'or':
      return expr.of.some((e) => evalVisibility(e, ctx));
    case 'not':
      return !evalVisibility(expr.of, ctx);
    default:
      return false;
  }
}

export function filterNavigation(items: NavigationItem[], ctx: VisibilityContext): NavigationItem[] {
  return items
    .filter((item) => {
      if (item.requiredBit && !evalVisibility({ type: 'bit', bit: item.requiredBit }, ctx)) return false;
      if (item.visibility && !evalVisibility(item.visibility, ctx)) return false;
      if (!ctx.authenticated && item.section !== undefined && item.section !== 'global') return false;
      return true;
    })
    .map((item) => ({
      ...item,
      children: item.children ? filterNavigation(item.children, ctx) : undefined,
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
