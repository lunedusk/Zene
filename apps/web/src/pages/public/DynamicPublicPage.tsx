import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { EmptyState, ErrorState, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import { applyPublicMetadata } from '../../public/metadata.js';
import { SectionRenderer } from '../../public/SectionRenderer.js';
import type { PublicSection, PublicSiteConfig } from '../../public/sectionTypes.js';
import { logger } from '../../lib/logger.js';
import { CompositionRenderer } from '../../composition/renderer.js';
import { isCompositionDocument } from '../../composition/schema.js';
import type { CompositionDocument } from '../../composition/types.js';

type PageApiResponse = {
  slug?: string;
  kind?: string;
  payload?: unknown;
  version?: number;
  updatedAt?: number;
};

export function DynamicPublicPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<PublicSection[]>([]);
  const [title, setTitle] = useState(slug);
  const [composition, setComposition] = useState<CompositionDocument | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      setComposition(null);
      setSections([]);
      try {
        const data = (await apiClient.request<PageApiResponse>(
          `/public/pages/${encodeURIComponent(slug)}`,
        )) as PageApiResponse;
        const payload = data.payload;

        if (data.kind === 'composition' || isCompositionDocument(payload)) {
          const doc = isCompositionDocument(payload) ? payload : null;
          if (!doc) {
            setError('Published composition is invalid');
            return;
          }
          setComposition(doc);
          const t =
            typeof doc.metadata?.title === 'string' && doc.metadata.title
              ? doc.metadata.title
              : typeof doc.name === 'string' && doc.name
                ? doc.name
                : slug;
          setTitle(t);
          applyPublicMetadata({
            title: t,
            description:
              typeof doc.metadata?.description === 'string' ? doc.metadata.description : undefined,
            path: `/p/${slug}`,
          });
          logger.debug('web.public.surface.loaded', { slug, kind: 'composition', version: data.version });
          return;
        }

        const legacy = payload as PublicSiteConfig | { title?: string; sections?: PublicSection[] } | undefined;
        const secs =
          legacy && 'sections' in legacy && Array.isArray(legacy.sections) ? legacy.sections : [];
        setSections([...secs].filter((s) => s.enabled).sort((a, b) => a.order - b.order));
        const t =
          legacy && 'metadata' in legacy && legacy.metadata?.title
            ? legacy.metadata.title
            : legacy && 'title' in legacy && typeof legacy.title === 'string'
              ? legacy.title
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

  if (composition) {
    return (
      <Stack gap={24}>
        <CompositionRenderer document={composition} mode="published" />
      </Stack>
    );
  }

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
