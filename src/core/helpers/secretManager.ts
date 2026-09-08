import { getLogger } from '#core/utils/logger.js';
import { defaultBoolean, defaultString, hasDefault } from '#core/defaults.js';

const log = getLogger('SecretManager');

export class VaultError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}
export class VaultSealedError extends VaultError {}
export class VaultDecryptionError extends VaultError {}
export class VaultMissingKeyError extends VaultError {}

const IDENTITY_KEYS = new Set([
    'discordtoken',
    'discordintents',
]);

function isIdentityKey(key: string): boolean {
    return IDENTITY_KEYS.has(key.toLowerCase());
}

export class SecretManager {
    #isLocked = false;
    readonly #sealedKeys = new Set<string>();

    static readonly DEFAULT_SENSITIVE_PATTERN = /(TOKEN|SECRET|KEY|PASSWORD|URI|DB|DATABASE|LICENSE|CERT|AUTH|PASS)/i;

    constructor() {
        Object.freeze(SecretManager.prototype);
    }

    public set(key: string, value: string): void {
        if (this.#isLocked && this.#sealedKeys.has(key)) {
            log.warn(`Security Violation: Blocked attempted mutation of sealed secret [${key}].`);
            throw new VaultSealedError(`Security Violation: Secret [${key}] is sealed and cannot be overwritten.`);
        }
        process.env[key] = value;
        log.debug(`Variable [${key}] written to process.env.`);
    }

    public get(key: string): string {
        const value = process.env[key];
        if (value === undefined || value === '') {
            throw new VaultMissingKeyError(`Vault Error: Secret/Config [${key}] does not exist.`);
        }
        return value;
    }

    public getOptional(key: string, fallback?: string): string | undefined {
        const value = process.env[key];
        if (value !== undefined && value !== '') return value;
        // Explicit second argument always wins (including '').
        if (arguments.length >= 2) return fallback;
        // Auto-fallback from defaults registry when key is registered.
        if (hasDefault(key)) return defaultString(key);
        return undefined;
    }

    public assimilateEnv(_pattern: RegExp = SecretManager.DEFAULT_SENSITIVE_PATTERN): void {
        if (this.#isLocked) {
            log.debug('Vault is already locked. Skipping redundant environment assimilation.');
            return;
        }
        let count = 0;
        for (const envKey of Object.keys(process.env)) {
            const value = process.env[envKey];
            if (value === undefined || value === '') continue;
            count++;
        }
        log.info(`Environment assimilated (${count} non-empty keys). Values remain in process.env.`);
    }

    public replaceExpanded(key: string, value: string): void {
        this.set(key, value);
    }

    public getBoolean(key: string, fallback = false): boolean {
        const raw = process.env[key];
        const envEmpty = raw === undefined || raw === '';

        if (!envEmpty) {
            if (typeof raw === 'string') {
                const normalized = raw.trim().toLowerCase();
                return normalized === 'true' || normalized === '1' || normalized === 'yes';
            }
            return false;
        }

        // Env unset: prefer registry, then call-site fallback.
        const fromRegistry = defaultBoolean(key);
        if (fromRegistry !== undefined) return fromRegistry;
        return fallback;
    }

    public lock(): void {
        this.#isLocked = true;
        this.#sealedKeys.clear();
        for (const key of Object.keys(process.env)) {
            const value = process.env[key];
            if (value === undefined || value === '') continue;
            this.#sealedKeys.add(key);
        }
        log.info(`Environment vault locked (${this.#sealedKeys.size} keys sealed, append-only).`);
        void import('#core/manager/event.js')
            .then(({ eventBus }) =>
                eventBus.emitConcurrent('system.secrets.locked', {
                    keyCount: this.#sealedKeys.size,
                }),
            )
            .catch(() => undefined);

    }

    public applyEnvReload(
        mutations: ReadonlyMap<string, string>,
        allowSet: ReadonlySet<string>,
    ): { updated: string[]; skipped: string[] } {
        const updated: string[] = [];
        const skipped: string[] = [];

        for (const [key, value] of mutations) {
            if (!allowSet.has(key) || isIdentityKey(key)) {
                skipped.push(key);
                continue;
            }
            process.env[key] = value;
            this.#sealedKeys.add(key);
            updated.push(key);
        }

        if (updated.length > 0) {
            log.info(`Env reload applied ${updated.length} key(s) via sanctioned path.`);
        }
        if (skipped.length > 0) {
            log.info(`Env reload skipped ${skipped.length} key(s): ${skipped.join(', ')}`);
        }

        return { updated, skipped };
    }

    public has(key: string): boolean {
        const value = process.env[key];
        return value !== undefined && value !== '';
    }

    public keys(): string[] {
        return Object.keys(process.env).filter((key) => {
            const value = process.env[key];
            return value !== undefined && value !== '';
        });
    }
}

export const secrets = Object.freeze(new SecretManager());
