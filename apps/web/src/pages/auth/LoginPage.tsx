import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Stack } from '../../design-system/primitives.js';
import { getIdentity } from '../../identity/store.js';
import { applyPublicMetadata } from '../../public/metadata.js';
import { trackPublic } from '../../telemetry/publicTelemetry.js';
import { logger } from '../../lib/logger.js';
import { getSessionState } from '../../auth/session.js';

export function LoginPage() {
  const id = getIdentity();
  const session = getSessionState();

  useEffect(() => {
    applyPublicMetadata({ title: 'Sign in', description: `Sign in to ${id.botName}`, noindex: true });
    logger.debug('web.auth.session.loaded', { status: session.status });
  }, [id.botName, session.status]);

  return (
    <div style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card>
        <Stack gap={16}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {id.avatarUrl ? (
              <img src={id.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: 10 }} />
            ) : null}
            <div>
              <h1 style={{ margin: 0, fontSize: 22 }}>Sign in to {id.botName}</h1>
              <p style={{ margin: '4px 0 0', color: 'var(--color-muted)', fontSize: 13 }}>
                Authentication establishes identity. Authorization remains server-side.
              </p>
            </div>
          </div>
          {session.status === 'authenticated' ? (
            <p style={{ margin: 0 }}>
              You are signed in.{' '}
              <Link to="/dashboard">Continue to dashboard</Link>
            </p>
          ) : (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  trackPublic('login_start', { provider: 'discord' });
                  logger.debug('web.auth.session.loaded', { action: 'login_start' });
                  // Existing Discord OAuth entry — Dashboard API / public auth routes
                  window.location.href = '/api/dash/auth/discord' ;
                }}
              >
                Continue with Discord
              </Button>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>
                Better Auth migration boundary is active; provider UX uses the Dashboard auth routes.
              </p>
            </>
          )}
          <Link to="/">← Back to home</Link>
        </Stack>
      </Card>
    </div>
  );
}
