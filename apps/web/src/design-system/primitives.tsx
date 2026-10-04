import type { ButtonHTMLAttributes, InputHTMLAttributes, PropsWithChildren, ReactNode } from 'react';

const baseBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  padding: '8px 14px',
  font: 'inherit',
  cursor: 'pointer',
  background: 'var(--color-surface)',
  color: 'var(--color-fg)',
  transition: 'background var(--motion-fast), border-color var(--motion-fast)',
};

export function Button({
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' }) {
  const style: React.CSSProperties = { ...baseBtn };
  if (variant === 'primary') {
    style.background = 'var(--color-accent)';
    style.color = 'var(--color-accent-fg)';
    style.borderColor = 'transparent';
  } else if (variant === 'danger') {
    style.background = 'var(--color-danger)';
    style.color = '#fff';
    style.borderColor = 'transparent';
  } else if (variant === 'ghost') {
    style.background = 'transparent';
    style.borderColor = 'transparent';
  }
  return <button type="button" {...props} style={{ ...style, ...props.style }} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%',
        padding: '8px 12px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-fg)',
        font: 'inherit',
        ...props.style,
      }}
    />
  );
}

export function Card({ children, title }: PropsWithChildren<{ title?: string }>) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {title ? (
        <h2 style={{ margin: '0 0 var(--space-3)', fontSize: 16, fontWeight: 600 }}>{title}</h2>
      ) : null}
      {children}
    </section>
  );
}

export function Stack({ children, gap = 12 }: PropsWithChildren<{ gap?: number }>) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap }}>{children}</div>;
}

export function Badge({ children }: PropsWithChildren) {
  return (
    <span
      style={{
        display: 'inline-flex',
        padding: '2px 8px',
        borderRadius: 999,
        background: 'var(--color-surface-2)',
        color: 'var(--color-muted)',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: number | string }) {
  return (
    <div
      aria-hidden
      style={{
        height,
        width,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--color-surface-2)',
        animation: 'pulse 1.2s ease-in-out infinite',
      }}
    />
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--color-muted)' }}>
      <div style={{ fontWeight: 600, color: 'var(--color-fg)', marginBottom: 8 }}>{title}</div>
      {description ? <p style={{ margin: '0 0 16px' }}>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title, message, onRetry }: { title: string; message?: string; onRetry?: () => void }) {
  return (
    <div role="alert" style={{ padding: 'var(--space-5)', border: '1px solid var(--color-danger)', borderRadius: 'var(--radius-md)' }}>
      <div style={{ fontWeight: 600, color: 'var(--color-danger)' }}>{title}</div>
      {message ? <p style={{ color: 'var(--color-muted)' }}>{message}</p> : null}
      {onRetry ? (
        <Button variant="primary" onClick={onRetry} style={{ marginTop: 12 }}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ padding: 'var(--space-5)' }}>
      <Skeleton height={20} width="40%" />
      <div style={{ height: 12 }} />
      <Skeleton height={12} />
      <div style={{ height: 8 }} />
      <Skeleton height={12} width="80%" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Alert({ tone = 'info', children }: PropsWithChildren<{ tone?: 'info' | 'success' | 'warning' | 'danger' }>) {
  const color =
    tone === 'success'
      ? 'var(--color-success)'
      : tone === 'warning'
        ? 'var(--color-warning)'
        : tone === 'danger'
          ? 'var(--color-danger)'
          : 'var(--color-info)';
  return (
    <div
      role="status"
      style={{
        padding: '10px 14px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${color}`,
        background: 'var(--color-surface)',
        color: 'var(--color-fg)',
      }}
    >
      {children}
    </div>
  );
}
