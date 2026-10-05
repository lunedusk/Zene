



import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Stack } from '../../design-system/primitives.js';
import { apiClient } from '../../api/client.js';
import { DashApiError } from '../../api/types.js';
import type { PublicSection, PublicSiteConfig } from '../../public/sectionTypes.js';
import { logger } from '../../lib/logger.js';
import { PublishingPanel } from './PublishingPanel.js';

const TARGET = { targetKind: 'public_site', targetKey: 'default' };

export function PublicSiteEditorPage() {
  const [site, setSite] = useState<PublicSiteConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {

      const cur = (await apiClient.request<{ payload?: PublicSiteConfig } | null>('/owner/overrides/current', {
        query: TARGET,
      })) as { payload?: PublicSiteConfig } | null;
      if (cur?.payload) {
        setSite(cur.payload as PublicSiteConfig);
      } else {
        const published = (await apiClient.request<PublicSiteConfig>('/public/site')) as PublicSiteConfig;
        setSite(published);
      }
      logger.debug('web.public.cms.draft.loaded', {});
    } catch (e) {
      setError(e instanceof DashApiError ? e.message : 'Unable to load public site draft');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveDraft() {
    if (!site) return;
    setStatus('Saving draft…');
    try {
      await apiClient.request('/owner/overrides/draft', {
        method: 'POST',
        body: {
          ...TARGET,
          payload: site,
          changeSummary: 'public site draft',
        },
      });
      setStatus('Draft saved');
      logger.debug('web.public.cms.draft.loaded', { action: 'saved' });
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Save failed');
    }
  }

  function updateSection(id: string, patch: Partial<PublicSection>) {
    if (!site) return;
    setSite({
      ...site,
      sections: site.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  function move(id: string, dir: -1 | 1) {
    if (!site) return;
    const sorted = [...site.sections].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((s) => s.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= sorted.length) return;
    const a = sorted[idx]!;
    const b = sorted[j]!;
    const ao = a.order;
    updateSection(a.id, { order: b.order });

    setSite((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        sections: prev.sections.map((s) => {
          if (s.id === a.id) return { ...s, order: b.order };
          if (s.id === b.id) return { ...s, order: ao };
          return s;
        }),
      };
    });
  }

  if (loading) return <LoadingState label="Loading public CMS…" />;
  if (error) return <ErrorState title="Public CMS unavailable" message={error} onRetry={() => void load()} />;
  if (!site) return <EmptyState title="No site configuration" />;

  const selected = site.sections.find((s) => s.id === selectedId) ?? null;
  const ordered = [...site.sections].sort((a, b) => a.order - b.order);

  return (
    <Stack gap={16}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Public site</h1>
        <Button variant="primary" onClick={() => void saveDraft()}>
          Save draft
        </Button>
      </div>
      {status ? <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>{status}</p> : null}
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(200px, 280px) 1fr' }}>
        <Card title="Sections">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {ordered.map((s) => (
              <li key={s.id} style={{ marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => setSelectedId(s.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--color-border)',
                    background: selectedId === s.id ? 'var(--color-surface-2)' : 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {s.type} · {s.id} {s.enabled ? '' : '(off)'}
                </button>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  <Button onClick={() => move(s.id, -1)}>↑</Button>
                  <Button onClick={() => move(s.id, 1)}>↓</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Inspector">
          {selected ? (
            <Stack gap={8}>
              <label>
                Enabled
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => updateSection(selected.id, { enabled: e.target.checked })}
                />
              </label>
              <label>
                Title / headline
                <Input
                  value={selected.headline ?? selected.title ?? ''}
                  onChange={(e) =>
                    updateSection(selected.id, {
                      title: e.target.value,
                      headline: e.target.value,
                    })
                  }
                />
              </label>
              <label>
                Description / subhead
                <Input
                  value={selected.subhead ?? selected.description ?? selected.content ?? ''}
                  onChange={(e) =>
                    updateSection(selected.id, {
                      subhead: e.target.value,
                      description: e.target.value,
                      content: e.target.value,
                    })
                  }
                />
              </label>
              {selected.type === 'hero' || selected.type === 'cta' ? (
                <>
                  <label>
                    Primary CTA label
                    <Input
                      value={selected.primaryCtaLabel ?? selected.label ?? ''}
                      onChange={(e) =>
                        updateSection(selected.id, {
                          primaryCtaLabel: e.target.value,
                          label: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Primary CTA href
                    <Input
                      value={selected.primaryCtaHref ?? selected.href ?? ''}
                      onChange={(e) =>
                        updateSection(selected.id, {
                          primaryCtaHref: e.target.value,
                          href: e.target.value,
                        })
                      }
                    />
                  </label>
                </>
              ) : null}

              {selected.type === 'faq' ? (
                <Stack gap={8}>
                  <strong>FAQ items</strong>
                  {(selected.items ?? []).map((item, idx) => (
                    <div key={item.id} style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                      <Input
                        aria-label={`FAQ question ${idx + 1}`}
                        value={item.question ?? ''}
                        onChange={(e) => {
                          const items = [...(selected.items ?? [])];
                          items[idx] = { ...item, question: e.target.value };
                          updateSection(selected.id, { items });
                        }}
                      />
                      <Input
                        aria-label={`FAQ answer ${idx + 1}`}
                        value={item.answer ?? ''}
                        onChange={(e) => {
                          const items = [...(selected.items ?? [])];
                          items[idx] = { ...item, answer: e.target.value };
                          updateSection(selected.id, { items });
                        }}
                      />
                    </div>
                  ))}
                  <Button
                    onClick={() => {
                      const items = [
                        ...(selected.items ?? []),
                        { id: `q_${Date.now()}`, question: 'New question', answer: '' },
                      ];
                      updateSection(selected.id, { items });
                    }}
                  >
                    Add FAQ item
                  </Button>
                </Stack>
              ) : null}
              {selected.type === 'screenshots' ? (
                <Stack gap={8}>
                  <strong>Media (URL in icon field)</strong>
                  {(selected.items ?? []).map((item, idx) => (
                    <div key={item.id}>
                      <Input
                        aria-label={`Media URL ${idx + 1}`}
                        value={item.icon ?? ''}
                        onChange={(e) => {
                          const items = [...(selected.items ?? [])];
                          items[idx] = { ...item, icon: e.target.value };
                          updateSection(selected.id, { items });
                        }}
                      />
                      <Input
                        aria-label={`Caption ${idx + 1}`}
                        value={item.title ?? ''}
                        onChange={(e) => {
                          const items = [...(selected.items ?? [])];
                          items[idx] = { ...item, title: e.target.value };
                          updateSection(selected.id, { items });
                        }}
                      />
                    </div>
                  ))}
                  <Button
                    onClick={() => {
                      const items = [
                        ...(selected.items ?? []),
                        { id: `m_${Date.now()}`, title: 'Screenshot', icon: '' },
                      ];
                      updateSection(selected.id, { items });
                    }}
                  >
                    Add media item
                  </Button>
                </Stack>
              ) : null}

            </Stack>
          ) : (
            <p style={{ margin: 0, color: 'var(--color-muted)' }}>Select a section</p>
          )}
        </Card>
      </div>
      <PublishingPanel targetKind={TARGET.targetKind} targetKey={TARGET.targetKey} />
    </Stack>
  );
}
