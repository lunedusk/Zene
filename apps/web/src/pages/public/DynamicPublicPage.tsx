import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { applyPublicMetadata } from '../../public/metadata.js';
import { SectionRenderer } from '../../public/SectionRenderer.js';
import type { PublicSection, PublicSiteConfig } from '../../public/sectionTypes.js';
import { logger } from '../../lib/logger.js';

export function DynamicPublicPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<PublicSection[]>([]);
  const [title, setTitle] = useState(slug);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = (await apiClient.request<{
          payload?: PublicSiteConfig | { title?: string; sections?: PublicSection[] };
          version?: number;
        }>(`/public/pages/${encodeURIComponent(slug)}`)) as {
          payload?: PublicSiteConfig | { title?: string; sections?: PublicSection[] };
        };
        const payload = data.payload;
        const secs = payload && 'sections' in payload && Array.isArray(payload.sections) ? payload.sections : [];
        setSections([...secs].filter((s) => s.enabled).sort((a, b) => a.order - b.order));
        const t =
          payload && 'metadata' in payload && payload.metadata?.title
            ? payload.metadata.title
            : payload && 'title' in payload && typeof payload.title === 'string'
              ? payload.title
              : slug;
        setTitle(t);
        applyPublicMetadata({ title: t, path: `/p/${slug}` });
        logger.debug('web.public.surface.loaded', { slug, sections: secs.length });
      } catch (e) {
        setError(e instanceof DashApiError ? e.message : 'Page not found');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  if (loading) return <LoadingState label="Loading page…" />;
  if (error) return <ErrorState title="Not found" message={error} />;
  if (sections.length === 0) {
    return <EmptyState title={title} description="This page has no published sections." />;
  }
  return (
    <Stack gap={24}>
      <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
      {sections.map((s) => (
        <SectionRenderer key={s.id} section={s} />
      ))}
    </Stack>
  );
}
