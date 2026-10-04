import { useEffect, useMemo, useState } from 'react';
import { Card, EmptyState, ErrorState, Input, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { applyPublicMetadata } from '../../public/metadata.js';
import { getIdentity } from '../../identity/store.js';
import { trackPublic } from '../../telemetry/publicTelemetry.js';
import { logger } from '../../lib/logger.js';

interface PublicCommand {
  id: string;
  name: string;
  description: string;
  usage: string;
  category: string;
  pluginId: string;
  subcommands: string[];
}

export function CommandsPage() {
  const id = getIdentity();
  const [commands, setCommands] = useState<PublicCommand[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    applyPublicMetadata({ title: 'Commands', description: `Commands for ${id.botName}` });
    void (async () => {
      setLoading(true);
      try {
        const data = (await apiClient.request<{ commands: PublicCommand[] }>('/public/commands')) as {
          commands: PublicCommand[];
        };
        setCommands(Array.isArray(data.commands) ? data.commands : []);
        logger.debug('web.public.commands.loaded', { count: data.commands?.length ?? 0 });
        trackPublic('page_view', { path: '/commands' });
      } catch (e) {
        setError(e instanceof DashApiError ? e.message : 'Commands unavailable');
      } finally {
        setLoading(false);
      }
    })();
  }, [id.botName]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle) ||
        c.pluginId.toLowerCase().includes(needle),
    );
  }, [commands, q]);

  const byCategory = useMemo(() => {
    const map = new Map<string, PublicCommand[]>();
    for (const c of filtered) {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (loading) return <LoadingState label="Loading commands…" />;
  if (error) return <ErrorState title="Commands unavailable" message={error} />;

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Commands</h1>
      <p style={{ margin: 0, color: 'var(--color-muted)' }}>
        Catalog from the live command registry — no static examples.
      </p>
      <Input
        aria-label="Search commands"
        placeholder="Search commands…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          trackPublic('command_search', { qLen: e.target.value.length });
        }}
      />
      {filtered.length === 0 ? (
        <EmptyState title="No commands" description={q ? 'No matches.' : 'No public commands registered.'} />
      ) : (
        byCategory.map(([cat, list]) => (
          <Stack key={cat} gap={8}>
            <h2 style={{ margin: 0, fontSize: 16, color: 'var(--color-muted)' }}>{cat}</h2>
            {list.map((c) => (
              <Card key={c.id} title={`/${c.name}`}>
                <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 14 }}>{c.description || '—'}</p>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-muted)' }}>
                  Usage: <code>{c.usage}</code>
                  {c.subcommands.length ? ` · Subcommands: ${c.subcommands.join(', ')}` : ''}
                </p>
              </Card>
            ))}
          </Stack>
        ))
      )}
    </Stack>
  );
}
