



import { Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Button, Card, Stack } from '../../design-system/primitives.js';
import { getIdentity } from '../../identity/store.js';
import { applyPublicMetadata } from '../../public/metadata.js';
import { logger } from '../../lib/logger.js';

export type ErrorCode = 401 | 403 | 404 | 429 | 500 | 502 | 503;

const COPY: Record<ErrorCode, { title: string; body: string }> = {
  401: { title: 'Sign in required', body: 'Your session is missing or expired. Sign in to continue.' },
  403: { title: 'Access denied', body: 'You do not have permission to view this resource.' },
  404: { title: 'Not found', body: 'This page or resource is unavailable.' },
  429: { title: 'Too many requests', body: 'Please wait a moment and try again.' },
  500: { title: 'Something went wrong', body: 'An unexpected error occurred. Try again later.' },
  502: { title: 'Bad gateway', body: 'Upstream service is temporarily unavailable.' },
  503: { title: 'Service unavailable', body: 'The service is temporarily unavailable.' },
};

export function ErrorPage({ code = 404, requestId }: { code?: ErrorCode; requestId?: string }) {
  const id = getIdentity();
  const loc = useLocation();
  const copy = COPY[code] ?? COPY[404];

  useEffect(() => {
    applyPublicMetadata({ title: copy.title, description: copy.body, noindex: true });
    logger.debug('web.route.resolved', { page: 'error', code, path: loc.pathname });
  }, [code, copy.body, copy.title, loc.pathname]);

  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <Card>
        <Stack gap={12}>
          <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>{id.botName}</p>
          <h1 style={{ margin: 0, fontSize: 24 }}>
            {code} · {copy.title}
          </h1>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>{copy.body}</p>
          {requestId ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>Request ID: {requestId}</p>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <Button>Home</Button>
            </Link>
            {code === 401 ? (
              <Link to="/login" style={{ textDecoration: 'none' }}>
                <Button variant="primary">Sign in</Button>
              </Link>
            ) : null}
            <Button onClick={() => window.location.reload()}>Retry</Button>
          </div>
        </Stack>
      </Card>
    </div>
  );
}

export function ForbiddenPage() {
  return <ErrorPage code={403} />;
}

export function NotFoundPage() {
  return <ErrorPage code={404} />;
}

export function UnauthorizedPage() {
  return <ErrorPage code={401} />;
}
