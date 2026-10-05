







import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { ensurePhase4TestBackend } from '../lib/phase4TestBackend.js';
import {
    ensureBetterAuthSchema,
    setAuthCutoverPhase,
    isLegacyAuthAllowed,
} from './betterAuthSchema.js';
import { resolveBetterAuthNativeDatabase } from './betterAuthDatabase.js';
import { createBetterAuthServer } from './betterAuthServer.js';
import {
    registerBetterAuthSessionResolver,
    resolveSessionIdentity,
} from './sessionResolver.js';
import { bridgeAuthToZeneAuthorization } from './authorizationBridge.js';
import { dashGet, dashAll } from '../../../dash-data/src/lib/store.js';
import { DEFAULT_SESSION_POLICY } from './betterAuthBoundary.js';

const SECRET = 'phase4-lifecycle-secret-at-least-32-chars!!';
const BASE_URL = 'http://localhost:3000';

before(async () => {
    await ensurePhase4TestBackend();
});

type SignBody = {
    token?: string;
    user?: { id: string; email?: string | null; name?: string | null };
    session?: { id?: string; token?: string; userId?: string };
};

type SessionCredential = {

    readonly cookieHeader: string;

    readonly cookieName: string;

    readonly cookieValue: string;

    readonly bodyToken?: string;
};



function parseExpiresAtMs(value: unknown): number | null {
    if (value == null) return null;
    if (value instanceof Date) {
        const t = value.getTime();
        return Number.isFinite(t) ? t : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;

        if (/^\d+$/.test(trimmed)) {
            const n = Number(trimmed);
            return n < 1e12 ? n * 1000 : n;
        }
        const parsed = Date.parse(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }

    if (typeof value === 'bigint') {
        const n = Number(value);
        return n < 1e12 ? n * 1000 : n;
    }
    return null;
}

function unwrapSignResult(raw: unknown): { body: SignBody; headers?: Headers } {
    if (!raw || typeof raw !== 'object') return { body: {} };
    const obj = raw as Record<string, unknown>;
    if ('response' in obj && obj.response && typeof obj.response === 'object') {
        return {
            body: obj.response as SignBody,
            headers: obj.headers instanceof Headers ? obj.headers : undefined,
        };
    }
    return {
        body: obj as SignBody,
        headers: obj.headers instanceof Headers ? obj.headers : undefined,
    };
}

function collectSetCookieStrings(headers: Headers): string[] {
    if (typeof headers.getSetCookie === 'function') {
        return headers.getSetCookie();
    }
    const single = headers.get('set-cookie');
    return single ? [single] : [];
}





function extractSessionCredential(
    body: SignBody,
    responseHeaders: Headers | undefined,
    sqlSessionToken: string | undefined,
): SessionCredential {
    const defaultName = 'better-auth.session_token';

    if (responseHeaders) {
        for (const sc of collectSetCookieStrings(responseHeaders)) {
            const match = /((?:__Secure-)?better-auth\.session_token)=([^;]+)/i.exec(sc);
            if (match?.[1] && match[2]) {
                const cookieName = match[1];
                const cookieValue = match[2];
                return {
                    cookieHeader: `${cookieName}=${cookieValue}`,
                    cookieName,
                    cookieValue: decodeURIComponent(cookieValue),
                    bodyToken: body.token,
                };
            }
        }
    }


    if (sqlSessionToken && sqlSessionToken.length > 0) {
        return {
            cookieHeader: `${defaultName}=${encodeURIComponent(sqlSessionToken)}`,
            cookieName: defaultName,
            cookieValue: sqlSessionToken,
            bodyToken: body.token,
        };
    }

    if (body.token && body.token.length > 0) {
        return {
            cookieHeader: `${defaultName}=${encodeURIComponent(body.token)}`,
            cookieName: defaultName,
            cookieValue: body.token,
            bodyToken: body.token,
        };
    }

    throw new Error(
        'Better Auth did not yield a session credential via Set-Cookie, SQL session.token, or body.token',
    );
}

function headersFromCredential(cred: SessionCredential): Headers {
    const h = new Headers();
    h.set('cookie', cred.cookieHeader);
    return h;
}

function requestFromCredential(cred: SessionCredential) {
    return { headers: { cookie: cred.cookieHeader } };
}

describe('better-auth real lifecycle (mandatory)', () => {
    it('register → persist → login → lookup → revoke → reject', async () => {
        const schema = await ensureBetterAuthSchema();
        assert.equal(schema.ok, true, schema.ok ? '' : schema.message);

        const native = await resolveBetterAuthNativeDatabase();
        assert.equal(native.engine, 'sqlite');

        const init = await createBetterAuthServer({
            config: {
                baseURL: BASE_URL,
                secret: SECRET,
                trustedOrigins: [BASE_URL],
                session: { ...DEFAULT_SESSION_POLICY },
            },
            database: native.handle,
        });
        assert.equal(init.ok, true, init.ok ? '' : init.message);
        if (!init.ok) return;

        const { handle } = init;
        assert.ok(handle.api.signUpEmail, 'signUpEmail API required');
        assert.ok(handle.api.signInEmail, 'signInEmail API required');
        assert.ok(handle.api.signOut, 'signOut API required');

        const email = `lifecycle-${Date.now()}@example.com`;
        const password = 'LifecyclePass1!';
        const name = 'Lifecycle User';

        const signedUpRaw = await handle.api.signUpEmail!({
            body: { email, password, name },
            returnHeaders: true,
        });
        assert.ok(signedUpRaw, 'signUpEmail must return a result');
        const { body: signUpBody } = unwrapSignResult(signedUpRaw);
        assert.ok(signUpBody.user?.id, 'registered user id required');
        const userId = signUpBody.user!.id;

        const userRow = await dashGet(`SELECT id, email FROM "user" WHERE id = ?`, [userId]);
        assert.ok(userRow, 'user row must exist in SQL');
        assert.equal(String(userRow.email), email);

        const accounts = await dashAll(
            `SELECT id, providerId, userId FROM "account" WHERE userId = ?`,
            [userId],
        );
        assert.ok(accounts.length >= 1, 'account row must exist for email/password provider');


        const signedInRaw = await handle.api.signInEmail!({
            body: { email, password },
            returnHeaders: true,
        });
        assert.ok(signedInRaw, 'signInEmail must return a result');
        const { body: signedInBody, headers: signedInHeaders } = unwrapSignResult(signedInRaw);
        assert.ok(signedInBody.user?.id, 'signInEmail must return user');
        assert.equal(signedInBody.user!.id, userId);


        const sessions = await dashAll(
            `SELECT id, userId, token, expiresAt FROM "session" WHERE userId = ?`,
            [userId],
        );
        assert.ok(sessions.length >= 1, `session row must exist in SQL after login (found ${sessions.length})`);

        const now = Date.now();
        const sessionMeta = sessions.map((s) => {
            const expMs = parseExpiresAtMs(s.expiresAt);
            return {
                id: String(s.id),
                userId: String(s.userId),
                tokenPresent: typeof s.token === 'string' && s.token.length > 0,
                tokenLength: typeof s.token === 'string' ? s.token.length : 0,
                expiresAtType: s.expiresAt == null ? 'null' : typeof s.expiresAt,
                expiresAtMs: expMs,
                isExpired: expMs == null ? true : expMs <= now,
            };
        });
        const active = sessions.find((s) => {
            const expMs = parseExpiresAtMs(s.expiresAt);
            return expMs != null && expMs > now;
        });


        const fallback =
            active ??
            sessions.find((s) => typeof s.token === 'string' && s.token.length > 0) ??
            sessions[0];
        assert.ok(
            fallback,
            `at least one session row required after login; meta=${JSON.stringify(sessionMeta)}`,
        );
        assert.equal(String(fallback!.userId), userId);

        if (!active) {
            assert.ok(
                sessionMeta.some((m) => m.tokenPresent),
                `session token missing; meta=${JSON.stringify(sessionMeta)}`,
            );
        }
        const sessionRow = active ?? fallback!;

        const cred = extractSessionCredential(
            signedInBody,
            signedInHeaders,
            String(sessionRow.token),
        );


        const directSession = await handle.api.getSession({
            headers: headersFromCredential(cred),
            query: { disableCookieCache: true },
        });
        assert.ok(
            directSession != null && (directSession.session?.id || directSession.user?.id),
            'direct Better Auth getSession must find active session',
        );
        if (directSession?.session?.userId) {
            assert.equal(directSession.session.userId, userId);
        } else if (directSession?.user?.id) {
            assert.equal(directSession.user.id, userId);
        }


        const wrapped = await handle.getSession(requestFromCredential(cred));
        assert.ok(wrapped, 'Dashboard getSession wrapper must resolve identity');
        assert.equal(wrapped!.authUserId, userId);


        registerBetterAuthSessionResolver(async (req) => handle.getSession(req));
        const resolved = await resolveSessionIdentity(requestFromCredential(cred));
        assert.equal(resolved.authority, 'better_auth');
        assert.ok(resolved.identity);
        const authz = await bridgeAuthToZeneAuthorization(resolved.identity!);
        assert.equal('ok' in authz && authz.ok === true, true);
        if ('ok' in authz && authz.ok) {
            assert.ok(authz.resolved.bits instanceof Set);
            assert.equal(typeof authz.resolved.resolvedAt, 'number');
        }


        await handle.api.signOut!({ headers: headersFromCredential(cred) });

        const afterRevoke = await handle.api.getSession({
            headers: headersFromCredential(cred),
            query: { disableCookieCache: true },
        });
        assert.ok(
            afterRevoke === null || (!afterRevoke.session && !afterRevoke.user),
            'revoked session must not resolve via Better Auth getSession',
        );

        const resolvedAfter = await resolveSessionIdentity(requestFromCredential(cred));
        assert.equal(resolvedAfter.authority, 'none');
        assert.equal(resolvedAfter.identity, null);

        registerBetterAuthSessionResolver(null);
    });

    it('BA-only cutover rejects legacy dash sessions', async () => {
        setAuthCutoverPhase(4);
        assert.equal(isLegacyAuthAllowed(), false);
        registerBetterAuthSessionResolver(null);
        const r = await resolveSessionIdentity({
            headers: {},
            dashSession: {
                payload: {
                    userId: 'legacy-user',
                    exp: Math.floor(Date.now() / 1000) + 99,
                    jti: 'legacy-jti',
                },
            },
        });
        assert.equal(r.authority, 'none');
        setAuthCutoverPhase(2);
    });
});
