import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, Stack } from '../../design-system/primitives.js';
import { searchDashboard } from '../../api/dashboardApis.js';
import { logger } from '../../lib/logger.js';
import { DashApiError } from '../../api/types.js';

interface SearchItem {
  id: string;
  kind?: string;
  title: string;
  snippet?: string;
  href?: string;
}

export function SearchPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SearchItem[]>([]);

  useEffect(() => {
    logger.debug('dashboard.page.resolve', { page: 'search' });
  }, []);

  async function runSearch() {
    setLoading(true);
    setError(null);
    try {
      const data = (await searchDashboard(q, 1, 20)) as {
        items?: Array<Record<string, unknown>>;
      };
      const list = (data.items ?? []).map((raw) => ({
        id: String(raw.id ?? ''),
        kind: typeof raw.kind === 'string' ? raw.kind : undefined,
        title: String(raw.title ?? raw.id ?? 'Result'),
        snippet: typeof raw.snippet === 'string' ? raw.snippet : undefined,
        href: typeof raw.href === 'string' ? raw.href : undefined,
      }));
      setItems(list);
    } catch (e) {
      setItems([]);
      setError(e instanceof DashApiError ? e.message : e instanceof Error ? e.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack gap={16}>
      <h1 style={{ margin: 0, fontSize: 22 }}>Search</h1>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <Input
            aria-label="Search query"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dashboard…"
          />
          <Button variant="primary" type="submit">
            Search
          </Button>
        </form>
      </Card>
      {loading ? <LoadingState label="Searching…" /> : null}
      {error ? <ErrorState title="Search failed" message={error} onRetry={() => void runSearch()} /> : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState title="No results" description="Authorized results only. Empty may mean no matches or no access." />
      ) : null}
      {!loading && items.length > 0 ? (
        <Stack gap={8}>
          {items.map((item) => (
            <Card key={item.id}>
              <div style={{ fontWeight: 600 }}>{item.title}</div>
              {item.kind ? <div style={{ color: 'var(--color-muted)', fontSize: 13 }}>{item.kind}</div> : null}
              {item.snippet ? <p style={{ margin: '8px 0 0', color: 'var(--color-muted)' }}>{item.snippet}</p> : null}
              {item.href ? (
                <p style={{ margin: '8px 0 0' }}>
                  <Link to={item.href}>Open</Link>
                </p>
              ) : null}
            </Card>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
