



import {
    createChallenge,
    computeRegisterHmac,
    verifyHmacEqual,
    type ChallengeRecord,
} from '#core/crosshost/auth/hmac.js';
import { registerWorker, type WorkerEndpointRecord } from './workerRegistry.js';

const challenges = new Map<string, ChallengeRecord>();

export function issueWorkerRegistrationChallenge(machineId: string): ChallengeRecord {
    const c = createChallenge(machineId);
    challenges.set(c.challengeId, c);
    return c;
}

export type SecureRegisterInput = {
    readonly challengeId: string;
    readonly machineId: string;
    readonly endpoint: string;
    readonly hmac: string;
    readonly secret: string;
    readonly manifestHash: string;
    readonly zeneVersion: string;
    readonly bootGeneration: string;
    readonly generation: number;
    readonly capabilities?: readonly string[];
};

export type SecureRegisterResult =
    | { ok: true; record: WorkerEndpointRecord }
    | { ok: false; code: 'CHALLENGE_INVALID' | 'CHALLENGE_EXPIRED' | 'HMAC_INVALID' | 'MACHINE_MISMATCH'; message: string };

export async function secureRegisterWorker(input: SecureRegisterInput): Promise<SecureRegisterResult> {
    const challenge = challenges.get(input.challengeId);
    if (!challenge) {
        return { ok: false, code: 'CHALLENGE_INVALID', message: 'Unknown challenge' };
    }
    if (challenge.expiresAt < Date.now()) {
        challenges.delete(input.challengeId);
        return { ok: false, code: 'CHALLENGE_EXPIRED', message: 'Challenge expired' };
    }
    if (challenge.machineId !== input.machineId) {
        return { ok: false, code: 'MACHINE_MISMATCH', message: 'machineId does not match challenge' };
    }

    const expected = computeRegisterHmac(input.secret, {
        nonce: challenge.nonce,
        machineId: input.machineId,
        manifestHash: input.manifestHash,
        zeneVersion: input.zeneVersion,
        bootGeneration: input.bootGeneration,
    });
    if (!verifyHmacEqual(expected, input.hmac)) {
        return { ok: false, code: 'HMAC_INVALID', message: 'HMAC verification failed' };
    }

    challenges.delete(input.challengeId);
    const record = await registerWorker({
        machineId: input.machineId,
        endpoint: input.endpoint,
        generation: input.generation,
        zeneVersion: input.zeneVersion,
        capabilities: input.capabilities,
        tlsRequired: true,
    });
    return { ok: true, record };
}
