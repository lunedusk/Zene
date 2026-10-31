import type { DataBinding, JsonValue } from './types.js';

export interface BindingProviderDefinition {
  id: string;
  label: string;
  description: string;
  /** Resources this provider can load. Empty means a single default resource. */
  resources: readonly string[];
  fields: readonly string[];
  /** Fields returning numbers are displayed without string coercion surprises. */
  numericFields?: readonly string[];
}

/**
 * Fixed allowlist of data providers. Stored documents can never request an
 * arbitrary URL; only these providers (backed by existing dashboard APIs)
 * can be resolved.
 */
export const BINDING_PROVIDERS: readonly BindingProviderDefinition[] = [
  {
    id: 'public.stats',
    label: 'Public statistics',
    description: 'Live server/user/command counts from /api/dash/public/stats',
    resources: ['stats'],
    fields: ['servers', 'users', 'commandsExecuted', 'uptimeMs'],
    numericFields: ['servers', 'users', 'commandsExecuted', 'uptimeMs'],
  },
  {
    id: 'public.botInfo',
    label: 'Bot identity',
    description: 'Configured bot name, avatar, and invite URL',
    resources: ['identity'],
    fields: ['name', 'avatarUrl', 'inviteUrl'],
  },
  {
    id: 'public.commands',
    label: 'Command catalog',
    description: 'Registered slash command catalog',
    resources: ['catalog'],
    fields: ['count', 'commands'],
    numericFields: ['count'],
  },
  {
    id: 'public.site',
    label: 'Published site',
    description: 'Published site metadata and navigation',
    resources: ['site'],
    fields: ['title', 'description', 'sectionCount'],
    numericFields: ['sectionCount'],
  },
  {
    id: 'account.servers',
    label: 'Your servers',
    description: 'Servers you can access, resolved by the authenticated dashboard API',
    resources: ['servers'],
    fields: ['servers', 'count'],
    numericFields: ['count'],
  },
  {
    id: 'session',
    label: 'Current session',
    description: 'Signed-in user presentation data (never permissions authority)',
    resources: ['user'],
    fields: ['username', 'userId', 'authenticated', 'isOwner'],
  },
  {
    id: 'document',
    label: 'Document metadata',
    description: 'The composition document title/description',
    resources: ['metadata'],
    fields: ['title', 'description', 'name'],
  },
] as const;

export function getBindingProvider(id: string): BindingProviderDefinition | undefined {
  return BINDING_PROVIDERS.find((p) => p.id === id);
}

export function isApprovedBinding(binding: Pick<DataBinding, 'provider' | 'resource' | 'field'>): boolean {
  const provider = getBindingProvider(binding.provider);
  if (!provider) return false;
  if (binding.resource && provider.resources.length > 0 && !provider.resources.includes(binding.resource)) {
    return false;
  }
  if (binding.field && !provider.fields.includes(binding.field)) {
    return false;
  }
  return true;
}

export function bindingKey(binding: Pick<DataBinding, 'provider' | 'resource'>): string {
  return `${binding.provider}:${binding.resource ?? 'default'}`;
}

export function coerceBindingValue(
  providerId: string,
  value: JsonValue | undefined,
  field?: string,
): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    const provider = getBindingProvider(providerId);
    const numeric = provider?.numericFields?.includes(field ?? '') ?? false;
    if (field === 'uptimeMs' && numeric) {
      return `${Math.floor(value / 3_600_000).toLocaleString()}h`;
    }
    return value.toLocaleString();
  }
  return String(value);
}
