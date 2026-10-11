import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '#core/utils/logger.js';
import { secrets } from '#core/helpers/secretManager.js';

const log = getLogger('DashboardServiceCredential');

export const DASHBOARD_SERVICE_LABEL = 'dashboard-service';
export const CREDENTIAL_RELATIVE_PATH = path.join('.data', 'dashboard', 'service-credential.json');

export interface DashboardServiceCredentialFile {
    readonly version: 1;
    readonly keyId: string;
    readonly key: string;
    readonly label: typeof DASHBOARD_SERVICE_LABEL;
    readonly issuedAt: number;
    readonly coreApiBaseUrl: string;
    readonly dashboardOrigin: string;
    readonly generation: number;
}

let generationCounter = 0;
let current: DashboardServiceCredentialFile | null = null;
let issueLock = false;

function credentialDir(cwd: string): string {
    return path.resolve(cwd, '.data', 'dashboard');
}

function credentialPath(cwd: string = process.cwd()): string {
    return path.join(credentialDir(cwd), 'service-credential.json');
}

/**
 * Refuse to write through a symlink that escapes the credential directory.
 */
function assertSafeCredentialPath(filePath: string, dir: string): void {
    try {
        if (fs.existsSync(filePath)) {
            const st = fs.lstatSync(filePath);
            if (st.isSymbolicLink()) {
                const real = fs.realpathSync(filePath);
                const realDir = fs.realpathSync(dir);
                if (!real.startsWith(realDir + path.sep) && real !== path.join(realDir, 'service-credential.json')) {
                    throw new Error('Credential path resolves outside the dashboard credential directory (symlink refused).');
                }
            }
        }
    } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('symlink')) throw err;
        /* missing is fine */
    }
}

export function getCoreApiBaseUrl(): string {
    const explicit = secrets.getOptional('ApiPublicUrl')?.trim();
    if (explicit) return explicit.replace(/\/$/, '');
    const host = secrets.getOptional('APIHost', '127.0.0.1') ?? '127.0.0.1';
    const bindHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const port = secrets.getOptional('APIPort', '3000') ?? '3000';
    return `http://${bindHost}:${port}`;
}

export function getDashboardOrigin(): string {
    const explicit = secrets.getOptional('DashboardPublicUrl')?.trim();
    if (explicit) return explicit.replace(/\/$/, '');
    const port = secrets.getOptional('DashboardPort', '5173') ?? '5173';
    return `http://127.0.0.1:${port}`;
}

/**
 * Issue a new dashboard→Core service credential, write it with mode 0600,
 * and return the material for Gateway runtime registration.
 * Single-flight: concurrent callers cannot issue competing keys.
 */
export function issueDashboardServiceCredential(cwd: string = process.cwd()): DashboardServiceCredentialFile {
    if (issueLock) {
        throw new Error('Dashboard service credential issuance already in progress.');
    }
    issueLock = true;
    try {
        generationCounter += 1;
        const keyId = `dash-svc-${randomBytes(8).toString('hex')}`;
        const key = randomBytes(32).toString('base64url');
        const record: DashboardServiceCredentialFile = {
            version: 1,
            keyId,
            key,
            label: DASHBOARD_SERVICE_LABEL,
            issuedAt: Date.now(),
            coreApiBaseUrl: getCoreApiBaseUrl(),
            dashboardOrigin: getDashboardOrigin(),
            generation: generationCounter,
        };

        const dir = credentialDir(cwd);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        try {
            fs.chmodSync(dir, 0o700);
        } catch {
            /* best-effort */
        }

        const filePath = credentialPath(cwd);
        assertSafeCredentialPath(filePath, dir);

        const tmp = path.join(dir, `service-credential.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(record, null, 2), { encoding: 'utf8', mode: 0o600 });
        try {
            fs.chmodSync(tmp, 0o600);
        } catch {
            /* best-effort */
        }
        fs.renameSync(tmp, filePath);
        try {
            fs.chmodSync(filePath, 0o600);
        } catch {
            /* best-effort */
        }

        current = record;
        log.info(
            `Issued dashboard service credential keyId=${keyId} generation=${record.generation} (secret not logged)`,
        );
        return record;
    } finally {
        issueLock = false;
    }
}

export function readDashboardServiceCredential(
    cwd: string = process.cwd(),
): DashboardServiceCredentialFile | null {
    const filePath = credentialPath(cwd);
    try {
        if (!fs.existsSync(filePath)) return null;
        const st = fs.lstatSync(filePath);
        if (st.isSymbolicLink()) {
            log.warn('Refusing to read dashboard credential through a symlink.');
            return null;
        }
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as DashboardServiceCredentialFile;
        if (parsed.version !== 1 || typeof parsed.key !== 'string' || parsed.key.length < 16) {
            return null;
        }
        if (parsed.label !== DASHBOARD_SERVICE_LABEL) return null;
        return parsed;
    } catch (err: unknown) {
        log.warn(
            `Failed to read dashboard service credential: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
    }
}

export function getCurrentDashboardServiceCredential(): DashboardServiceCredentialFile | null {
    return current;
}

/** Fingerprint for diagnostics only — never log the raw key. */
export function credentialFingerprint(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * Remove the on-disk credential after revoke. Safe if missing. Refuses symlink escape.
 */
export function clearDashboardServiceCredentialFile(cwd: string = process.cwd()): void {
    const filePath = credentialPath(cwd);
    try {
        if (!fs.existsSync(filePath)) {
            current = null;
            return;
        }
        const st = fs.lstatSync(filePath);
        if (st.isSymbolicLink()) {
            log.warn('Refusing to unlink dashboard credential symlink; removing link only.');
            fs.unlinkSync(filePath);
            current = null;
            return;
        }
        fs.unlinkSync(filePath);
    } catch (err: unknown) {
        log.warn(
            `Failed to clear dashboard credential file: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
    current = null;
}
