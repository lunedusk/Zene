import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type {
  BreakpointId,
  CompositionDocument,
  CompositionNode,
  Condition,
  DataBinding,
  JsonValue,
} from './types.js';
import { breakpointFromWidth } from './schema.js';
import { resolveNode, orderedChildren, type ResolvedNode } from './responsive.js';
import { themeTokensToCss } from './layoutStyle.js';
import { compositionRegistry } from './registry.js';
import { registerBuiltinComponents } from './builtins/index.js';
import {
  CompositionRuntimeProvider,
} from './context.js';

import {
  EMPTY_SESSION,
  type BindingResult,
  type CompositionActions,
  type CompositionRuntime,
  type NodeRenderProps,
  type RenderMode,
  type SessionView,
  type SubmitResult,
} from './runtime.js';
import { BindingStore } from './dataStore.js';

// Deterministic built-in registration for every renderer entry point.
registerBuiltinComponents();


export interface CompositionRendererProps {
  document: CompositionDocument;
  mode: RenderMode;
  session?: SessionView;
  breakpoint?: BreakpointId;
  actions?: Partial<CompositionActions>;
  initialLocalState?: Record<string, JsonValue>;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string, mode?: 'replace' | 'toggle') => void;
  onHoverNode?: (nodeId: string | null) => void;
  onSubmit?: (actionId: string, formData: FormData) => Promise<SubmitResult>;
  onNavigate?: (to: string) => void;
  bindingStore?: BindingStore;
  className?: string;
}

function useViewportBreakpoint(): BreakpointId {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return breakpointFromWidth(width);
}

class RenderBoundary extends Component<
  { nodeId: string; mode: RenderMode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (this.props.mode === 'editor' && typeof console !== 'undefined') {
      console.warn(`[composition] node ${this.props.nodeId} failed to render`, error, info.componentStack);
    }
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    if (this.props.mode === 'editor') {
      return (
        <div className="zc-render-error" role="alert" data-node-id={this.props.nodeId}>
          This component could not render.
        </div>
      );
    }
    // Preview/published: never silently erase content on a renderer throw.
    return (
      <div
        className="zc-unavailable"
        role="status"
        aria-label="Component unavailable"
        data-node-id={this.props.nodeId}
      >
        <span className="zc-unavailable-label">This component is unavailable.</span>
      </div>
    );
  }
}

function readPath(value: JsonValue | undefined, path: string | undefined): JsonValue | undefined {
  if (!path) return value;
  let current: JsonValue | undefined = value;
  for (const part of path.split('.')) {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, JsonValue>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function conditionValue(condition: Condition, runtime: CompositionRuntime): JsonValue | undefined {
  switch (condition.source) {
    case 'session': {
      const key = condition.key ?? 'authenticated';
      if (key === 'authenticated') return runtime.session.authenticated;
      if (key === 'isOwner') return runtime.session.isOwner;
      if (key === 'username') return runtime.session.username ?? '';
      if (key === 'userId') return runtime.session.userId ?? '';
      return undefined;
    }
    case 'state':
      return condition.key ? runtime.localState[condition.key] : undefined;
    case 'document':
      return readPath(
        {
          title: runtime.document.metadata?.title ?? runtime.document.name,
          description: runtime.document.metadata?.description ?? '',
          name: runtime.document.name,
        },
        condition.key,
      );
    case 'data': {
      if (!condition.provider) return undefined;
      const binding: DataBinding = {
        provider: condition.provider,
        resource: condition.resource,
        field: condition.field,
      };
      const result = runtime.binding(binding);
      return result.status === 'ready' ? result.value : undefined;
    }
    default:
      return undefined;
  }
}

export function evaluateConditions(
  conditions: readonly Condition[] | undefined,
  runtime: CompositionRuntime,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((condition) => {
    const value = conditionValue(condition, runtime);
    switch (condition.operator) {
      case 'exists':
        return value !== undefined && value !== null;
      case 'truthy':
        return Boolean(value);
      case 'falsy':
        return !value;
      case 'equals':
        return JSON.stringify(value) === JSON.stringify(condition.value);
      case 'not_equals':
        return JSON.stringify(value) !== JSON.stringify(condition.value);
      case 'in':
        return Array.isArray(condition.value) && condition.value.some((entry) => JSON.stringify(entry) === JSON.stringify(value));
      default:
        return true;
    }
  });
}

function resolveChildSlot(node: CompositionNode, slot: string, breakpoint: BreakpointId): CompositionNode[] {
  return orderedChildren(node, breakpoint, slot);
}

/**
 * Single renderer for editor, preview, and published output.
 * Modes only change affordances and interaction; document semantics are shared.
 */
export function CompositionRenderer({
  document,
  mode,
  session = EMPTY_SESSION,
  breakpoint,
  actions,
  initialLocalState,
  selectedNodeId,
  onSelectNode,
  onHoverNode,
  onSubmit,
  onNavigate,
  bindingStore,
  className,
}: CompositionRendererProps) {
  const storeRef = useRef<BindingStore | null>(null);
  if (!storeRef.current) storeRef.current = bindingStore ?? new BindingStore();
  const store = storeRef.current;
  const version = useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(listener), [store]),
    () => store.version,
    () => store.version,
  );

  const [localState, setLocalState] = useState<Record<string, JsonValue>>(initialLocalState ?? {});
  const autoBreakpoint = useViewportBreakpoint();
  const activeBreakpoint = breakpoint ?? autoBreakpoint;
  const interactive = mode !== 'editor';

  useEffect(() => {
    store.setSession(session);
  }, [store, session]);

  useEffect(() => {
    store.setDocument(document);
  }, [store, document]);

  const setLocalStateValue = useCallback((key: string, value: JsonValue) => {
    setLocalState((current) => ({ ...current, [key]: value }));
  }, []);

  const runtime = useMemo<CompositionRuntime>(() => {
    void version;
    return {
      mode,
      document,
      session,
      breakpoint: activeBreakpoint,
      binding: (binding: DataBinding | undefined): BindingResult => {
        const result = store.get(binding);
        if (result.status !== 'ready' || !binding?.field) return result;
        return { ...result, value: store.value(binding) };
      },
      localState,
      setLocalState: (key, value) => {
        if (!interactive) return;
        setLocalStateValue(key, value);
      },
      actions: {
        navigate: (to) => {
          if (!interactive) return;
          if (onNavigate) onNavigate(to);
          else if (typeof window !== 'undefined') window.location.assign(to);
        },
        external: (href) => {
          if (!interactive) return;
          if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer');
        },
        scrollTo: (nodeId) => {
          if (!interactive || typeof window === 'undefined') return;
          const selector = `[data-node-id="${nodeId.replace(/["\\]/g, '')}"]`;
          const el = window.document.querySelector(selector);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
        submit: async (actionId, formData) => {
          if (!interactive) return { ok: false, message: 'Submissions are disabled in the editor.' };
          if (onSubmit) return onSubmit(actionId, formData);
          return { ok: false, message: 'This form is not connected to a server action yet.' };
        },
        ...actions,
      },
      selectedNodeId: mode === 'editor' ? selectedNodeId : undefined,
      onSelectNode: mode === 'editor' ? onSelectNode : undefined,
      onHoverNode: mode === 'editor' ? onHoverNode : undefined,
      interactive,
    };
  }, [
    version,
    store,
    mode,
    document,
    session,
    activeBreakpoint,
    localState,
    setLocalStateValue,
    interactive,
    actions,
    selectedNodeId,
    onSelectNode,
    onHoverNode,
    onSubmit,
    onNavigate,
  ]);

  const renderNode = useCallback(
    (node: CompositionNode): ReactNode => {
      const def = compositionRegistry.get(node.type);
      if (!def) {
        if (mode === 'editor') {
          return (
            <div key={node.id} className="zc-render-error" data-node-id={node.id} role="alert">
              Unknown component “{node.type}”
            </div>
          );
        }
        return (
          <div
            key={node.id}
            className="zc-unavailable"
            data-node-id={node.id}
            role="status"
            aria-label="Component unavailable"
          >
            <span className="zc-unavailable-label">This component is unavailable.</span>
          </div>
        );
      }
      if (!evaluateConditions(node.conditions, runtime)) return null;
      const resolved = resolveNode(node, activeBreakpoint);
      if (resolved.hidden) return null;
      const Render = def.render as ((props: NodeRenderProps) => ReactNode) | undefined;
      if (!Render) {
        if (mode === 'editor') {
          return (
            <div key={node.id} className="zc-render-error" data-node-id={node.id} role="alert">
              Component “{node.type}” has no renderer
            </div>
          );
        }
        return (
          <div
            key={node.id}
            className="zc-unavailable"
            data-node-id={node.id}
            role="status"
            aria-label="Component unavailable"
          >
            <span className="zc-unavailable-label">This component is unavailable.</span>
          </div>
        );
      }
      const props: NodeRenderProps = {
        node,
        props: resolved.props,
        resolved,
        mode,
        runtime,
        children: (slot = 'default') => {
          const children = resolveChildSlot(node, slot, activeBreakpoint);
          return children.map((child) => renderNode(child));
        },
        hasChildren: (slot = 'default') => (node.slots[slot] ?? []).length > 0,
        a11yLabel: node.a11y?.label,
        headingLevel: node.a11y?.headingLevel ?? 2,
      };
      return (
        <RenderBoundary key={node.id} nodeId={node.id} mode={mode}>
          <Render {...props} />
        </RenderBoundary>
      );
    },
    [mode, runtime, activeBreakpoint],
  );

  const tokens = themeTokensToCss(document.theme?.tokens);
  const style = Object.keys(tokens).length > 0 ? { ...tokens } : undefined;

  return (
    <CompositionRuntimeProvider value={runtime}>
      <div
        className={`zc-surface zc-mode-${mode} ${className ?? ''}`.trim()}
        data-breakpoint={activeBreakpoint}
        data-mode={mode}
        data-document-id={document.id}
        data-color-mode={document.theme?.colorMode}
        style={style as unknown as CSSProperties | undefined}
      >
        {renderNode(document.root)}
      </div>
    </CompositionRuntimeProvider>
  );
}

/** Render exactly one node (used by isolated previews and the inspector). */
export function CompositionNodeView({
  node,
  document,
  mode = 'preview',
  breakpoint = 'desktop',
}: {
  node: CompositionNode;
  document: CompositionDocument;
  mode?: RenderMode;
  breakpoint?: BreakpointId;
}) {
  const isolated = useMemo<CompositionDocument>(() => ({ ...document, root: node }), [document, node]);
  return <CompositionRenderer document={isolated} mode={mode} breakpoint={breakpoint} />;
}

/** Keep the resolved node shape available to editor panels without re-resolving. */
export function resolveForBreakpoint(node: CompositionNode, breakpoint: BreakpointId): ResolvedNode {
  return resolveNode(node, breakpoint);
}
