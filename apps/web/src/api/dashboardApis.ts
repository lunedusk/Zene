



import { apiClient } from './client.js';
import { logger } from '../lib/logger.js';

export interface ThemeTokens {
  [key: string]: string | number | boolean | null | undefined;
}

export interface ThemeDoc {
  tokens?: ThemeTokens;
  version?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface LayoutDoc {
  id: string;
  scope: string;
  name: string;
  grid: unknown;
  guildId?: string | null;
  version?: number;
  schemaVersion?: number;
  navOrder?: string[] | null;
  themeOverrideId?: string | null;
  updatedAt?: number;
  [key: string]: unknown;
}

export interface RegistryPlugin {
  pluginId: string;
  surfaces?: Array<{
    id: string;
    label?: string;
    path?: string;
    icon?: string;
    kind?: string;
  }>;
}

export interface RegistrySnapshot {
  plugins?: RegistryPlugin[];
  version?: number | string;
  [key: string]: unknown;
}

export interface ServerSummary {
  id: string;
  name?: string;
  icon?: string | null;
  [key: string]: unknown;
}

export async function fetchTheme(): Promise<ThemeDoc> {
  const started = Date.now();
  logger.debug('dashboard.table.load', { resource: 'theme' });
  try {
    const data = (await apiClient.request<ThemeDoc>('/admin/theme')) as ThemeDoc;
    logger.debug('dashboard.table.load', { resource: 'theme', durationMs: Date.now() - started, status: 'ok' });
    return data;
  } catch (e) {
    logger.debug('dashboard.table.error', {
      resource: 'theme',
      durationMs: Date.now() - started,
      reason: e instanceof Error ? e.message : 'unknown',
    });
    throw e;
  }
}

export async function saveTheme(tokens: ThemeTokens, expectedVersion?: number): Promise<ThemeDoc> {
  logger.debug('dashboard.publish.started', { resource: 'theme' });
  const data = (await apiClient.request<ThemeDoc>('/admin/theme', {
    method: 'PUT',
    body: { tokens, version: expectedVersion },
    expectedVersion,
  })) as ThemeDoc;
  logger.debug('dashboard.publish.completed', { resource: 'theme' });
  return data;
}

export async function fetchLayout(scope = 'global', guildId?: string): Promise<LayoutDoc | null> {
  const started = Date.now();
  try {
    const data = (await apiClient.request<LayoutDoc | null>('/admin/layouts', {
      query: { scope, guildId },
    })) as LayoutDoc | null;
    logger.debug('dashboard.layout.load', { scope, durationMs: Date.now() - started });
    return data;
  } catch (e) {
    logger.debug('dashboard.table.error', {
      resource: 'layout',
      durationMs: Date.now() - started,
      reason: e instanceof Error ? e.message : 'unknown',
    });
    throw e;
  }
}

export async function saveLayout(doc: {
  id: string;
  scope: string;
  name: string;
  grid: unknown;
  guildId?: string | null;
  version?: number;
  navOrder?: string[] | null;
}): Promise<LayoutDoc> {
  logger.debug('dashboard.layout.save', { id: doc.id, scope: doc.scope });
  return (await apiClient.request<LayoutDoc>('/admin/layouts', {
    method: 'PUT',
    body: doc,
    expectedVersion: doc.version,
  })) as LayoutDoc;
}



export function normalizeRegistryPlugins(raw: unknown): RegistryPlugin[] {
  if (!Array.isArray(raw)) return [];
  const out: RegistryPlugin[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const pluginId = typeof rec.pluginId === 'string' ? rec.pluginId : typeof rec.id === 'string' ? rec.id : null;
    if (!pluginId) continue;
    const surfacesRaw = rec.surfaces;
    const surfaces: NonNullable<RegistryPlugin['surfaces']> = [];
    if (Array.isArray(surfacesRaw)) {
      for (const s of surfacesRaw) {
        if (!s || typeof s !== 'object') continue;
        const sr = s as Record<string, unknown>;
        const sid = typeof sr.id === 'string' ? sr.id : null;
        if (!sid) continue;
        surfaces.push({
          id: sid,
          label: typeof sr.label === 'string' ? sr.label : typeof sr.title === 'string' ? sr.title : undefined,
          path: typeof sr.path === 'string' ? sr.path : undefined,
          icon: typeof sr.icon === 'string' ? sr.icon : undefined,
          kind: typeof sr.kind === 'string' ? sr.kind : undefined,
        });
      }
    }
    out.push({ pluginId, surfaces });
  }
  return out;
}

export async function fetchRegistry(): Promise<RegistrySnapshot> {
  const started = Date.now();
  logger.debug('dashboard.registry.loaded', { phase: 'start' });
  const raw = await apiClient.getRegistry();
  const data: RegistrySnapshot =
    raw && typeof raw === 'object'
      ? {
          ...(raw as RegistrySnapshot),
          plugins: normalizeRegistryPlugins(
            (raw as { plugins?: unknown }).plugins ?? (raw as { items?: unknown }).items,
          ),
        }
      : { plugins: [] };
  logger.debug('dashboard.registry.loaded', {
    durationMs: Date.now() - started,
    pluginCount: data.plugins?.length ?? 0,
  });
  return data;
}

export async function fetchMyServers(): Promise<ServerSummary[]> {
  const started = Date.now();
  const data = (await apiClient.request<unknown>('/me/servers')) as unknown;
  logger.debug('dashboard.table.load', { resource: 'servers', durationMs: Date.now() - started });
  if (Array.isArray(data)) return data as ServerSummary[];
  if (data && typeof data === 'object' && Array.isArray((data as { servers?: unknown }).servers)) {
    return (data as { servers: ServerSummary[] }).servers;
  }
  return [];
}

export async function searchDashboard(q: string, page = 1, limit = 20): Promise<unknown> {
  const started = Date.now();
  logger.debug('dashboard.search.started', { qLength: q.length, page });
  try {
    const data = await apiClient.search(q, page, limit);
    logger.debug('dashboard.search.completed', { durationMs: Date.now() - started });
    return data;
  } catch (e) {
    logger.debug('dashboard.search.failed', {
      durationMs: Date.now() - started,
      reason: e instanceof Error ? e.message : 'unknown',
    });
    throw e;
  }
}

export async function fetchJob(jobId: string): Promise<unknown> {
  return apiClient.request(`/jobs/${encodeURIComponent(jobId)}`);
}

export async function createDataRightsRequest(kind: 'export' | 'deletion', guildId?: string | null): Promise<unknown> {
  return apiClient.request('/data-rights', {
    method: 'POST',
    body: { kind, guildId: guildId ?? null },
  });
}
