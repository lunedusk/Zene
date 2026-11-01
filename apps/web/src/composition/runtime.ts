import type { ReactNode } from 'react';
import type {
  CompositionDocument,
  CompositionNode,
  DataBinding,
  Interaction,
  JsonValue,
} from './types.js';
import type { ResolvedNode } from './responsive.js';

export type RenderMode = 'editor' | 'preview' | 'published';

export interface SessionView {
  authenticated: boolean;
  isOwner: boolean;
  userId?: string;
  username?: string;
  bits: ReadonlySet<string>;
}

export interface BindingResult {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  value?: JsonValue;
  error?: string;
}

export interface SubmitResult {
  ok: boolean;
  message?: string;
}

export interface CompositionActions {
  navigate(to: string): void;
  external(href: string): void;
  scrollTo(nodeId: string): void;
  submit(actionId: string, formData: FormData): Promise<SubmitResult>;
}

export interface CompositionRuntime {
  mode: RenderMode;
  document: CompositionDocument;
  session: SessionView;
  breakpoint: 'desktop' | 'tablet' | 'mobile';
  /** Resolve an approved binding. Triggers load on first read. */
  binding(binding: DataBinding | undefined): BindingResult;
  localState: Record<string, JsonValue>;
  setLocalState(key: string, value: JsonValue): void;
  actions: CompositionActions;
  /** Editor-only: primary selected node (first in selection). */
  selectedNodeId?: string;
  /** Editor-only: all selected node ids. */
  selectedNodeIds?: readonly string[];
  /** Editor-only: selection callback used by NodeFrame. */
  onSelectNode?: (nodeId: string, mode?: 'replace' | 'toggle') => void;
  /** Editor-only: hover callback used for layer highlighting. */
  onHoverNode?: (nodeId: string | null) => void;
  /** True when interactive behavior should run (preview/published). */
  interactive: boolean;
}

export interface NodeRenderProps {
  node: CompositionNode;
  props: CompositionNode['props'];
  resolved: ResolvedNode;
  mode: RenderMode;
  runtime: CompositionRuntime;
  /** Render a child slot. Defaults to `default`. */
  children(slot?: string): ReactNode;
  /** True when the node has children in the given slot. */
  hasChildren(slot?: string): boolean;
  /** Accessibility helper derived from node.a11y. */
  a11yLabel?: string;
  /** Node heading level for semantic headings. */
  headingLevel: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface BuiltinRenderComponent {
  (props: NodeRenderProps): ReactNode;
}

export type InteractionDispatch = (interaction: Interaction) => void;

export const EMPTY_SESSION: SessionView = {
  authenticated: false,
  isOwner: false,
  bits: new Set<string>(),
};
