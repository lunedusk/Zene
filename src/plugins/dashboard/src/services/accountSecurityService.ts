/**
 * Phase 4 — Account security service (session/device/MFA/passkey contracts).
 * Authentication state is Better Auth–owned when live; Zene still authorizes access to these APIs.
 */

import { kvGet, kvSet, newId } from '../../../dash-data/src/lib/store.js';
import type { RequestContext } from '../lib/requestContext.js';
import { ServiceError, serviceOk, type ServiceResult } from '../lib/requestContext.js';
import {
    buildOtpAuthUri,
    generateTotpSecret,
    verifyTotp,
    verifyTotpWithReplayProtection,
} from '../lib/totp.js';

const NS_SESSIONS = 'ba_account_sessions';
const NS_DEVICES = 'ba_account_devices';
const NS_MFA = 'ba_account_mfa';
const NS_PASSKEYS = 'ba_account_passkeys';
const NS_HISTORY = 'ba_account_login_history';

export interface SessionView {
    readonly sessionId: string;
    readonly userId: string;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly ipAddress?: string;
    readonly userAgent?: string;
    readonly current?: boolean;
}

export interface DeviceView {
    readonly deviceId: string;
    readonly userId: string;
    readonly label?: string;
    readonly lastSeenAt: number;
    readonly userAgent?: string;
}

export interface MfaStatus {
    readonly enabled: boolean;
    readonly enrolledAt?: number;
    readonly hasRecoveryCodes: boolean;
}

export interface PasskeyView {
    readonly credentialId: string;
    readonly name?: string;
    readonly createdAt: number;
    readonly deviceType?: string;
}

function userKey(userId: string): string {
    return userId;
}

export class AccountSecurityService {
    async listSessions(ctx: RequestContext): Promise<ServiceResult<{ sessions: SessionView[] }>> {
        const raw = await kvGet(NS_SESSIONS, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as SessionView[]) : [];
        return serviceOk({ sessions: list }, { requestId: ctx.requestId });
    }

    async revokeSession(
        ctx: RequestContext,
        sessionId: string,
    ): Promise<ServiceResult<{ revoked: boolean }>> {
        const raw = await kvGet(NS_SESSIONS, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as SessionView[]) : [];
        const next = list.filter((s) => s.sessionId !== sessionId);
        if (next.length === list.length) {
            throw new ServiceError('NOT_FOUND', 'Session not found', 404, undefined, true);
        }
        await kvSet(NS_SESSIONS, userKey(ctx.actor.userId), next);
        return serviceOk({ revoked: true }, { requestId: ctx.requestId });
    }

    async revokeOtherSessions(
        ctx: RequestContext,
        currentSessionId: string,
    ): Promise<ServiceResult<{ revoked: number }>> {
        const raw = await kvGet(NS_SESSIONS, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as SessionView[]) : [];
        const kept = list.filter((s) => s.sessionId === currentSessionId);
        await kvSet(NS_SESSIONS, userKey(ctx.actor.userId), kept);
        return serviceOk({ revoked: list.length - kept.length }, { requestId: ctx.requestId });
    }

    async listDevices(ctx: RequestContext): Promise<ServiceResult<{ devices: DeviceView[] }>> {
        const raw = await kvGet(NS_DEVICES, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as DeviceView[]) : [];
        return serviceOk({ devices: list }, { requestId: ctx.requestId });
    }

    async revokeDevice(ctx: RequestContext, deviceId: string): Promise<ServiceResult<{ revoked: boolean }>> {
        const raw = await kvGet(NS_DEVICES, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as DeviceView[]) : [];
        const next = list.filter((d) => d.deviceId !== deviceId);
        if (next.length === list.length) {
            throw new ServiceError('NOT_FOUND', 'Device not found', 404, undefined, true);
        }
        await kvSet(NS_DEVICES, userKey(ctx.actor.userId), next);
        return serviceOk({ revoked: true }, { requestId: ctx.requestId });
    }

    async getMfaStatus(ctx: RequestContext): Promise<ServiceResult<MfaStatus>> {
        const raw = await kvGet(NS_MFA, userKey(ctx.actor.userId));
        if (!raw || typeof raw !== 'object') {
            return serviceOk({ enabled: false, hasRecoveryCodes: false }, { requestId: ctx.requestId });
        }
        const m = raw as { enabled?: boolean; enrolledAt?: number; recoveryCount?: number };
        return serviceOk(
            {
                enabled: m.enabled === true,
                enrolledAt: m.enrolledAt,
                hasRecoveryCodes: (m.recoveryCount ?? 0) > 0,
            },
            { requestId: ctx.requestId },
        );
    }

    /**
     * TOTP enrollment starts — returns opaque enrollment id + otpauth URI.
     * Secret is stored server-side only and never logged.
     */
    async beginTotpEnrollment(ctx: RequestContext): Promise<ServiceResult<{ enrollmentId: string; otpauthUri: string }>> {
        const enrollmentId = newId('mfa');
        const secret = generateTotpSecret(20);
        await kvSet(NS_MFA, `enroll:${ctx.actor.userId}:${enrollmentId}`, {
            secret,
            createdAt: Date.now(),
        });
        const otpauthUri = buildOtpAuthUri({
            secretBase32: secret,
            accountName: ctx.actor.userId,
            issuer: 'Dashboard',
        });
        return serviceOk({ enrollmentId, otpauthUri }, { requestId: ctx.requestId });
    }

    async confirmTotpEnrollment(
        ctx: RequestContext,
        enrollmentId: string,
        code: string,
    ): Promise<ServiceResult<{ enabled: boolean }>> {
        if (!code || !/^\d{6,8}$/.test(code)) {
            throw new ServiceError('VALIDATION', 'Invalid TOTP code', 400);
        }
        const enroll = await kvGet(NS_MFA, `enroll:${ctx.actor.userId}:${enrollmentId}`);
        if (!enroll || typeof enroll !== 'object') {
            throw new ServiceError('NOT_FOUND', 'Enrollment not found', 404, undefined, true);
        }
        const secret = (enroll as { secret?: string }).secret;
        if (!secret || typeof secret !== 'string') {
            throw new ServiceError('VALIDATION', 'Enrollment secret missing', 400);
        }
        if (!verifyTotp(secret, code)) {
            throw new ServiceError('FORBIDDEN', 'Invalid TOTP code', 403);
        }
        const recoveryCodes = Array.from({ length: 8 }, () => newId('rc').slice(0, 10));
        await kvSet(NS_MFA, userKey(ctx.actor.userId), {
            enabled: true,
            enrolledAt: Date.now(),
            recoveryCount: recoveryCodes.length,
        });
        await kvSet(NS_MFA, `secret:${ctx.actor.userId}`, secret);
        await kvSet(NS_MFA, `recovery:${ctx.actor.userId}`, recoveryCodes);
        await kvSet(NS_MFA, `enroll:${ctx.actor.userId}:${enrollmentId}`, null);
        return serviceOk({ enabled: true }, { requestId: ctx.requestId });
    }

    async verifyMfaCode(ctx: RequestContext, code: string): Promise<ServiceResult<{ verified: boolean }>> {
        const secret = await kvGet(NS_MFA, `secret:${ctx.actor.userId}`);
        if (typeof secret !== 'string') {
            throw new ServiceError('VALIDATION', 'MFA not enrolled', 400);
        }
        const ok = verifyTotpWithReplayProtection(ctx.actor.userId, secret, code);
        if (!ok) {
            throw new ServiceError('FORBIDDEN', 'Invalid TOTP code', 403);
        }
        return serviceOk({ verified: true }, { requestId: ctx.requestId });
    }

    async disableMfa(ctx: RequestContext, code: string): Promise<ServiceResult<{ enabled: boolean }>> {
        if (!code || !/^\d{6,8}$/.test(code)) {
            throw new ServiceError('VALIDATION', 'Verification required', 400);
        }
        const secret = await kvGet(NS_MFA, `secret:${ctx.actor.userId}`);
        if (typeof secret === 'string') {
            if (!verifyTotp(secret, code)) {
                throw new ServiceError('FORBIDDEN', 'Invalid TOTP code', 403);
            }
        }
        await kvSet(NS_MFA, userKey(ctx.actor.userId), { enabled: false });
        await kvSet(NS_MFA, `secret:${ctx.actor.userId}`, null);
        await kvSet(NS_MFA, `recovery:${ctx.actor.userId}`, null);
        return serviceOk({ enabled: false }, { requestId: ctx.requestId });
    }

    async listPasskeys(ctx: RequestContext): Promise<ServiceResult<{ passkeys: PasskeyView[] }>> {
        const raw = await kvGet(NS_PASSKEYS, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as PasskeyView[]) : [];
        return serviceOk({ passkeys: list }, { requestId: ctx.requestId });
    }

    async beginPasskeyRegistration(
        ctx: RequestContext,
    ): Promise<ServiceResult<{ challengeId: string; challenge: string }>> {
        const challengeId = newId('pk');
        const challenge = newId('chal');
        await kvSet(NS_PASSKEYS, `reg:${ctx.actor.userId}:${challengeId}`, {
            challenge,
            createdAt: Date.now(),
        });
        return serviceOk({ challengeId, challenge }, { requestId: ctx.requestId });
    }

    async completePasskeyRegistration(
        ctx: RequestContext,
        challengeId: string,
        credentialId: string,
        name?: string,
    ): Promise<ServiceResult<{ credentialId: string }>> {
        const reg = await kvGet(NS_PASSKEYS, `reg:${ctx.actor.userId}:${challengeId}`);
        if (!reg) throw new ServiceError('NOT_FOUND', 'Registration challenge not found', 404, undefined, true);
        if (!credentialId) throw new ServiceError('VALIDATION', 'credentialId required', 400);
        const raw = await kvGet(NS_PASSKEYS, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as PasskeyView[]) : [];
        const entry: PasskeyView = {
            credentialId,
            name,
            createdAt: Date.now(),
        };
        list.push(entry);
        await kvSet(NS_PASSKEYS, userKey(ctx.actor.userId), list);
        await kvSet(NS_PASSKEYS, `reg:${ctx.actor.userId}:${challengeId}`, null);
        return serviceOk({ credentialId }, { requestId: ctx.requestId });
    }

    async revokePasskey(ctx: RequestContext, credentialId: string): Promise<ServiceResult<{ revoked: boolean }>> {
        const raw = await kvGet(NS_PASSKEYS, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as PasskeyView[]) : [];
        const next = list.filter((p) => p.credentialId !== credentialId);
        if (next.length === list.length) {
            throw new ServiceError('NOT_FOUND', 'Passkey not found', 404, undefined, true);
        }
        await kvSet(NS_PASSKEYS, userKey(ctx.actor.userId), next);
        return serviceOk({ revoked: true }, { requestId: ctx.requestId });
    }

    async loginHistory(ctx: RequestContext): Promise<ServiceResult<{ events: Array<{ at: number; ip?: string; result: string }> }>> {
        const raw = await kvGet(NS_HISTORY, userKey(ctx.actor.userId));
        const list = Array.isArray(raw) ? (raw as Array<{ at: number; ip?: string; result: string }>) : [];
        return serviceOk({ events: list.slice(-50) }, { requestId: ctx.requestId });
    }

    /** Test helper: seed session record */
    async seedSession(userId: string, session: SessionView): Promise<void> {
        const raw = await kvGet(NS_SESSIONS, userKey(userId));
        const list = Array.isArray(raw) ? (raw as SessionView[]) : [];
        list.push(session);
        await kvSet(NS_SESSIONS, userKey(userId), list);
    }
}

export const accountSecurityService = new AccountSecurityService();
