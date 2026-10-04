import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, EmptyState, ErrorState, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { getSessionState } from '../../auth/session.js';
import { getIdentity } from '../../identity/store.js';
import { logger } from '../../lib/logger.js';

interface AuthCapabilities {
  supportsDiscordOAuth?: boolean;
  supportsPassword?: boolean;
  supportsTotp?: boolean;
  supportsPasskeys?: boolean;
  supportsRecovery?: boolean;
  betterAuthSessionAuthority?: boolean;
  migrationPhase?: number;
}

export function AccountPage() {
  const { section } = useParams<{ section?: string }>();
  const active = section ?? 'profile';
  const session = getSessionState();
  const id = getIdentity();
  const [caps, setCaps] = useState<AuthCapabilities | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'account', section: active });
    void (async () => {
      try {
        const data = (await apiClient.request<AuthCapabilities>('/public/auth-capabilities')) as AuthCapabilities;
        setCaps(data);
        logger.debug('web.account.security.capabilities.loaded', {
          passkeys: !!data.supportsPasskeys,
          totp: !!data.supportsTotp,
          phase: data.migrationPhase ?? null,
        });
      } catch (e) {
        setCapError(e instanceof DashApiError ? e.message : 'Capabilities unavailable');
      }
    })();
  }, [active]);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Account</h1>
      <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
        Signed in as {session.user?.id ?? 'unknown'} · {id.botName}
      </p>

      {active === 'profile' || active === 'identities' ? (
        <Card title="Profile & identities">
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            Discord identity is linked through the Dashboard session. Better Auth multi-identity linking activates when
            session authority migrates (phase {caps?.migrationPhase ?? 1}).
          </p>
        </Card>
      ) : null}

      {active === 'sessions' || active === 'security' ? (
        <Stack gap={12}>
          <Card title="Sessions">
            <p style={{ margin: 0, color: 'var(--color-muted)' }}>
              Current dashboard session is server-validated on each sensitive request. Device history expands when the
              auth migration exposes session listing APIs.
            </p>
          </Card>
          <Card title="Security capabilities">
            {capError ? <ErrorState title="Unavailable" message={capError} /> : null}
            {!caps && !capError ? <LoadingState label="Loading capabilities…" /> : null}
            {caps ? (
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--color-muted)', fontSize: 14 }}>
                <li>Discord OAuth: {caps.supportsDiscordOAuth ? 'available' : 'unavailable'}</li>
                <li>Password: {caps.supportsPassword ? 'available' : 'not enabled'}</li>
                <li>TOTP / 2FA: {caps.supportsTotp ? 'available' : 'not enabled'}</li>
                <li>Passkeys: {caps.supportsPasskeys ? 'available' : 'not enabled'}</li>
                <li>Recovery: {caps.supportsRecovery ? 'available' : 'not enabled'}</li>
                <li>
                  Better Auth session authority:{' '}
                  {caps.betterAuthSessionAuthority ? 'active' : 'deferred (migration phase 1)'}
                </li>
              </ul>
            ) : null}
          </Card>
          {caps && !caps.supportsPasskeys && !caps.supportsTotp ? (
            <EmptyState
              title="Advanced factors not enabled"
              description="Passkeys and TOTP controls appear only when the authentication migration enables those capabilities. Authorization remains server-side on the platform."
            />
          ) : null}
        </Stack>
      ) : null}

      {active === 'data-rights' ? (
        <Card title="Data rights">
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            Export and deletion requests use the Dashboard data-rights APIs from the owner/ops surfaces when authorized.
          </p>
        </Card>
      ) : null}

      {!['profile', 'identities', 'sessions', 'security', 'data-rights'].includes(active) ? (
        <EmptyState title="Unknown section" description={`No account section named ${active}.`} />
      ) : null}
    </Stack>
  );
}
