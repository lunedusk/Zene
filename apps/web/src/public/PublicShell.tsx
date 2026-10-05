



import { Link, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { getIdentity } from '../identity/store.js';
import { logger } from '../lib/logger.js';
import { trackPublic } from '../telemetry/publicTelemetry.js';
import { apiClient } from '../api/client.js';
import type { PublicSiteConfig } from './sectionTypes.js';

const FALLBACK_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/features', label: 'Features' },
  { href: '/commands', label: 'Commands' },
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/faq', label: 'FAQ' },
  { href: '/security', label: 'Security' },
  { href: '/login', label: 'Dashboard' },
] as const;

export function PublicShell() {
  const id = getIdentity();
  const [links, setLinks] = useState<Array<{ href: string; label: string; external?: boolean }>>(
    [...FALLBACK_LINKS],
  );

  useEffect(() => {
    logger.debug('web.route.resolved', { area: 'public', botName: id.botName });
    trackPublic('page_view', { path: window.location.pathname });
    void (async () => {
      try {
        const site = (await apiClient.request<PublicSiteConfig>('/public/site')) as PublicSiteConfig;
        if (Array.isArray(site.navigation) && site.navigation.length > 0) {
          setLinks(
            site.navigation.map((n) => ({
              href: n.href,
              label: n.label,
              external: n.external,
            })),
          );
        }
      } catch {

      }
    })();
  }, [id.botName]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg)',
        color: 'var(--color-fg)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid var(--color-border)',
          flexWrap: 'wrap',
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
          {id.avatarUrl ? (
            <img src={id.avatarUrl} alt="" width={32} height={32} style={{ borderRadius: 10 }} />
          ) : (
            <span
              aria-hidden
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'var(--color-accent)',
                display: 'inline-block',
              }}
            />
          )}
          <strong style={{ fontSize: 16 }}>{id.botName}</strong>
        </Link>
        <nav aria-label="Public" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {links.map((l) =>
            l.external ? (
              <a key={l.href + l.label} href={l.href} style={{ color: 'var(--color-muted)', textDecoration: 'none', fontSize: 14 }}>
                {l.label}
              </a>
            ) : (
              <Link key={l.href + l.label} to={l.href} style={{ color: 'var(--color-muted)', textDecoration: 'none', fontSize: 14 }}>
                {l.label}
              </Link>
            ),
          )}
        </nav>
      </header>
      <main style={{ flex: 1, width: '100%', maxWidth: 1080, margin: '0 auto', padding: '24px 20px' }}>
        <Outlet />
      </main>
      <footer
        style={{
          borderTop: '1px solid var(--color-border)',
          padding: '20px',
          color: 'var(--color-muted)',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0 }}>
          {id.botName}
          {id.inviteUrl ? (
            <>
              {' · '}
              <a href={id.inviteUrl} onClick={() => trackPublic('cta_invite', {})} style={{ color: 'var(--color-accent)' }}>
                Invite
              </a>
            </>
          ) : null}
        </p>
      </footer>
    </div>
  );
}
