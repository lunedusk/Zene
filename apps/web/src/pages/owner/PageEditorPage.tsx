import { useEffect, useState } from 'react';
import { Button, Card, EmptyState, Input, Stack } from '../../design-system/primitives.js';
import {
  createPageDraft,
  duplicatePage,
  renamePage,
  setPageRoute,
  type PageDraft,
} from '../../editor/pageDraft.js';
import { logger } from '../../lib/logger.js';

export function PageEditorPage() {
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.pages' });
  }, []);

  const selected = pages.find((p) => p.pageId === selectedId);

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Pages</h1>
      <p style={{ margin: 0, color: 'var(--color-muted)' }}>
        Owner-created pages use the same layout/widget renderer as built-in pages. Persistence uses the layout override
        API when published.
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="primary"
          onClick={() => {
            const page = createPageDraft();
            setPages((p) => [...p, page]);
            setSelectedId(page.pageId);
          }}
        >
          Create page
        </Button>
        {selected ? (
          <>
            <Button
              onClick={() => {
                const copy = duplicatePage(selected);
                setPages((p) => [...p, copy]);
                setSelectedId(copy.pageId);
              }}
            >
              Duplicate
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                logger.debug('dashboard.page.delete', { pageId: selected.pageId });
                setPages((p) => p.filter((x) => x.pageId !== selected.pageId));
                setSelectedId(undefined);
              }}
            >
              Delete
            </Button>
          </>
        ) : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Pages">
          {pages.length === 0 ? (
            <EmptyState title="No custom pages" description="Create a page to start editing." />
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {pages.map((p) => (
                <li key={p.pageId}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(p.pageId);
                      logger.debug('dashboard.page.load', { pageId: p.pageId });
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      marginBottom: 8,
                      padding: 8,
                      borderRadius: 8,
                      border:
                        selectedId === p.pageId ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-fg)',
                      cursor: 'pointer',
                    }}
                  >
                    {p.title}
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{p.route}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Inspector">
          {selected ? (
            <Stack gap={8}>
              <label>
                Title
                <Input
                  value={selected.title}
                  onChange={(e) =>
                    setPages((all) => all.map((p) => (p.pageId === selected.pageId ? renamePage(p, e.target.value) : p)))
                  }
                />
              </label>
              <label>
                Route
                <Input
                  value={selected.route}
                  onChange={(e) =>
                    setPages((all) =>
                      all.map((p) => (p.pageId === selected.pageId ? setPageRoute(p, e.target.value) : p)),
                    )
                  }
                />
              </label>
              <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
                Layout editing for this page uses the Layout editor with surfaceId={selected.pageId}.
              </p>
            </Stack>
          ) : (
            <EmptyState title="Select a page" />
          )}
        </Card>
      </div>
    </Stack>
  );
}
