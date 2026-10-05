



import { apiClient, SESSION_STORAGE_KEY } from '../api/client.js';
import { DashApiError, type SessionUser } from '../api/types.js';
import { identityFromApiPayload, setIdentity } from '../identity/store.js';
import { logger } from '../lib/logger.js';

export type BootstrapState = 'initializing' | 'authenticated' | 'unauthenticated' | 'failed';

export interface SessionState {
  status: BootstrapState;
  user: SessionUser | null;
  bits: ReadonlySet<string>;
  isBotOwner: boolean;
  error?: string;
}

const listeners = new Set<(s: SessionState) => void>();

let state: SessionState = {
  status: 'initializing',
  user: null,
  bits: new Set(),
  isBotOwner: false,
};

export function getSessionState(): SessionState {
  return state;
}

export function subscribeSession(fn: (s: SessionState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn(state);
}

function setState(next: SessionState): void {
  state = next;
  emit();
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(SESSION_STORAGE_KEY, token);
    else sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {

  }
}

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

async function loadRuntimeIdentity(): Promise<void> {
  try {
    logger.debug('app.runtime-config.load.start', {});
    const cfg = await apiClient.getPublicConfig();
    if (cfg && typeof cfg === 'object') {
      const o = cfg as Record<string, unknown>;
      setIdentity(
        identityFromApiPayload({
          botName: typeof o.name === 'string' ? o.name : undefined,
          avatarUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : undefined,
          inviteUrl: typeof o.inviteUrl === 'string' ? o.inviteUrl : undefined,
          iconUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : undefined,
        }),
      );
      logger.debug('app.runtime-config.loaded', {
        botName: typeof o.name === 'string' ? o.name : undefined,
      });
      return;
    }
  } catch (e) {
    logger.debug('app.runtime-config.load.failure', {
      reason: e instanceof Error ? e.message : 'unknown',
    });
  }
}

export async function bootstrapSession(): Promise<SessionState> {
  logger.debug('session.bootstrap.start', {});
  logger.debug('app.bootstrap.start', {});
  setState({ status: 'initializing', user: null, bits: new Set(), isBotOwner: false });
  await loadRuntimeIdentity();

  const token = getSessionToken();
  if (!token) {
    const next: SessionState = {
      status: 'unauthenticated',
      user: null,
      bits: new Set(),
      isBotOwner: false,
    };
    setState(next);
    logger.debug('session.bootstrap.unauthenticated', {});
    logger.debug('app.bootstrap.complete', { status: 'unauthenticated' });
    return next;
  }
  try {
    const data = (await apiClient.getMe()) as Record<string, unknown>;
    const id = String(data.id ?? data.userId ?? '');
    const bitsArr = Array.isArray(data.bits) ? data.bits.map(String) : [];
    const isBotOwner = Boolean(data.isBotOwner) || bitsArr.includes('bot.owner');
    const user: SessionUser = {
      id,
      username: typeof data.username === 'string' ? data.username : undefined,
      avatar: (data.avatar as string | null | undefined) ?? null,
      bits: bitsArr,
      isBotOwner,
    };
    if (data.application && typeof data.application === 'object') {
      setIdentity(identityFromApiPayload(data.application));
    }
    const next: SessionState = {
      status: 'authenticated',
      user,
      bits: new Set(bitsArr),
      isBotOwner,
    };
    setState(next);
    logger.debug('session.bootstrap.success', { userId: id, bitCount: bitsArr.length });
    logger.debug('app.bootstrap.complete', { status: 'authenticated' });
    return next;
  } catch (e) {
    if (e instanceof DashApiError && e.isUnauthenticated) {
      setSessionToken(null);
      const next: SessionState = {
        status: 'unauthenticated',
        user: null,
        bits: new Set(),
        isBotOwner: false,
      };
      setState(next);
      logger.debug('session.bootstrap.unauthenticated', { reason: 'expired' });
      return next;
    }
    const next: SessionState = {
      status: 'failed',
      user: null,
      bits: new Set(),
      isBotOwner: false,
      error: e instanceof Error ? e.message : String(e),
    };
    setState(next);
    logger.debug('session.bootstrap.failure', {
      reason: e instanceof Error ? e.message : 'unknown',
    });
    return next;
  }
}

export function hasBit(bit: string): boolean {
  return state.isBotOwner || state.bits.has('bot.owner') || state.bits.has(bit);
}

export function logoutLocal(): void {
  setSessionToken(null);
  setState({ status: 'unauthenticated', user: null, bits: new Set(), isBotOwner: false });
  logger.debug('session.logout', {});
}
