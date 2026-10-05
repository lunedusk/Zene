



export type LogLevel = 'off' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};





const SENSITIVE_KEY =
  /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|sessionkey|authorization|cookie|set-cookie|password|secret|client[_-]?secret|api[_-]?key|apikey|credential|credentials|bearer|otp|totp|recovery(?:[_-]?code(?:s)?)?|token)$/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

const BEARER_RE = /bearer\s+[a-z0-9._~+/-]+=*/i;
const SENSITIVE_QUERY_RE =
  /([?&])(token|access_token|refresh_token|id_token|session_token|auth|authorization|code|client_secret)=([^&#]*)/gi;

function redactSensitiveString(value: string): string {
  let out = value;
  out = out.replace(BEARER_RE, 'Bearer [redacted]');
  out = out.replace(SENSITIVE_QUERY_RE, '$1$2=[redacted]');
  return out;
}

function sanitizeValue(value: unknown, keyHint?: string): unknown {
  if (keyHint !== undefined && isSensitiveKey(keyHint)) {
    return '[redacted]';
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    return redactSensitiveString(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }
  if (typeof value === 'object') {

    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      out[k] = sanitizeValue(v, k);
    }
    return out;
  }
  return value;
}

export function sanitizeFields(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  return sanitizeValue(fields) as Record<string, unknown>;
}

function isDevMode(): boolean {
  try {

    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

function defaultLevel(): LogLevel {
  try {
    const fromStorage = localStorage.getItem('dash.logLevel');
    if (
      fromStorage === 'off' ||
      fromStorage === 'error' ||
      fromStorage === 'warn' ||
      fromStorage === 'info' ||
      fromStorage === 'debug'
    ) {
      return fromStorage;
    }
  } catch {

  }
  if (isDevMode()) return 'debug';
  return 'warn';
}

let currentLevel: LogLevel = defaultLevel();

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
  try {
    localStorage.setItem('dash.logLevel', level);
  } catch {

  }
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

type Sink = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

let sink: Sink = (level, event, fields) => {
  const payload = { event, ...(fields ?? {}), ts: new Date().toISOString() };
  if (level === 'error') console.error(payload);
  else if (level === 'warn') console.warn(payload);
  else if (level === 'info') console.info(payload);
  else console.debug(payload);
};


export function setLoggerSink(next: Sink | null): void {
  sink =
    next ??
    ((level, event, fields) => {
      const payload = { event, ...(fields ?? {}), ts: new Date().toISOString() };
      if (level === 'error') console.error(payload);
      else if (level === 'warn') console.warn(payload);
      else if (level === 'info') console.info(payload);
      else console.debug(payload);
    });
}

function emit(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[currentLevel] === 0) return;
  if (LEVEL_ORDER[currentLevel] < LEVEL_ORDER[level]) return;

  sink(level, event, sanitizeFields(fields));
}

export const logger = {
  debug(event: string, fields?: Record<string, unknown>): void {
    emit('debug', event, fields);
  },
  info(event: string, fields?: Record<string, unknown>): void {
    emit('info', event, fields);
  },
  warn(event: string, fields?: Record<string, unknown>): void {
    emit('warn', event, fields);
  },
  error(event: string, fields?: Record<string, unknown>): void {
    emit('error', event, fields);
  },
};
