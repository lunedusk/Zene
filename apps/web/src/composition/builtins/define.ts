import type { ComponentDefinition, JsonObject } from '../types.js';

/** Helper preserving strict-ish shape while allowing the React render binding. */
export function defineComponent(
  def: Omit<ComponentDefinition, 'source'> & { source?: ComponentDefinition['source'] },
): ComponentDefinition {
  return { source: 'builtin', ...def } as ComponentDefinition;
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

export function listItems(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v));
}

export function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
