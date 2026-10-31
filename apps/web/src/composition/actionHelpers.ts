import type { CompositionNode, Interaction } from './types.js';
import type { CompositionRuntime } from './runtime.js';

export function interactionFor(
  node: CompositionNode,
  trigger: Interaction['trigger'],
): Interaction | undefined {
  return node.interactions?.find((i) => i.trigger === trigger);
}

export function dispatchInteraction(
  runtime: CompositionRuntime,
  interaction: Interaction | undefined,
): boolean {
  if (!interaction || !runtime.interactive) return false;
  const action = interaction.action;
  switch (action.kind) {
    case 'navigate':
      runtime.actions.navigate(action.to);
      return true;
    case 'external':
      runtime.actions.external(action.href);
      return true;
    case 'scroll-to':
      runtime.actions.scrollTo(action.nodeId);
      return true;
    case 'set-state':
      runtime.setLocalState(action.key, action.value);
      return true;
    case 'submit-action':
      // Submit interactions require a form submit event.
      return false;
    default:
      return false;
  }
}

export function interactionClickHandler(
  runtime: CompositionRuntime,
  node: CompositionNode,
): ((event: React.MouseEvent<HTMLElement>) => void) | undefined {
  const interaction = interactionFor(node, 'click');
  if (!interaction || !runtime.interactive) return undefined;
  return (event: React.MouseEvent<HTMLElement>) => {
    const action = interaction.action;
    if (action.kind === 'navigate' || action.kind === 'external' || action.kind === 'scroll-to') {
      event.preventDefault();
    }
    dispatchInteraction(runtime, interaction);
  };
}
