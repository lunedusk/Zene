import type { ComponentDefinition } from '../types.js';
import { ComponentRegistry, builtinRegistry } from '../registry.js';
import { structureComponents } from './structure.js';
import { contentComponents } from './content.js';
import { navigationComponents } from './navigation.js';
import { formComponents } from './forms.js';
import { dataComponents } from './data.js';
import { stateComponents } from './states.js';

/** Every first-party component definition, in registration order. */
export const builtinComponentDefinitions: readonly ComponentDefinition[] = [
  ...structureComponents,
  ...contentComponents,
  ...navigationComponents,
  ...formComponents,
  ...dataComponents,
  ...stateComponents,
];

const registeredRegistries = new WeakSet<ComponentRegistry>();

/**
 * Register all built-in components into a registry.
 * Idempotent per registry instance so importing this module from several
 * entry points cannot produce duplicate-definition errors.
 */
export function registerBuiltinComponents(registry: ComponentRegistry = builtinRegistry): ComponentRegistry {
  if (registeredRegistries.has(registry)) return registry;
  registry.registerMany(builtinComponentDefinitions);
  registeredRegistries.add(registry);
  return registry;
}

/** Global registry populated for the editor, renderer, and migrations. */
export const components = registerBuiltinComponents();

export {
  structureComponents,
  contentComponents,
  navigationComponents,
  formComponents,
  dataComponents,
  stateComponents,
};
