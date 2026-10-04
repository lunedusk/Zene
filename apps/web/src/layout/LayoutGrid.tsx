import type { CSSProperties, ReactNode } from 'react';
import type { LayoutBreakpointState, WidgetInstance } from '../widgets/types.js';

export function LayoutGrid({
  state,
  renderWidget,
  onSelect,
  selectedId,
}: {
  state: LayoutBreakpointState;
  renderWidget: (w: WidgetInstance) => ReactNode;
  onSelect?: (instanceId: string) => void;
  selectedId?: string;
}) {
  const style: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${state.columns}, minmax(0, 1fr))`,
    gap: 'var(--space-3)',
    alignItems: 'stretch',
  };

  return (
    <div style={style} role="list" aria-label="Dashboard layout">
      {state.widgets.map((w) => {
        const itemStyle: CSSProperties = {
          gridColumn: `${w.col + 1} / span ${w.colSpan}`,
          gridRow: `${w.row + 1} / span ${w.rowSpan}`,
          minHeight: 96,
          outline: selectedId === w.instanceId ? '2px solid var(--color-accent)' : undefined,
          outlineOffset: 2,
          borderRadius: 'var(--radius-lg)',
        };
        return (
          <div
            key={w.instanceId}
            role="listitem"
            style={itemStyle}
            tabIndex={0}
            onClick={() => onSelect?.(w.instanceId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(w.instanceId);
              }
            }}
          >
            {renderWidget(w)}
          </div>
        );
      })}
    </div>
  );
}
