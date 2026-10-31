import type { ComponentDefinition, RuntimeState } from '../types.js';
import { NodeFrame } from '../NodeFrame.js';
import type { NodeRenderProps } from '../runtime.js';
import { asString } from './define.js';

function stateComponent(input: {
  key: string;
  name: string;
  description: string;
  state: RuntimeState;
  title: string;
  keywords: readonly string[];
}): ComponentDefinition {
  return {
    type: `states.${input.key}`,
    version: 1,
    name: input.name,
    description: input.description,
    category: 'states',
    keywords: input.keywords,
    defaults: { title: input.title, description: '', actionLabel: '' },
    schema: [
      { key: 'title', label: 'Title', group: 'content', control: 'text', required: true },
      { key: 'description', label: 'Description', group: 'content', control: 'textarea' },
      { key: 'actionLabel', label: 'Action label', group: 'content', control: 'text', description: 'Optional retry or recovery affordance.' },
    ],
    slots: [],
    layoutModes: ['flow'],
    responsive: true,
    source: 'builtin',
    render: ({ node, props, resolved, runtime }: NodeRenderProps) => {
      const actionLabel = asString(props.actionLabel);
      return (
        <NodeFrame
          nodeId={node.id}
          layout={resolved.layout}
          style={resolved.style}
          className={`zc-state-block zc-state-${input.state}`}
          role="status"
          ariaLabel={node.a11y?.label ?? asString(props.title)}
        >
          {input.state === 'loading' ? <span className="zc-spinner" aria-hidden /> : null}
          <p className="zc-state-title">{asString(props.title, input.title)}</p>
          {asString(props.description) ? <p className="zc-state-description">{asString(props.description)}</p> : null}
          {actionLabel ? (
            <button
              type="button"
              className="zc-button zc-button-secondary"
              disabled={!runtime.interactive}
              onClick={() => {
                if (input.state === 'loading' || input.state === 'reconnecting') return;
                runtime.actions.navigate(runtime.document.surface.route ?? '/');
              }}
            >
              {actionLabel}
            </button>
          ) : null}
        </NodeFrame>
      );
    },
  };
}

export const stateComponents: ComponentDefinition[] = [
  stateComponent({
    key: 'empty',
    name: 'Empty state',
    description: 'Explains that there is nothing to show and what to do next.',
    state: 'empty',
    title: 'Nothing here yet',
    keywords: ['empty', 'blank', 'nothing', 'state'],
  }),
  stateComponent({
    key: 'loading',
    name: 'Loading state',
    description: 'Announced progress placeholder for asynchronous regions.',
    state: 'loading',
    title: 'Loading…',
    keywords: ['loading', 'progress', 'spinner', 'state'],
  }),
  stateComponent({
    key: 'error',
    name: 'Error state',
    description: 'Recoverable failure message with an optional retry affordance.',
    state: 'error',
    title: 'Something went wrong',
    keywords: ['error', 'failure', 'retry', 'state'],
  }),
  stateComponent({
    key: 'unavailable',
    name: 'Unavailable state',
    description: 'Indicates a feature or data source is temporarily unavailable.',
    state: 'unavailable',
    title: 'Temporarily unavailable',
    keywords: ['unavailable', 'offline', 'state'],
  }),
  stateComponent({
    key: 'reconnecting',
    name: 'Reconnecting state',
    description: 'Indicates a live connection is being re-established.',
    state: 'reconnecting',
    title: 'Reconnecting…',
    keywords: ['reconnecting', 'offline', 'live', 'state'],
  }),
  stateComponent({
    key: 'denied',
    name: 'Access denied state',
    description: 'Explains that the current viewer lacks access without leaking detail.',
    state: 'denied',
    title: 'You do not have access',
    keywords: ['denied', 'forbidden', 'access', 'state'],
  }),
  stateComponent({
    key: 'disabled',
    name: 'Disabled state',
    description: 'Explains that a capability is turned off.',
    state: 'disabled',
    title: 'Not enabled',
    keywords: ['disabled', 'off', 'state'],
  }),
  stateComponent({
    key: 'success',
    name: 'Success state',
    description: 'Confirms a completed action or resolved state.',
    state: 'success',
    title: 'All set',
    keywords: ['success', 'done', 'confirmation', 'state'],
  }),
];
