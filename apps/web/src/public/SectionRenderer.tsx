



import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, LoadingState, Stack } from '../design-system/primitives.js';
import { getIdentity } from '../identity/store.js';
import { trackPublic } from '../telemetry/publicTelemetry.js';
import { logger } from '../lib/logger.js';
import { apiClient } from '../api/client.js';
import type { PublicSection } from './sectionTypes.js';

interface PublicStats {
  servers?: number;
  users?: number;
  uptimeMs?: number;
  commandsExecuted?: number;
}

function StatsBlock({ title, description }: { title?: string; description?: string }) {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = (await apiClient.request<PublicStats>('/public/stats')) as PublicStats;
        setStats(data);
        logger.debug('web.public.section.rendered', { type: 'statistics', ok: true });
      } catch {
        setUnavailable(true);
        logger.debug('web.public.section.failed', { type: 'statistics' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingState label="Loading stats…" />;
  if (unavailable || !stats) {
    return (
      <section>
        {title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{title}</h2> : null}
        <EmptyState title="Statistics unavailable" description={description ?? 'Public metrics are not available for this deployment.'} />
      </section>
    );
  }

  const uptimeH = typeof stats.uptimeMs === 'number' ? Math.floor(stats.uptimeMs / 3_600_000) : null;
  const cards = [
    { label: 'Servers', value: stats.servers },
    { label: 'Users', value: stats.users },
    { label: 'Commands (all-time)', value: stats.commandsExecuted },
    { label: 'Uptime (hours)', value: uptimeH },
  ].filter((c) => c.value !== undefined && c.value !== null);

  return (
    <section>
      {title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{title}</h2> : null}
      {description ? <p style={{ margin: '0 0 12px', color: 'var(--color-muted)' }}>{description}</p> : null}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        {cards.map((c) => (
          <Card key={c.label} title={c.label}>
            <p style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{Number(c.value).toLocaleString()}</p>
          </Card>
        ))}
      </div>
    </section>
  );
}

function ScreenshotsBlock({ section }: { section: PublicSection }) {
  const items = (section.items ?? []).filter((i) => i.icon || i.title);

  if (items.length === 0) {
    return (
      <section>
        {section.title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{section.title}</h2> : null}
        <EmptyState
          title="No media published"
          description="Owners can add screenshot URLs under Public site → screenshots section."
        />
      </section>
    );
  }
  return (
    <section>
      {section.title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{section.title}</h2> : null}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {items.map((item) => (
          <Card key={item.id} title={item.title ?? 'Screenshot'}>
            {item.icon ? (
              <img
                src={item.icon}
                alt={item.title ?? 'Screenshot'}
                style={{ width: '100%', borderRadius: 8, display: 'block' }}
                loading="lazy"
              />
            ) : null}
            {item.description ? (
              <p style={{ margin: '8px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>{item.description}</p>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  );
}

export function SectionRenderer({ section }: { section: PublicSection }) {
  if (!section.enabled) return null;
  const id = getIdentity();

  try {
    logger.debug('web.public.section.rendered', { sectionId: section.id, type: section.type });
    switch (section.type) {
      case 'hero':
        return (
          <section style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            <div>
              <h1 style={{ margin: '0 0 12px', fontSize: 'clamp(28px, 5vw, 40px)' }}>
                {section.headline ?? id.botName}
              </h1>
              <p style={{ margin: '0 0 20px', color: 'var(--color-muted)', fontSize: 17 }}>
                {section.subhead ?? section.description}
              </p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {section.primaryCtaHref ?? id.inviteUrl ? (
                  <a
                    href={section.primaryCtaHref ?? id.inviteUrl ?? '#'}
                    style={{ textDecoration: 'none' }}
                    onClick={() => trackPublic('cta_invite', { sectionId: section.id })}
                  >
                    <Button variant="primary">{section.primaryCtaLabel ?? `Invite ${id.botName}`}</Button>
                  </a>
                ) : null}
                {section.secondaryCtaHref ? (
                  <Link
                    to={section.secondaryCtaHref}
                    style={{ textDecoration: 'none' }}
                    onClick={() => trackPublic('cta_dashboard', { sectionId: section.id })}
                  >
                    <Button>{section.secondaryCtaLabel ?? 'Dashboard'}</Button>
                  </Link>
                ) : null}
              </div>
            </div>
            <Card>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                {id.avatarUrl ? (
                  <img src={id.avatarUrl} alt="" width={72} height={72} style={{ borderRadius: 16 }} />
                ) : (
                  <div style={{ width: 72, height: 72, borderRadius: 16, background: 'var(--color-surface-2)' }} />
                )}
                <strong>{id.botName}</strong>
              </div>
            </Card>
          </section>
        );
      case 'features':
        return (
          <section>
            {section.title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{section.title}</h2> : null}
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {(section.items ?? []).map((item) => (
                <Card key={item.id} title={item.title}>
                  <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 14 }}>{item.description}</p>
                </Card>
              ))}
            </div>
          </section>
        );
      case 'faq':
        return (
          <Stack gap={12}>
            {section.title ? <h2 style={{ margin: 0, fontSize: 20 }}>{section.title}</h2> : null}
            {(section.items ?? []).length === 0 ? (
              <EmptyState title="No FAQ entries" />
            ) : (
              (section.items ?? []).map((item) => (
                <Card key={item.id} title={item.question ?? item.title}>
                  <p style={{ margin: 0, color: 'var(--color-muted)' }}>{item.answer ?? item.description}</p>
                </Card>
              ))
            )}
          </Stack>
        );
      case 'cta':
        return (
          <Card title={section.title}>
            {section.href ? (
              <Link to={section.href} style={{ textDecoration: 'none' }}>
                <Button variant="primary">{section.label ?? 'Continue'}</Button>
              </Link>
            ) : null}
          </Card>
        );
      case 'statistics':
      case 'performance':
        return <StatsBlock title={section.title} description={section.description ?? section.content} />;
      case 'screenshots':
        return <ScreenshotsBlock section={section} />;
      case 'commands':
        return (
          <section>
            {section.title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{section.title}</h2> : null}
            <Card title={section.title ?? 'Commands'}>
              <p style={{ margin: '0 0 12px', color: 'var(--color-muted)' }}>
                {section.description ?? section.content ?? 'Browse slash commands registered on this bot.'}
              </p>
              <Link to="/commands" style={{ textDecoration: 'none' }} onClick={() => trackPublic('command_open', {})}>
                <Button>View commands</Button>
              </Link>
            </Card>
          </section>
        );
      case 'docs':
      case 'changelog':
      case 'integrations':
      case 'plugins':
      case 'servers': {
        const pathByType: Record<string, string> = {
          docs: '/docs',
          changelog: '/changelog',
          integrations: '/integrations',
          plugins: '/features',
          servers: '/features',
        };
        const to = pathByType[section.type] ?? '/features';
        return (
          <section>
            {section.title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{section.title}</h2> : null}
            <Card title={section.title ?? section.type}>
              <p style={{ margin: '0 0 12px', color: 'var(--color-muted)' }}>
                {section.content ?? section.description ?? ''}
              </p>
              <Link to={to} style={{ textDecoration: 'none' }}>
                <Button>Open</Button>
              </Link>
            </Card>
          </section>
        );
      }
      case 'security':
      case 'custom':
      default:
        return (
          <section>
            {section.title ? <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>{section.title}</h2> : null}
            {section.content || section.description ? (
              <Card>
                <p style={{ margin: 0, color: 'var(--color-muted)' }}>{section.content ?? section.description}</p>
              </Card>
            ) : (
              <Card>
                <p style={{ margin: 0, color: 'var(--color-muted)' }}>
                  <Link to="/security">Security overview</Link>
                </p>
              </Card>
            )}
          </section>
        );
    }
  } catch (e) {
    logger.debug('web.public.section.failed', {
      sectionId: section.id,
      reason: e instanceof Error ? e.message : 'unknown',
    });
    return null;
  }
}
