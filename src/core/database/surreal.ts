import {
    Surreal,
    createRemoteEngines,
    type DriverOptions,
    type ConnectOptions,
} from 'surrealdb';
import { createNodeEngines } from '@surrealdb/node';
import { WebSocket as NodeWebSocket } from 'ws';
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

            // Node 20 has no stable global WebSocket for normal process starts.
            // Provide `ws` via DriverOptions.websocketImpl. DOM typings require
            // dispatchEvent which `ws` does not declare; Surreal only needs the
            // constructible WebSocket surface at runtime. Narrow unknown assertion
            // is limited to this single SDK type boundary (TS2352).
            const driverOptions: DriverOptions = {
                engines: {
                    ...createRemoteEngines(),
                    ...createNodeEngines(),
                },
                websocketImpl: NodeWebSocket as unknown as DriverOptions['websocketImpl'],
            };
            const db = new Surreal(driverOptions);

            try {
                // Prefer single connect(url, ConnectOptions) so namespace/database and
                // credentials are applied together. Auth before any post-connect use().
                const connectOpts: ConnectOptions = {};
                if (options.namespace !== undefined) {
                    connectOpts.namespace = options.namespace;
                }
                if (options.database !== undefined) {
                    connectOpts.database = options.database;
                }
                if (options.token !== undefined && options.token !== '') {
                    connectOpts.authentication = options.token;
                } else if (
                    options.username !== undefined &&
                    options.username !== ''
                ) {
                    connectOpts.authentication = {
                        username: options.username,
                        password: options.password ?? '',
                    };
                }
                // Unauthenticated servers: omit authentication entirely.

                await db.connect(resolvedUri, connectOpts);

                this.clients.set(alias, db);
                log.info(`SurrealDB [${alias}] connected successfully.`);
            } catch (error) {
                try {
                    await db.close();
                } catch {
                    // ignore close errors during failed init
                }
                const err = error instanceof Error ? error : new Error(String(error));
                const kind =
                    /WebSocketImpl is not a constructor|websocket/i.test(err.message)
                        ? 'websocket_impl'
                        : /ECONNREFUSED|ENOTFOUND|connect/i.test(err.message)
                          ? 'connection'
                          : /auth|signin|authenticate|token/i.test(err.message)
                            ? 'authentication'
                            : 'initialization';
                log.error(`Failed to initialize SurrealDB [${alias}]`, {
                    kind,
                    name: err.name,
                    protocol,
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

                await client.version();
                status[alias] = true;
            } catch {
                status[alias] = false;
            }
        }
        return status;
    }

    public async disconnect(alias: string): Promise<void> {
        const client = this.clients.get(alias);
        if (!client) return;
        log.info(`Closing SurrealDB connection [${alias}]...`);
        try {
            await client.close();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            log.warn(`Error closing SurrealDB [${alias}]: ${err.name}`);
        }
        this.clients.delete(alias);
    }

    public async disconnectAll(): Promise<void> {
        for (const alias of [...this.clients.keys()]) {
            await this.disconnect(alias);
        }
    }
}

export const surrealDB = new SurrealRegistry();
