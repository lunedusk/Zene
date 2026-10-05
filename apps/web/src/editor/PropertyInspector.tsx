



import type { WidgetInstance, Breakpoint } from '../widgets/types.js';
import type { NavEditorItem } from './navigationDraft.js';
import type { PageDraft } from './pageDraft.js';
import { Input, Stack } from '../design-system/primitives.js';
import { logger } from '../lib/logger.js';

export type InspectorSelection =
  | { kind: 'none' }
  | { kind: 'widget'; widget: WidgetInstance }
  | { kind: 'page'; page: PageDraft }
  | { kind: 'nav'; item: NavEditorItem }
  | { kind: 'layout'; breakpoint: Breakpoint; columns: number };

export function PropertyInspector({
  selection,
  onChangeWidget,
  onChangePage,
  onChangeNav,
  onChangeLayoutColumns,
}: {
  selection: InspectorSelection;
  onChangeWidget?: (next: WidgetInstance) => void;
  onChangePage?: (next: PageDraft) => void;
  onChangeNav?: (next: NavEditorItem) => void;
  onChangeLayoutColumns?: (columns: number) => void;
}) {
  if (selection.kind === 'none') {
    return (
      <p style={{ margin: 0, color: 'var(--color-muted)', fontSize: 13 }}>
        Select a widget, page, or navigation item to inspect properties.
      </p>
    );
  }

  if (selection.kind === 'widget') {
    const w = selection.widget;
    return (
      <Stack gap={8}>
        <strong>Widget</strong>
        <label>
          Title
          <Input
            value={w.definition.title}
            onChange={(e) => {
              const next = {
                ...w,
                definition: { ...w.definition, title: e.target.value },
              };
              onChangeWidget?.(next);
              logger.debug('dashboard.inspector.property_changed', {
                kind: 'widget',
                field: 'title',
                instanceId: w.instanceId,
              });
            }}
          />
        </label>
        <label>
          Description
          <Input
            value={w.definition.description ?? ''}
            onChange={(e) =>
              onChangeWidget?.({
                ...w,
                definition: { ...w.definition, description: e.target.value },
              })
            }
          />
        </label>
        <label>
          Type
          <Input value={w.definition.type} readOnly />
        </label>
        <label>
          Col span
          <Input
            type="number"
            value={w.colSpan}
            min={1}
            onChange={(e) =>
              onChangeWidget?.({ ...w, colSpan: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </label>
        <label>
          Row span
          <Input
            type="number"
            value={w.rowSpan}
            min={1}
            onChange={(e) =>
              onChangeWidget?.({ ...w, rowSpan: Math.max(1, Number(e.target.value) || 1) })
            }
          />
        </label>
        <label>
          Column
          <Input
            type="number"
            value={w.col}
            min={0}
            onChange={(e) => onChangeWidget?.({ ...w, col: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label>
          Row
          <Input
            type="number"
            value={w.row}
            min={0}
            onChange={(e) => onChangeWidget?.({ ...w, row: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
      </Stack>
    );
  }

  if (selection.kind === 'page') {
    const p = selection.page;
    return (
      <Stack gap={8}>
        <strong>Page</strong>
        <label>
          Title
          <Input
            value={p.title}
            onChange={(e) => {
              onChangePage?.({ ...p, title: e.target.value, dirty: true });
              logger.debug('dashboard.inspector.property_changed', { kind: 'page', field: 'title' });
            }}
          />
        </label>
        <label>
          Route
          <Input
            value={p.route}
            onChange={(e) => onChangePage?.({ ...p, route: e.target.value, dirty: true })}
          />
        </label>
        <label>
          Description
          <Input
            value={p.description ?? ''}
            onChange={(e) => onChangePage?.({ ...p, description: e.target.value, dirty: true })}
          />
        </label>
      </Stack>
    );
  }

  if (selection.kind === 'nav') {
    const n = selection.item;
    return (
      <Stack gap={8}>
        <strong>Navigation item</strong>
        <label>
          Label
          <Input value={n.label} onChange={(e) => onChangeNav?.({ ...n, label: e.target.value })} />
        </label>
        <label>
          Route
          <Input value={n.href} onChange={(e) => onChangeNav?.({ ...n, href: e.target.value })} />
        </label>
        <label>
          Icon
          <Input value={n.icon ?? ''} onChange={(e) => onChangeNav?.({ ...n, icon: e.target.value || undefined })} />
        </label>
        <label>
          Required bit
          <Input
            value={n.requiredBit ?? ''}
            onChange={(e) => onChangeNav?.({ ...n, requiredBit: e.target.value || undefined })}
          />
        </label>
      </Stack>
    );
  }

  if (selection.kind === 'layout') {
    return (
      <Stack gap={8}>
        <strong>Layout ({selection.breakpoint})</strong>
        <label>
          Columns
          <Input
            type="number"
            min={1}
            max={24}
            value={selection.columns}
            onChange={(e) => onChangeLayoutColumns?.(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
      </Stack>
    );
  }

  return null;
}
