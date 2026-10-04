/**
 * Public homepage — published CMS sections from /api/dash/public/site.
 */

import { useEffect, useMemo, useState } from 'react';
import { Card, EmptyState, ErrorState, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { getIdentity } from '../../identity/store.js';
import { applyPublicMetadata } from '../../public/metadata.js';
import { SectionRenderer } from '../../public/SectionRenderer.js';
import type { PublicSiteConfig } from '../../public/sectionTypes.js';
import { trackPublic } from '../../telemetry/publicTelemetry.js';
import { logger } from '../../lib/logger.js';

export function PublicHomePage() {
  const id = getIdentity();
  const [site, setSite] = useState<PublicSiteConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = (await apiClient.request<PublicSiteConfig>('/public/site')) as PublicSiteConfig;
        setSite(data);
        logger.debug('web.public.surface.loaded', {
          version: data.publishedVersion ?? data.version,
          sections: data.sections?.length ?? 0,
        });
        trackPublic('page_view', { path: '/' });
      } catch (e) {
        setError(e instanceof DashApiError ? e.message : 'Public site unavailable');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    applyPublicMetadata({
      title: site?.metadata?.title,
      description:
        site?.metadata?.description ??
        `${id.botName} helps you run Discord communities with permissions, plugins, and a dashboard.`,
      path: '/',
    });
  }, [id.botName, site?.metadata?.description, site?.metadata?.title]);

  const sections = useMemo(() => {
    if (!site?.sections) return [];
    return [...site.sections].filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  }, [site]);

  if (loading) return <LoadingState label="Loading site…" />;
  if (error) return <ErrorState title="Site unavailable" message={error} />;
  if (sections.length === 0) {
    return (
      <EmptyState
        title={id.botName}
        description="No public sections are published yet. Owners can configure the homepage under Owner → Public site."
      />
    );
  }

  return (
    <Stack gap={32}>
      {sections.map((section) => (
        <SectionRenderer key={section.id} section={section} />
      ))}
      {site?.publishedVersion != null ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>
          Published configuration v{site.publishedVersion}
        </p>
      ) : (
        <Card>
          <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
            Showing default public configuration. Publish from Owner → Public site to customize.
          </p>
        </Card>
      )}
    </Stack>
  );
}
