/**
 * Draft/version preview — SectionRenderer for public_site, LayoutGrid for layouts.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, ErrorState, LoadingState, Stack, Button } from '../../design-system/primitives.js';
import { LayoutGrid } from '../../layout/LayoutGrid.js';
import { createEmptyBreakpoint } from '../../layout/engine.js';
import { renderBuiltinWidget } from '../../widgets/builtin.js';
import type { LayoutBreakpointState, WidgetInstance } from '../../widgets/types.js';
import { SectionRenderer } from '../../public/SectionRenderer.js';
import type { PublicSection, PublicSiteConfig } from '../../public/sectionTypes.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { logger } from '../../lib/logger.js';
import { getIdentity } from '../../identity/store.js';

function payloadToLayout(payload: unknown): LayoutBreakpointState {
  const bp = createEmptyBreakpoint('desktop');
  if (!payload || typeof payload !== 'object') return bp;
  const grid = payload as { widgets?: WidgetInstance[] };
  if (Array.isArray(grid.widgets)) bp.widgets = grid.widgets;
  return bp;
}

function isPublicSite(payload: unknown): payload is PublicSiteConfig {
  return !!payload && typeof payload === 'object' && Array.isArray((payload as PublicSiteConfig).sections);
}

export function PreviewPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<unknown>(null);
  const [meta, setMeta] = useState<{ targetKind?: string; targetKey?: string; version?: number }>({});
  const [breakpoint, setBreakpoint] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

  useEffect(() => {
    let el = document.querySelector('meta[name="robots"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    el.setAttribute('content', 'noindex, nofollow');
    document.title = `Preview · ${getIdentity().botName}`;
  }, []);

  useEffect(() => {
    if (!token) {
      setError('Missing preview token');
      setLoading(false);
      return;
    }
    void (async () => {
      setLoading(true);
      setError(null);
      logger.debug('web.public.cms.preview.opened', {});
      try {
        const data = (await apiClient.request<{
          record?: { payload?: unknown; version?: number; targetKind?: string; targetKey?: string };
          claims?: { targetKind?: string; targetKey?: string };
        }>('/owner/overrides/preview/validate', { query: { token } })) as {
          record?: { payload?: unknown; version?: number; targetKind?: string; targetKey?: string };
          claims?: { targetKind?: string; targetKey?: string };
        };
        const record = data.record;
        setPayload(record?.payload ?? null);
        setMeta({
          targetKind: record?.targetKind ?? data.claims?.targetKind,
          targetKey: record?.targetKey ?? data.claims?.targetKey,
          version: record?.version,
        });
      } catch (e) {
        setError(e instanceof DashApiError ? e.message : 'Invalid or expired preview');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const publicSections: PublicSection[] = useMemo(() => {
    if (!isPublicSite(payload)) return [];
    return [...payload.sections].filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  }, [payload]);

  const layout = useMemo(() => {
    if (isPublicSite(payload)) return null;
    const base = payloadToLayout(payload);
    if (breakpoint === 'tablet') return { ...base, columns: 8, breakpoint: 'tablet' as const };
    if (breakpoint === 'mobile') return { ...base, columns: 4, breakpoint: 'mobile' as const };
    return base;
  }, [payload, breakpoint]);

  if (loading) return <LoadingState label="Loading preview…" />;
  if (error) return <ErrorState title="Preview unavailable" message={error} />;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)', color: 'var(--color-fg)', padding: 16 }}>
      <div
        role="status"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'var(--color-warning, #b45309)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: 8,
          marginBottom: 16,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>
          DRAFT / PREVIEW · {meta.targetKind}:{meta.targetKey}
          {meta.version != null ? ` · v${meta.version}` : ''} · non-indexable
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['desktop', 'tablet', 'mobile'] as const).map((b) => (
            <Button key={b} variant={breakpoint === b ? 'primary' : 'default'} onClick={() => setBreakpoint(b)}>
              {b}
            </Button>
          ))}
          <Button onClick={() => window.close()}>Exit preview</Button>
        </div>
      </div>
      <Card title={`${getIdentity().botName} preview`}>
        {publicSections.length > 0 ? (
          <Stack gap={24}>
            {publicSections.map((s) => (
              <SectionRenderer key={s.id} section={s} />
            ))}
          </Stack>
        ) : layout ? (
          <LayoutGrid state={layout} renderWidget={renderBuiltinWidget} />
        ) : (
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>No renderable draft payload.</p>
        )}
      </Card>
    </div>
  );
}
