import { useEffect, useState } from 'react';
import { Button, Card, ErrorState, Input, LoadingState, Stack } from '../../design-system/primitives.js';
import { fetchTheme, saveTheme, type ThemeTokens } from '../../api/dashboardApis.js';
import { logger } from '../../lib/logger.js';
import { DashApiError } from '../../api/types.js';

const TOKEN_KEYS = [
  'accent',
  'background',
  'foreground',
  'muted',
  'surface',
  'border',
  'success',
  'warning',
  'danger',
  'radius',
  'spacing',
] as const;

const CSS_MAP: Record<string, string> = {
  accent: '--color-accent',
  background: '--color-bg',
  foreground: '--color-fg',
  muted: '--color-muted',
  surface: '--color-surface',
  border: '--color-border',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
  radius: '--radius-md',
  spacing: '--space-3',
};

export function ThemeEditorFull() {
  const [tokens, setTokens] = useState<ThemeTokens>({});
  const [version, setVersion] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    logger.debug('dashboard.theme.resolve', {});
    try {
      const doc = await fetchTheme();
      const t = (doc.tokens ?? doc) as ThemeTokens;
      setTokens(t);
      setVersion(typeof doc.version === 'number' ? doc.version : undefined);
      for (const [k, v] of Object.entries(t)) {
        const css = CSS_MAP[k];
        if (css && typeof v === 'string') document.documentElement.style.setProperty(css, v);
      }
      logger.debug('dashboard.theme.apply', { source: 'api' });
    } catch (e) {
      setError(e instanceof DashApiError ? e.message : 'Theme API unavailable');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.theme' });
    void load();
  }, []);

  function setToken(key: string, value: string) {
    setTokens((prev) => ({ ...prev, [key]: value }));
    const css = CSS_MAP[key];
    if (css) document.documentElement.style.setProperty(css, value);
    logger.debug('dashboard.theme.apply', { key });
  }

  async function publish() {
    setStatus('Publishing…');
    try {
      const saved = await saveTheme(tokens, version);
      setVersion(typeof saved.version === 'number' ? saved.version : version);
      setStatus('Theme saved.');
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Save failed');
    }
  }

  if (loading) return <LoadingState label="Loading theme…" />;
  if (error) return <ErrorState title="Theme unavailable" message={error} onRetry={() => void load()} />;

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Theme</h1>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={() => void publish()}>
          Save theme
        </Button>
        <Button onClick={() => void load()}>Reload</Button>
      </div>
      {status ? <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>{status}</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12 }}>
        {TOKEN_KEYS.map((key) => {
          const value = String(tokens[key] ?? '');
          const isColor = !['radius', 'spacing'].includes(key);
          return (
            <Card key={key} title={key}>
              <Input
                type={isColor && value.startsWith('#') ? 'color' : 'text'}
                value={value || (isColor ? '#888888' : '')}
                onChange={(e) => setToken(key, e.target.value)}
                aria-label={key}
              />
            </Card>
          );
        })}
      </div>
    </Stack>
  );
}
