import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, Stack, EmptyState, Button, ErrorState } from '../design-system/primitives.js';
import { getSessionState } from '../auth/session.js';
import { getIdentity } from '../identity/store.js';

export function PublicHomePage() {
  return (
    <div style={{ maxWidth: 720, margin: '48px auto', padding: 24 }}>
      <Stack gap={20}>
        <h1 style={{ margin: 0, letterSpacing: '-0.03em' }}>{getIdentity().botName}</h1>
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>
          Operational dashboard platform. Sign in to manage servers, plugins, and owner configuration.
        </p>
        <div>
          <Link to="/login">
            <Button variant="primary">Continue</Button>
          </Link>
        </div>
      </Stack>
    </div>
  );
}

export function LoginPage() {
  return (
    <div style={{ maxWidth: 420, margin: '64px auto', padding: 24 }}>
      <Card title="Sign in">
        <Stack>
          <p style={{ color: 'var(--color-muted)', margin: 0 }}>
            Authentication is handled by the Dashboard API (Discord OAuth and future providers). This shell does not
            implement a parallel login system.
          </p>
          <a href="/api/dash/auth/discord">
            <Button variant="primary">Continue with Discord</Button>
          </a>
          <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>
            After OAuth, the API sets a session; store the returned token via the auth callback when wired.
          </p>
        </Stack>
      </Card>
    </div>
  );
}

export function DashboardHomePage() {
  const s = getSessionState();
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Overview</h1>
      <Card title="Session">
        <p style={{ margin: 0, color: 'var(--color-muted)' }}>
          Signed in as <strong style={{ color: 'var(--color-fg)' }}>{s.user?.username ?? s.user?.id ?? '—'}</strong>
        </p>
      </Card>
      <Card title="Architecture surface">
        <EmptyState
          title="Feature pages deferred"
          description="Moderation, analytics, fleet, and jobs UIs ship in later phases. This route validates shell + session."
        />
      </Card>
    </Stack>
  );
}

export function ServersPage() {
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Servers</h1>
      <Card>
        <EmptyState title="No server selected" description="Server list will load from /api/dash/me/servers in Phase 3B." />
      </Card>
    </Stack>
  );
}

export function ServerHomePage() {
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Server</h1>
      <Card>
        <EmptyState title="Server dashboard landing" description="Guild-scoped context is available via the route param." />
      </Card>
    </Stack>
  );
}

export function OwnerPage() {
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Owner</h1>
      <Card>
        <EmptyState title="Owner area" description="Customization editor arrives in Phase 3B/3C. Visibility is owner-gated." />
      </Card>
    </Stack>
  );
}

export function AccountPage() {
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Account</h1>
      <Card title="Security">
        <p style={{ color: 'var(--color-muted)', margin: 0 }}>Session, devices, and sudo flows will consume Phase 2 identity APIs.</p>
      </Card>
    </Stack>
  );
}

export function PluginDemoPage() {
  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Plugin surface</h1>
      <PluginBoundary>
        <Card title="Plugin contribution placeholder">
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            Trusted plugins register surfaces via the Dashboard registry. Failures are isolated below.
          </p>
        </Card>
      </PluginBoundary>
    </Stack>
  );
}

export function NotFoundPage() {
  return (
    <div style={{ padding: 48 }}>
      <EmptyState title="Not found" description="This page does not exist or is not available." action={<Link to="/">Go home</Link>} />
    </div>
  );
}

export function ForbiddenPage() {
  return (
    <div style={{ padding: 48 }}>
      <EmptyState title="Forbidden" description="You do not have access to this area." action={<Link to="/dashboard">Back</Link>} />
    </div>
  );
}

class PluginBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return <ErrorState title="Plugin surface failed" message={this.state.error.message} />;
    }
    return this.props.children;
  }
}
