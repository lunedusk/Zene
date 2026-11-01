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
import { CompositionRenderer } from '../../composition/renderer.js';
import { isCompositionDocument } from '../../composition/schema.js';
import type { CompositionDocument } from '../../composition/types.js';

type PublicSiteApiResponse =
  | {
      kind: 'composition';
      document: CompositionDocument;
      publishedVersion?: number | null;
      publishedAt?: number | null;
    }
  | (PublicSiteConfig & {
      kind?: undefined | string;
      document?: undefined;
      publishedVersion?: number | null;
      publishedAt?: number | null;
    });

function isCanonicalSiteResponse(
  data: PublicSiteApiResponse,
): data is Extract<PublicSiteApiResponse, { kind: 'composition' }> {
  return data.kind === 'composition' && isCompositionDocument(data.document);
}

export function PublicHomePage() {
  const id = getIdentity();
  const [site, setSite] = useState<PublicSiteApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = (await apiClient.request<PublicSiteApiResponse>('/public/site')) as PublicSiteApiResponse;
        setSite(data);
        if (isCanonicalSiteResponse(data)) {
          logger.debug('web.public.surface.loaded', {
            kind: 'composition',
            version: data.publishedVersion,
          });
        } else {
          logger.debug('web.public.surface.loaded', {
            kind: 'legacy',
            version: data.publishedVersion ?? data.version,
            sections: data.sections?.length ?? 0,
          });
        }
        trackPublic('page_view', { path: '/' });
      } catch (e) {
        setError(e instanceof DashApiError ? e.message : 'Public site unavailable');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const compositionTitle =
    site && isCanonicalSiteResponse(site)
      ? typeof site.document.metadata?.title === 'string'
        ? site.document.metadata.title
        : undefined
      : undefined;
  const compositionDescription =
    site && isCanonicalSiteResponse(site)
      ? typeof site.document.metadata?.description === 'string'
        ? site.document.metadata.description
        : undefined
      : undefined;
  const legacyTitle =
    site && !isCanonicalSiteResponse(site) ? site.metadata?.title : undefined;
  const legacyDescription =
    site && !isCanonicalSiteResponse(site) ? site.metadata?.description : undefined;

  useEffect(() => {
    applyPublicMetadata({
      title: compositionTitle ?? legacyTitle,
      description:
        compositionDescription ??
        legacyDescription ??
        `${id.botName} helps you run Discord communities with permissions, plugins, and a dashboard.`,
      path: '/',
    });
  }, [id.botName, compositionTitle, compositionDescription, legacyTitle, legacyDescription]);

  const sections = useMemo(() => {
    if (!site || isCanonicalSiteResponse(site) || !site.sections) return [];
    return [...site.sections].filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  }, [site]);

  if (loading) return <LoadingState label="Loading site…" />;
  if (error) return <ErrorState title="Site unavailable" message={error} />;

  if (site && isCanonicalSiteResponse(site)) {
    return (
      <Stack gap={32}>
        <CompositionRenderer document={site.document} mode="published" />
        {site.publishedVersion != null ? (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-muted)' }}>
            Published configuration v{site.publishedVersion}
          </p>
        ) : null}
      </Stack>
    );
  }

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
