import { useEffect, useMemo, useState, type CSSProperties, type PropsWithChildren } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getSessionState, subscribeSession, type SessionState } from '../auth/session.js';
import { defaultNavigation } from '../nav/defaultNav.js';
import { filterNavigation, type VisibilityContext } from '../nav/types.js';
import { Button } from '../design-system/primitives.js';
import { setThemeMode, getThemeMode, type ThemeMode } from '../theme/theme.js';
import { getIdentity, subscribeIdentity, applyDocumentIdentity } from '../identity/store.js';
import type { DashboardApplicationIdentity } from '../identity/types.js';
import { logger } from '../lib/logger.js';

export function AppShell({ children }: PropsWithChildren) {
  const [session, setSession] = useState<SessionState>(getSessionState);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode);
  const [identity, setIdentityState] = useState<DashboardApplicationIdentity>(getIdentity);
  const location = useLocation();

  useEffect(() => subscribeSession(setSession), []);
  useEffect(() => subscribeIdentity(setIdentityState), []);

  useEffect(() => {
    const page =
      location.pathname.startsWith('/servers')
        ? 'Servers'
        : location.pathname.startsWith('/owner')
          ? 'Owner'
          : location.pathname.startsWith('/account')
            ? 'Account'
            : location.pathname.startsWith('/dashboard')
              ? 'Dashboard'
              : undefined;
    applyDocumentIdentity(page);
    logger.debug('route.render', { path: location.pathname, page });
  }, [location.pathname, identity.botName]);

  const nav = useMemo(() => {
    logger.debug('navigation.build.start', {});
    const ctx: VisibilityContext = {
      authenticated: session.status === 'authenticated',
      isOwner: session.isBotOwner,
      bits: session.bits,
    };
    const filtered = filterNavigation(defaultNavigation, ctx);
    logger.debug('navigation.build.complete', {
      included: filtered.length,
      total: defaultNavigation.length,
    });
    return filtered;
  }, [session]);

  const headerStyle: CSSProperties = {
    height: 'var(--topbar-height)',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '0 16px',
    position: 'sticky',
    top: 0,
    zIndex: 20,
  };

  const sidebarStyle: CSSProperties = {
    width: 'var(--sidebar-width)',
    borderRight: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    padding: '16px 12px',
    display: mobileOpen ? 'block' : undefined,
  };

  const listStyle: CSSProperties = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  };

  return (
    <div style={{ display: 'flex', minHeight: '100%', flexDirection: 'column' }}>
      <header style={headerStyle}>
        <Button
          variant="ghost"
          aria-label="Open navigation"
          onClick={() => setMobileOpen((v) => !v)}
          style={{ display: 'none' }}
          className="mobile-nav-toggle"
        >
          Menu
        </Button>
        <strong style={{ letterSpacing: '-0.02em' }}>{identity.botName}</strong>
        <div style={{ flex: 1 }} />
        <Button
          variant="ghost"
          aria-label="Toggle theme"
          onClick={() => {
            const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
            setThemeMode(next);
            setTheme(next);
            logger.debug('theme.changed', { mode: next });
          }}
        >
          Theme: {theme}
        </Button>
        {session.user ? (
          <span style={{ color: 'var(--color-muted)', fontSize: 14 }}>
            {session.user.username ?? session.user.id}
          </span>
        ) : (
          <Link to="/login">Sign in</Link>
        )}
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <aside aria-label="Primary" style={sidebarStyle} className="app-sidebar">
          <nav>
            <ul style={listStyle}>
              {nav.map((item) => {
                const active =
                  location.pathname === item.href || location.pathname.startsWith(item.href + '/');
                return (
                  <li key={item.id}>
                    <Link
                      to={item.href}
                      onClick={() => setMobileOpen(false)}
                      style={{
                        display: 'block',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--color-fg)',
                        textDecoration: 'none',
                        background: active ? 'var(--color-surface-2)' : 'transparent',
                        fontWeight: active ? 600 : 500,
                      }}
                      aria-current={active ? 'page' : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <main style={{ flex: 1, padding: 'var(--space-5)', maxWidth: 1100 }}>{children}</main>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .app-sidebar {
            position: fixed;
            inset: var(--topbar-height) auto 0 0;
            z-index: 30;
            transform: translateX(${mobileOpen ? '0' : '-100%'});
            transition: transform var(--motion-fast);
            box-shadow: var(--shadow-md);
          }
          .mobile-nav-toggle { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
