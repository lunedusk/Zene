/**
 * Validates an installed @lunedusk/zene-sdk package (from .tgz artifact).
 *
 * Intended workflow (run by the human, not the agent):
 *   1. cd packages/zene-sdk && npm run pack:artifact
 *   2. cd packages/zene-sdk-consumer-check
 *   3. rm -rf node_modules package-lock.json
 *   4. npm install ../zene-sdk/lunedusk-zene-sdk-0.1.0.tgz
 *   5. npx tsx import-surface.mts
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

// --- root import ---
const sdk = await import('@lunedusk/zene-sdk');
assert.equal(typeof sdk.SDK_VERSION, 'string');
assert.equal(typeof sdk.createPluginSdk, 'function');
assert.equal(typeof sdk.getSdkCompatibilityInfo, 'function');
assert.equal(sdk.isSdkContractCompatible(sdk.SDK_CONTRACT_VERSION), true);

// Mutation / host surfaces must not exist on the package root
assert.equal('getSdkBridge' in sdk, false);
assert.equal('registerSdkBridge' in sdk, false);
assert.equal('hostRegisterSdkBridge' in sdk, false);
assert.equal('clearSdkBridge' in sdk, false);

// --- discord subpath ---
const discord = await import('@lunedusk/zene-sdk/discord');
assert.ok(discord);

// --- ./host must be unavailable ---
await assert.rejects(
    () => import('@lunedusk/zene-sdk/host'),
    (err: unknown) => err instanceof Error,
);

// --- package.json of installed package ---
const pkgJsonPath = require.resolve('@lunedusk/zene-sdk/package.json');
const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
    name: string;
    exports: Record<string, unknown>;
    files?: string[];
};
assert.equal(pkg.name, '@lunedusk/zene-sdk');
assert.equal(pkg.exports['./host'], undefined);

// Resolve main entry is under dist, not src
const mainPath = require.resolve('@lunedusk/zene-sdk');
assert.ok(
    mainPath.includes(`${join('node_modules', '@lunedusk', 'zene-sdk')}`),
    `expected node_modules install, got ${mainPath}`,
);
assert.ok(
    mainPath.endsWith(join('dist', 'index.js')) || mainPath.includes(`${join('dist', 'index')}`),
    `expected dist entry, got ${mainPath}`,
);
assert.equal(mainPath.includes(`${join('src', 'core')}`), false);
assert.equal(mainPath.includes('#core'), false);

// createPluginSdk requires injected bridge
const bridge = {
    session: {
        pluginId: 'consumer',
        runtimeId: 'r1',
        generation: 1,
        sdkVersion: sdk.SDK_VERSION,
        trustOutcome: 'trusted',
        authorized: true,
    },
    log: () => undefined,
    config: {
        get: async () => undefined,
        set: async () => undefined,
        has: () => false,
        getRaw: async () => undefined,
    },
    events: {
        emit: async () => undefined,
        on: () => () => undefined,
        once: () => () => undefined,
    },
    providers: { select: () => undefined, register: () => 'x' },
    resources: { track: () => 'r', untrack: () => undefined },
    data: {
        registerType: () => undefined,
        access: async () => undefined,
        export: async () => undefined,
        delete: async () => 0,
    },
    dashboard: {
        contribute: () => 'c',
        revoke: () => undefined,
        list: () => [],
    },
    http: {
        registerRouter: () => undefined,
        unregisterRouter: () => undefined,
        listMounts: () => [],
    },
    commands: {
        registerRoot: async () => 'c',
        extendRoot: async () => 'e',
        registerChat: () => 'c',
        registerButton: () => 'b',
        registerSelect: () => 's',
        registerModal: () => 'm',
        unregister: () => undefined,
    },
    crossHost: {
        send: async () => {
            throw new sdk.SdkError({
                code: 'CROSSHOST_UNSUPPORTED',
                message: 'unsupported',
            });
        },
    },
    scheduler: {
        every: async () => ({ name: 't' }),
        cron: async () => ({ name: 't' }),
        cancel: async () => undefined,
    },
    cooldowns: {
        define: () => undefined,
        isRateLimited: async () => ({ limited: false, remaining: 0 }),
        refund: async () => undefined,
    },
    permissions: {
        hasBit: async () => false,
        requireBit: async () => undefined,
    },
    features: { register: () => undefined },
    locale: { t: () => '' },
    emoji: { get: () => null, parse: (s: string) => s },
    cache: {
        get: async () => null,
        set: async () => undefined,
        delete: async () => false,
    },
    diagnostics: { increment: () => undefined, timing: () => undefined },
    guild: { resolveName: () => undefined },
    runtimeRequirements: {},
    dependencies: [],
} as unknown as import('@lunedusk/zene-sdk').SdkBridge;

const instance = sdk.createPluginSdk(
    { id: 'consumer', name: 'Consumer', version: '0.0.1' },
    bridge,
);
assert.equal(instance.session.pluginId, 'consumer');

console.log('consumer-check ok', sdk.SDK_VERSION, mainPath);
