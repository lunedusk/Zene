/**
 * Production host for the compiled Vite SPA (apps/web/dist).
 *
 * Security boundary:
 * - Serves static assets from dist/ only (path-contained).
 * - Proxies a fixed allowlist of Core API prefixes for browser session traffic.
 * - NEVER injects the dashboard service API key into proxied user requests.
 * - NEVER honors client-supplied "service" flags or client Authorization as a
 *   reason to attach the service key.
 * - Strips hop-by-hop headers; forwards only session-relevant request headers.
 * - Service credential file is loaded only for process readiness diagnostics
 *   (presence check); the raw key is never logged or written into responses.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(__dirname, '..', 'dist');
const port = Number.parseInt(process.env.DASHBOARD_PORT || process.env.PORT || '5173', 10);
const coreBase = (process.env.CORE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const credFile = process.env.DASHBOARD_SERVICE_CREDENTIAL_FILE || '';

/** Browser-reachable Core prefixes (session/public). Anything else is 404 on this host. */
const PROXY_ALLOW_PREFIXES = [
  '/api/dash',
  '/api/health',
  '/api/openapi.json',
];

const FORWARD_HEADER_ALLOW = new Set([
  'accept',
  'accept-language',
  'content-type',
  'cookie',
  'if-match',
  'if-none-match',
  'idempotency-key',
  'x-dash-session',
  'x-zene-core-session',
  'x-discord-access-token',
  'x-dash-device-id',
  'x-request-id',
  // User session bearer used by DashApiClient — not the service key.
  'authorization',
]);

function credentialFilePresent() {
  if (!credFile) return false;
  try {
    if (!fs.existsSync(credFile)) return false;
    const st = fs.lstatSync(credFile);
    if (st.isSymbolicLink()) return false;
    const j = JSON.parse(fs.readFileSync(credFile, 'utf8'));
    return typeof j.key === 'string' && j.key.length >= 16 && j.label === 'dashboard-service';
  } catch {
    return false;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split('?')[0] || '/');
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const rel = decoded.replace(/^\/+/, '');
  if (rel.includes('..') || rel.toLowerCase().includes('.env')) return null;
  const abs = path.normalize(path.join(root, rel || 'index.html'));
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  return abs;
}

function isAllowedProxyPath(pathname) {
  return PROXY_ALLOW_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + '/'),
  );
}

function buildForwardHeaders(req) {
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    const lower = name.toLowerCase();
    if (!FORWARD_HEADER_ALLOW.has(lower)) continue;
    // Explicitly drop any client attempt to mark a "service" call.
    if (lower === 'x-zene-dashboard-service') continue;
    headers[lower] = value;
  }
  headers.host = new URL(coreBase).host;
  return headers;
}

function proxyApi(req, res) {
  const incoming = new URL(req.url || '/', 'http://dashboard.local');
  if (!isAllowedProxyPath(incoming.pathname)) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found', message: 'Path is not exposed through the dashboard host.' }));
    return;
  }

  const target = new URL(incoming.pathname + incoming.search, coreBase);
  const headers = buildForwardHeaders(req);

  const upstream = http.request(
    target,
    { method: req.method, headers },
    (up) => {
      const outHeaders = { ...up.headers };
      // Prevent accidental leakage of upstream internal headers if any.
      delete outHeaders['x-zene-dashboard-service-key'];
      res.writeHead(up.statusCode || 502, outHeaders);
      up.pipe(res);
    },
  );
  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad_gateway', message: err.message }));
  });
  req.pipe(upstream);
}

function serveStatic(req, res) {
  const urlPath = req.url?.split('?')[0] || '/';
  let filePath = safeJoin(distRoot, urlPath === '/' ? '/index.html' : urlPath);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(distRoot, 'index.html');
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('Dashboard UI assets missing (apps/web/dist).');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  fs.createReadStream(filePath).pipe(res);
}

if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
  console.error('dashboard-host: dist/index.html not found at', distRoot);
  process.exit(1);
}

if (!credentialFilePresent()) {
  console.error('dashboard-host: service credential file missing or invalid (path not logged with contents)');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const p = req.url?.split('?')[0] || '/';

  if (p === '/readyz' || p === '/healthz') {
    const ok = credentialFilePresent() && fs.existsSync(path.join(distRoot, 'index.html'));
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok, role: 'dashboard-host' }));
    return;
  }

  if (p === '/api' || p.startsWith('/api/')) {
    proxyApi(req, res);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405);
    res.end();
    return;
  }
  serveStatic(req, res);
});

server.listen(port, '0.0.0.0', () => {
  console.info(`dashboard-host listening on :${port} (core origin configured; service key never logged)`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
