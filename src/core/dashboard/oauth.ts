/**
 * Discord OAuth2 authorization-code + PKCE transactions (Core-owned).
 * Tokens never leave the server boundary.
 */

import { createHash, randomBytes } from 'node:crypto';
import { getLogger } from '#core/utils/logger.js';
import { DashboardAuthError } from './authContext.js';

const log = getLogger('DashboardOAuth');

export interface OAuthTransaction {
    readonly state: string;
    readonly codeVerifier: string;
    readonly codeChallenge: string;
    readonly redirectUri: string;
    readonly scopes: readonly string[];
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly used: boolean;
}

const transactions = new Map<string, OAuthTransaction>();

const DEFAULT_SCOPES = ['identify'] as const;
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const TOKEN_TIMEOUT_MS = 15_000;

export function createCodeVerifier(): string {
    return randomBytes(32).toString('base64url');
}

export function createCodeChallenge(verifier: string): string {
    return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

export function createOAuthState(): string {
    return randomBytes(24).toString('base64url');
}

export function beginOAuthTransaction(input: {
    redirectUri: string;
    allowedRedirectUris: readonly string[];
    scopes?: readonly string[];
    ttlMs?: number;
}): {
    state: string;
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    scopes: readonly string[];
    redirectUri: string;
    authorizationUrlParams: Record<string, string>;
} {
    if (!input.allowedRedirectUris.includes(input.redirectUri)) {
        throw new DashboardAuthError(
            'invalid_redirect',
            'Redirect URI is not pre-registered',
        );
    }
    const state = createOAuthState();
    const codeVerifier = createCodeVerifier();
    const codeChallenge = createCodeChallenge(codeVerifier);
    const scopes = input.scopes ?? DEFAULT_SCOPES;
    const now = Date.now();
    const tx: OAuthTransaction = {
        state,
        codeVerifier,
        codeChallenge,
        redirectUri: input.redirectUri,
        scopes,
        createdAt: now,
        expiresAt: now + (input.ttlMs ?? 600_000),
        used: false,
    };
    transactions.set(state, tx);
    log.debug(`OAuth transaction started state=${state.slice(0, 8)}…`);
    return {
        state,
        codeChallenge,
        codeChallengeMethod: 'S256',
        scopes,
        redirectUri: input.redirectUri,
        authorizationUrlParams: {
            response_type: 'code',
            scope: scopes.join(' '),
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            redirect_uri: input.redirectUri,
        },
    };
}

export function consumeOAuthCallback(input: {
    state: string;
    code: string;
    redirectUri: string;
}): { codeVerifier: string; scopes: readonly string[]; redirectUri: string } {
    const tx = transactions.get(input.state);
    if (!tx) {
        throw new DashboardAuthError('invalid_oauth_state', 'Unknown or expired OAuth state');
    }
    if (tx.used) {
        throw new DashboardAuthError('invalid_oauth_state', 'OAuth state already used');
    }
    if (Date.now() > tx.expiresAt) {
        transactions.delete(input.state);
        throw new DashboardAuthError('invalid_oauth_state', 'OAuth state expired');
    }
    if (input.redirectUri !== tx.redirectUri) {
        throw new DashboardAuthError('invalid_redirect', 'Redirect URI mismatch');
    }
    if (!input.code || typeof input.code !== 'string') {
        throw new DashboardAuthError('oauth_failure', 'Missing authorization code');
    }
    transactions.delete(input.state);
    return {
        codeVerifier: tx.codeVerifier,
        scopes: tx.scopes,
        redirectUri: tx.redirectUri,
    };
}

/** Server-side token exchange result — never send tokens to browser. */
export interface DiscordTokenResponse {
    readonly access_token: string;
    readonly token_type: string;
    readonly expires_in: number;
    readonly refresh_token?: string;
    readonly scope: string;
}

export type DiscordTokenExchangeFn = (input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
}) => Promise<DiscordTokenResponse>;

/**
 * Production Discord OAuth2 token exchange (authorization_code + PKCE).
 * Tokens are handled only in server memory; never log token values.
 */
export async function defaultDiscordTokenExchange(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
}): Promise<DiscordTokenResponse> {
    if (!input.code || !input.codeVerifier || !input.redirectUri) {
        throw new DashboardAuthError('oauth_failure', 'Incomplete token exchange parameters');
    }
    if (!input.clientId || !input.clientSecret) {
        throw new DashboardAuthError('oauth_failure', 'Discord client credentials not configured');
    }

    const body = new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
    try {
        const res = await fetch(DISCORD_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: body.toString(),
            signal: controller.signal,
        });
        if (!res.ok) {
            log.warn(`Discord token exchange failed status=${res.status}`);
            throw new DashboardAuthError(
                'oauth_failure',
                `Discord token exchange failed (${res.status})`,
            );
        }
        const json = (await res.json()) as Record<string, unknown>;
        if (typeof json.access_token !== 'string' || typeof json.token_type !== 'string') {
            throw new DashboardAuthError('oauth_failure', 'Malformed Discord token response');
        }
        return {
            access_token: json.access_token,
            token_type: json.token_type,
            expires_in: typeof json.expires_in === 'number' ? json.expires_in : 0,
            refresh_token:
                typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
            scope: typeof json.scope === 'string' ? json.scope : '',
        };
    } catch (err: unknown) {
        if (err instanceof DashboardAuthError) throw err;
        if (err instanceof Error && err.name === 'AbortError') {
            throw new DashboardAuthError('oauth_failure', 'Discord token exchange timed out');
        }
        throw new DashboardAuthError(
            'oauth_failure',
            'Discord token exchange request failed',
        );
    } finally {
        clearTimeout(timer);
    }
}

/** Active exchange implementation — production default; tests may override. */
let tokenExchangeImpl: DiscordTokenExchangeFn = defaultDiscordTokenExchange;

/** Test seam only — production code must not rely on injection. */
export function injectDiscordTokenExchange(fn: DiscordTokenExchangeFn | null): void {
    tokenExchangeImpl = fn ?? defaultDiscordTokenExchange;
}

export async function exchangeAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
}): Promise<DiscordTokenResponse> {
    return tokenExchangeImpl(input);
}

export function clearOAuthTransactions(): void {
    transactions.clear();
}

export function getOAuthTransactionForTests(state: string): OAuthTransaction | undefined {
    return transactions.get(state);
}

export function getActiveTokenExchangeForTests(): DiscordTokenExchangeFn {
    return tokenExchangeImpl;
}
