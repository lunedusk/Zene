import { Surreal, createRemoteEngines } from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import { getLogger } from '#core/utils/logger.js';
import path from 'node:path';
import fs from 'node:fs';

const log = getLogger('SurrealDB');

/** Optional post-connect setup fields accepted on a SurrealDB alias config. */
export interface SurrealConnectOptions {
    namespace?: string;
    database?: string;
    username?: string;
    password?: string;
    token?: string;
}

const EMBEDDED_PROTOCOLS = new Set([
    'mem',
    'rocksdb',
    'surrealkv',
    'surrealkv+versioned',
]);

const REMOTE_PROTOCOLS = new Set(['ws', 'wss', 'http', 'https']);

export function isSurrealProtocol(protocol: string): boolean {
    const p = protocol.toLowerCase();
    return EMBEDDED_PROTOCOLS.has(p) || REMOTE_PROTOCOLS.has(p);
}

export function isSurrealEmbeddedProtocol(protocol: string): boolean {
    return EMBEDDED_PROTOCOLS.has(protocol.toLowerCase());
}

/**
 * Extract the scheme from a URI without requiring a valid WHATWG URL
 * (embedded paths like `rocksdb://./data/foo` are not always valid host URLs).
 */
export function extractUriProtocol(uri: string): string {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(uri.trim());
    const scheme = match?.[1];
    return scheme ? scheme.toLowerCase() : '';
}

/**
 * Resolve an embedded SurrealDB URI path.
 * - `rocksdb://local` / `surrealkv://local` / bare scheme with no path → structured default under `.data/database/surreal/{engine}/{alias}`
 * - Explicit path after the scheme → resolved absolute path, scheme preserved
 */
export function resolveSurrealUri(uri: string, alias: string): string {
    const trimmed = uri.trim();
    const protocol = extractUriProtocol(trimmed);

    if (!protocol || !isSurrealProtocol(protocol)) {
        return trimmed;
    }

    if (REMOTE_PROTOCOLS.has(protocol) || protocol === 'mem') {
        return trimmed;
    }

    // Strip scheme:// and optional leading slashes for path extraction
    const afterScheme = trimmed.slice(protocol.length + 1).replace(/^\/\//, '');
    const isLocalShorthand =
        afterScheme === '' ||
        afterScheme === 'local' ||
        afterScheme === '/' ||
        afterScheme === './local';

    if (isLocalShorthand) {
        const engineFolder =
            protocol === 'surrealkv+versioned' ? 'surrealkv+versioned' : protocol;
        const dir = path.resolve(
            process.cwd(),
            '.data',
            'database',
            'surreal',
            engineFolder,
            alias,
        );
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return `${protocol}://${dir}`;
    }

    // Honour explicit user path
    const resolved = path.isAbsolute(afterScheme)
        ? afterScheme
        : path.resolve(process.cwd(), afterScheme);
    const parent = path.dirname(resolved);
    if (!fs.existsSync(parent)) {
        fs.mkdirSync(parent, { recursive: true });
    }
    return `${protocol}://${resolved}`;
}

export class SurrealRegistry {
    private clients = new Map<string, Surreal>();
    private readonly connecting = new Map<string, Promise<void>>();

    public async connect(
        alias: string,
        uri: string,
        options: SurrealConnectOptions = {},
    ): Promise<void> {
        if (this.clients.has(alias)) return;

        const pending = this.connecting.get(alias);
        if (pending) {
            await pending;
            return;
        }

        const work = (async () => {
            if (this.clients.has(alias)) return;

            const resolvedUri = resolveSurrealUri(uri, alias);
            const protocol = extractUriProtocol(resolvedUri);

            log.info(
                `Initializing SurrealDB [${alias}] via ${protocol || 'unknown'} → ${resolvedUri}`,
            );

            const db = new Surreal({
                engines: {
                    ...createRemoteEngines(),
                    ...createNodeEngines(),
                },
            });

            try {
                await db.connect(resolvedUri);

                if (options.namespace !== undefined || options.database !== undefined) {
                    await db.use({
                        namespace: options.namespace ?? 'main',
                        database: options.database ?? 'main',
                    });
                }

                if (options.token) {
                    await db.authenticate(options.token);
                } else if (options.username !== undefined && options.password !== undefined) {
                    await db.signin({
                        username: options.username,
                        password: options.password,
                    });
                }

                this.clients.set(alias, db);
                log.info(`SurrealDB [${alias}] connected successfully.`);
            } catch (error) {
                try {
                    await db.close();
                } catch {
                    // ignore close errors during failed connect
                }
                const err = error as Error;
                log.error(`Failed to initialize SurrealDB [${alias}]: ${err.message}`, {
                    stack: err.stack,
                });
                throw err;
            }
        })();

        this.connecting.set(alias, work);
        try {
            await work;
        } finally {
            this.connecting.delete(alias);
        }
    }

    public has(alias: string): boolean {
        return this.clients.has(alias);
    }

    public get(alias: string): Surreal {
        const client = this.clients.get(alias);
        if (!client) {
            throw new Error(`SurrealDB instance [${alias}] not found!`);
        }
        return client;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, client] of this.clients.entries()) {
            try {
                // Lightweight readiness probe — version() hits the engine without side effects
                await client.version();
                status[alias] = true;
            } catch {
                status[alias] = false;
            }
        }
        return status;
    }

    public async disconnectAll(): Promise<void> {
        for (const [alias, client] of this.clients.entries()) {
            log.info(`Closing SurrealDB connection [${alias}]...`);
            try {
                await client.close();
            } catch (error) {
                const err = error as Error;
                log.warn(`Error closing SurrealDB [${alias}]: ${err.message}`);
            }
            this.clients.delete(alias);
        }
    }
}

export const surrealDB = new SurrealRegistry();
