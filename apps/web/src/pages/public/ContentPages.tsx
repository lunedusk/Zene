import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, EmptyState, Stack } from '../../design-system/primitives.js';
import { getIdentity } from '../../identity/store.js';
import { applyPublicMetadata } from '../../public/metadata.js';
import { logger } from '../../lib/logger.js';
import { trackPublic } from '../../telemetry/publicTelemetry.js';
import { apiClient } from '../../api/client.js';

export function FeaturesPage() {
  const id = getIdentity();
  useEffect(() => {
    applyPublicMetadata({ title: 'Features', description: `Features of ${id.botName}` });
    logger.debug('web.route.resolved', { page: 'public.features' });
  }, [id.botName]);

  const features = [
    { title: 'Dashboard', body: 'Owner and server surfaces with permission-aware navigation.' },
    { title: 'Plugins', body: 'Registry-driven contributions with failure isolation.' },
    { title: 'Publishing', body: 'Draft, signed preview, schedule, restore, and rollback.' },
    { title: 'Cross-Host ready', body: 'Guild routing stays on the Dashboard API boundary.' },
  ];

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Features</h1>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {features.map((f) => (
          <Card key={f.title} title={f.title}>
            <p style={{ margin: 0, color: 'var(--color-muted)' }}>{f.body}</p>
          </Card>
        ))}
      </div>
    </Stack>
  );
}

export function SecurityPage() {
  const id = getIdentity();
  useEffect(() => {
    applyPublicMetadata({ title: 'Security', description: `Security model for ${id.botName}` });
  }, [id.botName]);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Security</h1>
      <Card title="Authorization">
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>
          {id.botName} keeps authentication separate from authorization. Capability and hierarchy checks run on the server;
          the browser never becomes the permission authority.
        </p>
      </Card>
      <Card title="Sessions">
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>
          Dashboard sessions are validated on each sensitive request. Preview tokens are scoped, expiring, and non-indexable —
          they are not dashboard sessions.
        </p>
      </Card>
      <Card title="Data rights">
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>
          Export and deletion flows go through the Dashboard data-rights APIs with auditability.
        </p>
      </Card>
    </Stack>
  );
}

export function FaqPage() {
  const id = getIdentity();
  useEffect(() => {
    applyPublicMetadata({ title: 'FAQ', description: `Frequently asked questions about ${id.botName}` });
  }, [id.botName]);

  const faqs = [
    {
      q: `How do I invite ${id.botName}?`,
      a: id.inviteUrl
        ? 'Use the Invite button on the homepage. The invite URL comes from runtime configuration.'
        : 'Invite URL is not configured for this deployment yet.',
    },
    {
      q: 'Who can access the owner dashboard?',
      a: 'Only env bot owners (and equivalent elevated identities) after server-side authorization.',
    },
    {
      q: 'Where is documentation?',
      a: 'See the Docs section. Content is deployment-specific and does not invent product claims.',
    },
  ];

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 28 }}>FAQ</h1>
      {faqs.map((f) => (
        <Card key={f.q} title={f.q}>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>{f.a}</p>
        </Card>
      ))}
    </Stack>
  );
}

export function DocsIndexPage() {
  const id = getIdentity();
  useEffect(() => {
    applyPublicMetadata({ title: 'Documentation', description: `Documentation for ${id.botName}` });
    trackPublic('docs_nav', { path: '/docs' });
  }, [id.botName]);

  const docs = [
    { path: '/docs/getting-started', title: 'Getting started', body: 'Invite, permissions, and first dashboard login.' },
    { path: '/docs/permissions', title: 'Permissions', body: 'Bits, hierarchy, and capability evaluation.' },
    { path: '/docs/plugins', title: 'Plugins', body: 'Dashboard contributions and owner overrides.' },
  ];

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Documentation</h1>
      <p style={{ margin: 0, color: 'var(--color-muted)' }}>
        Docs use the same design system and identity as the rest of {id.botName}.
      </p>
      {docs.map((d) => (
        <Card key={d.path} title={d.title}>
          <p style={{ margin: '0 0 8px', color: 'var(--color-muted)' }}>{d.body}</p>
          <Link to={d.path}>Open</Link>
        </Card>
      ))}
    </Stack>
  );
}

export function DocsArticlePage({ title, body }: { title: string; body: string }) {
  const id = getIdentity();
  useEffect(() => {
    applyPublicMetadata({ title, description: body.slice(0, 140) });
    trackPublic('docs_nav', { title });
  }, [title, body]);

  return (
    <Stack gap={16}>
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: 'var(--color-muted)' }}>
        <Link to="/docs">Docs</Link> / {title}
      </nav>
      <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
      <Card>
        <p style={{ margin: 0, color: 'var(--color-muted)', whiteSpace: 'pre-wrap' }}>{body.replaceAll('{bot}', id.botName)}</p>
      </Card>
      <Link to="/docs">← All docs</Link>
    </Stack>
  );
}

export function ChangelogPage() {
  const id = getIdentity();
  const [entries, setEntries] = useState<Array<{ version?: string; date?: string; summary?: string }> | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    applyPublicMetadata({ title: 'Changelog', description: `Release notes for ${id.botName}` });
    void (async () => {
      try {
        const data = (await apiClient.request<unknown>('/public/changelog')) as
          | { items?: Array<{ version?: string; date?: string; summary?: string }> }
          | Array<{ version?: string; date?: string; summary?: string }>;
        const items = Array.isArray(data) ? data : data.items ?? [];
        setEntries(items);
      } catch {
        setEntries(null);
      } finally {
        setTried(true);
      }
    })();
  }, [id.botName]);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Changelog</h1>
      {!tried ? null : entries && entries.length > 0 ? (
        entries.map((e, i) => (
          <Card key={`${e.version}-${i}`} title={e.version ?? 'Release'}>
            <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>{e.date}</p>
            <p style={{ margin: '8px 0 0' }}>{e.summary}</p>
          </Card>
        ))
      ) : (
        <EmptyState
          title="No published releases"
          description="Changelog entries load from the Dashboard public API when configured. Nothing is fabricated."
        />
      )}
    </Stack>
  );
}

export function IntegrationsPage() {
  const id = getIdentity();
  useEffect(() => {
    applyPublicMetadata({ title: 'Integrations', description: `Integrations for ${id.botName}` });
  }, [id.botName]);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Integrations</h1>
      <Card title="Discord">
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>
          Primary runtime is Discord. Authentication maps Discord identity into the dashboard session boundary.
        </p>
      </Card>
      <Card title="Plugins">
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>
          Plugin integrations appear when authorized by the registry — not as a static marketing list of invented products.
        </p>
      </Card>
    </Stack>
  );
}
