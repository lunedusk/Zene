import { useEffect, useState } from 'react';
import { Button, Card, Input, Stack } from '../../design-system/primitives.js';
import { defaultNavigation } from '../../nav/defaultNav.js';
import {
  addNavItem,
  draftFromItems,
  removeNavItem,
  renameNavItem,
  reorderNavItem,
  setNavItemHref,
  setNavItemBit,
  toNavOrder,
  type NavigationDraft,
} from '../../editor/navigationDraft.js';
import { fetchLayout, saveLayout } from '../../api/dashboardApis.js';
import { logger } from '../../lib/logger.js';
import { DashApiError } from '../../api/types.js';

export function NavigationEditorPage() {
  const [draft, setDraft] = useState<NavigationDraft>(() => draftFromItems(defaultNavigation));
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [status, setStatus] = useState<string>('');
  const [layoutVersion, setLayoutVersion] = useState<number | undefined>();
  const [layoutId, setLayoutId] = useState('global-main');

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'owner.navigation' });
    logger.debug('dashboard.navigation.load', {});
    void (async () => {
      try {
        const layout = await fetchLayout('global');
        if (layout) {
          setLayoutId(layout.id || 'global-main');
          setLayoutVersion(typeof layout.version === 'number' ? layout.version : undefined);
          if (Array.isArray(layout.navOrder) && layout.navOrder.length) {

            let next = draftFromItems(defaultNavigation);
            const order = layout.navOrder as string[];
            const map = new Map(next.items.map((i) => [i.id, i]));
            const ordered = order.map((id, idx) => {
              const item = map.get(id);
              return item ? { ...item, order: (idx + 1) * 10 } : null;
            }).filter(Boolean) as typeof next.items;
            const rest = next.items.filter((i) => !order.includes(i.id));
            next = { ...next, items: [...ordered, ...rest], dirty: false };
            setDraft(next);
          }
        }
      } catch (e) {
        setStatus(e instanceof DashApiError ? e.message : 'Layout load unavailable');
      }
    })();
  }, []);

  const selected = draft.items.find((i) => i.id === selectedId);

  async function persist() {
    setStatus('Saving…');
    logger.debug('dashboard.navigation.save', { itemCount: draft.items.length });
    try {
      const existing = await fetchLayout('global');
      const grid = existing?.grid ?? { widgets: [] };
      const saved = await saveLayout({
        id: layoutId,
        scope: 'global',
        name: existing?.name ? String(existing.name) : 'Global',
        grid,
        version: layoutVersion,
        navOrder: toNavOrder(draft),
      });
      setLayoutVersion(typeof saved.version === 'number' ? saved.version : layoutVersion);
      setDraft((d) => ({ ...d, dirty: false }));
      setStatus('Saved navigation order to layout (owner override layer).');
      logger.debug('dashboard.publish.completed', { resource: 'navigation' });
    } catch (e) {
      setStatus(e instanceof DashApiError ? e.message : 'Save failed');
      logger.debug('dashboard.publish.failed', {
        resource: 'navigation',
        reason: e instanceof Error ? e.message : 'unknown',
      });
    }
  }

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Navigation</h1>
      <p style={{ margin: 0, color: 'var(--color-muted)' }}>
        Owner override of navigation order and items. Visibility still filtered by backend authorization at runtime.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button
          variant="primary"
          onClick={() => {
            const id = `nav_${Date.now()}`;
            setDraft((d) =>
              addNavItem(d, {
                id,
                label: 'New item',
                href: '/dashboard',
                groupId: 'global',
              }),
            );
            setSelectedId(id);
          }}
        >
          Add item
        </Button>
        <Button variant="primary" onClick={() => void persist()} disabled={!draft.dirty}>
          Save draft
        </Button>
        <Button
          onClick={() => {
            setDraft(draftFromItems(defaultNavigation));
            setStatus('Reverted to defaults (local).');
          }}
        >
          Reset
        </Button>
      </div>
      {status ? <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>{status}</p> : null}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Items">
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {[...draft.items]
              .sort((a, b) => a.order - b.order)
              .map((item, index) => (
                <li key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      padding: 8,
                      borderRadius: 8,
                      border: selectedId === item.id ? '1px solid var(--color-accent)' : '1px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-fg)',
                      cursor: 'pointer',
                    }}
                  >
                    {item.label}
                    <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{item.href}</div>
                  </button>
                  <Button
                    onClick={() => setDraft((d) => reorderNavItem(d, item.id, Math.max(0, index - 1)))}
                    aria-label="Move up"
                  >
                    ↑
                  </Button>
                  <Button
                    onClick={() => setDraft((d) => reorderNavItem(d, item.id, index + 1))}
                    aria-label="Move down"
                  >
                    ↓
                  </Button>
                  <Button variant="danger" onClick={() => setDraft((d) => removeNavItem(d, item.id))}>
                    Delete
                  </Button>
                </li>
              ))}
          </ul>
        </Card>
        <Card title="Inspector">
          {selected ? (
            <Stack gap={8}>
              <label>
                Label
                <Input
                  value={selected.label}
                  onChange={(e) => setDraft((d) => renameNavItem(d, selected.id, e.target.value))}
                />
              </label>
              <label>
                Route
                <Input
                  value={selected.href}
                  onChange={(e) => setDraft((d) => setNavItemHref(d, selected.id, e.target.value))}
                />
              </label>
              <label>
                Required bit (optional)
                <Input
                  value={selected.requiredBit ?? ''}
                  onChange={(e) =>
                    setDraft((d) => setNavItemBit(d, selected.id, e.target.value || undefined))
                  }
                />
              </label>
            </Stack>
          ) : (
            <p style={{ margin: 0, color: 'var(--color-muted)' }}>Select an item</p>
          )}
        </Card>
      </div>
    </Stack>
  );
}
