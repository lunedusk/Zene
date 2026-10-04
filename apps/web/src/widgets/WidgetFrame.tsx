import type { PropsWithChildren, ReactNode } from 'react';
import { Card, EmptyState, ErrorState, LoadingState } from '../design-system/primitives.js';

export type WidgetLoadState = 'loading' | 'ready' | 'empty' | 'error';

export function WidgetFrame({
  title,
  state = 'ready',
  errorMessage,
  onRetry,
  actions,
  children,
}: PropsWithChildren<{
  title: string;
  state?: WidgetLoadState;
  errorMessage?: string;
  onRetry?: () => void;
  actions?: ReactNode;
}>) {
  return (
    <Card title={title}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>{actions}</div>
      {state === 'loading' ? <LoadingState label={`Loading ${title}`} /> : null}
      {state === 'empty' ? <EmptyState title="No data" description="Nothing to show yet." /> : null}
      {state === 'error' ? (
        <ErrorState title="Unable to load widget" message={errorMessage} onRetry={onRetry} />
      ) : null}
      {state === 'ready' ? children : null}
    </Card>
  );
}
