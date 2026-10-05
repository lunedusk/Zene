import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLogLevel, logger, sanitizeFields, setLogLevel, setLoggerSink } from './logger.js';

function assertNoSecret(value: unknown, secret = 'secret'): void {
  const text = JSON.stringify(value);
  assert.equal(text.includes(secret), false, `secret leaked: ${text}`);
}

describe('logger safety', () => {
  it('redacts sensitive keys at top level', () => {
    const s = sanitizeFields({
      path: '/api/dash/me',
      authorization: 'Bearer secret-token',
      token: 'abc',
      sessionToken: 'xyz',
      accessToken: 'at',
      refreshToken: 'rt',
      apiKey: 'k',
      clientSecret: 'cs',
      requestId: 'r1',
      tokenCount: 3,
      tokenType: 'Bearer',
    });
    assert.equal(s?.path, '/api/dash/me');
    assert.equal(s?.authorization, '[redacted]');
    assert.equal(s?.token, '[redacted]');
    assert.equal(s?.sessionToken, '[redacted]');
    assert.equal(s?.accessToken, '[redacted]');
    assert.equal(s?.refreshToken, '[redacted]');
    assert.equal(s?.apiKey, '[redacted]');
    assert.equal(s?.clientSecret, '[redacted]');
    assert.equal(s?.requestId, 'r1');

    assert.equal(s?.tokenCount, 3);
    assert.equal(s?.tokenType, 'Bearer');
  });

  it('redacts nested object secrets', () => {
    const s = sanitizeFields({
      auth: { token: 'secret', userId: '123' },
    });
    const auth = s?.auth as Record<string, unknown>;
    assert.equal(auth.token, '[redacted]');
    assert.equal(auth.userId, '123');
    assertNoSecret(s);
  });

  it('redacts secrets inside arrays', () => {
    const s = sanitizeFields({
      users: [{ userId: '123', token: 'secret' }],
    });
    const users = s?.users as Array<Record<string, unknown>>;
    assert.equal(users[0]?.userId, '123');
    assert.equal(users[0]?.token, '[redacted]');
    assertNoSecret(s);
  });

  it('redacts secrets inside nested arrays', () => {
    const s = sanitizeFields({
      data: [[{ refreshToken: 'secret', ok: true }]],
    });
    const data = s?.data as unknown[][];
    const row = data[0]?.[0] as Record<string, unknown>;
    assert.equal(row.refreshToken, '[redacted]');
    assert.equal(row.ok, true);
    assertNoSecret(s);
  });

  it('redacts authorization header objects', () => {
    const s = sanitizeFields({
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
    });
    const headers = s?.headers as Record<string, unknown>;
    assert.equal(headers.authorization, '[redacted]');
    assert.equal(headers['content-type'], 'application/json');
    assertNoSecret(s);
  });

  it('redacts token query params in SSE-like URLs', () => {
    const s = sanitizeFields({
      url: '/api/dash/events/sse?token=secret&x=1',
      path: '/api/dash/events/sse',
    });
    assert.equal(s?.path, '/api/dash/events/sse');
    assert.equal(typeof s?.url, 'string');
    assert.equal(String(s?.url).includes('secret'), false);
    assert.equal(String(s?.url).includes('token=[redacted]'), true);
  });

  it('redacts Bearer strings even under safe keys', () => {
    const s = sanitizeFields({
      message: 'Authorization Bearer secret-value failed',
    });
    assert.equal(String(s?.message).includes('secret-value'), false);
  });

  it('disabled level emits nothing', () => {
    const prev = getLogLevel();
    const calls: unknown[] = [];
    setLoggerSink((level, event, fields) => {
      calls.push({ level, event, fields });
    });
    setLogLevel('off');
    logger.debug('should.not.appear', { x: 1 });
    logger.error('should.not.appear.error', { x: 1 });
    assert.equal(calls.length, 0);
    setLogLevel(prev);
    setLoggerSink(null);
  });

  it('debug preserves structured safe fields when enabled', () => {
    const prev = getLogLevel();
    const calls: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    setLoggerSink((_level, event, fields) => {
      calls.push({ event, fields });
    });
    setLogLevel('debug');
    logger.debug('api.request', {
      method: 'GET',
      path: '/me',
      requestId: 'rid',
      status: 200,
      durationMs: 12,
      pluginId: 'p1',
      surfaceId: 's1',
      guildId: 'g1',
      token: 'secret',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.event, 'api.request');
    assert.equal(calls[0]?.fields?.method, 'GET');
    assert.equal(calls[0]?.fields?.requestId, 'rid');
    assert.equal(calls[0]?.fields?.status, 200);
    assert.equal(calls[0]?.fields?.durationMs, 12);
    assert.equal(calls[0]?.fields?.pluginId, 'p1');
    assert.equal(calls[0]?.fields?.surfaceId, 's1');
    assert.equal(calls[0]?.fields?.guildId, 'g1');
    assert.equal(calls[0]?.fields?.token, '[redacted]');
    assertNoSecret(calls[0]?.fields);
    setLogLevel(prev);
    setLoggerSink(null);
  });

  it('redacts before sink receives data', () => {
    const prev = getLogLevel();
    let seen: Record<string, unknown> | undefined;
    setLoggerSink((_l, _e, fields) => {
      seen = fields;
    });
    setLogLevel('debug');
    logger.debug('probe', { users: [{ token: 'secret' }] });
    assertNoSecret(seen);
    setLogLevel(prev);
    setLoggerSink(null);
  });
});
