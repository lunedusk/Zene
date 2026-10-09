import pkg from 'pg';
const { Pool } = pkg;
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('PostgresNative');

export class PostgresRegistry {
    private pools = new Map<string, pkg.Pool>();
    private readonly connecting = new Map<string, Promise<void>>();

    public async connect(alias: string, uri: string, poolSize: number = 10): Promise<void> {
        if (this.pools.has(alias)) return;
        const pending = this.connecting.get(alias);
        if (pending) {
            await pending;
            return;
        }

        const work = (async () => {
            if (this.pools.has(alias)) return;
            log.info(`Initializing Native Postgres pool [${alias}] (Max: ${poolSize})`);

            const pool = new Pool({
                connectionString: uri,
                max: poolSize,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 5000,
            });

            const client = await pool.connect();
            client.release();

            this.pools.set(alias, pool);
            log.info(`Native Postgres [${alias}] connected successfully.`);
        })();

        this.connecting.set(alias, work);
        try {
            await work;
        } finally {
            this.connecting.delete(alias);
        }
    }

    public has(alias: string): boolean {
        return this.pools.has(alias);
    }

    public get(alias: string): pkg.Pool {
        const pool = this.pools.get(alias);
        if (!pool) throw new Error(`Postgres pool [${alias}] not found!`);
        return pool;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, pool] of this.pools.entries()) {
            try {
                await pool.query('SELECT 1');
                status[alias] = true;
            } catch {
                status[alias] = false;
            }
        }
        return status;
    }

    public async disconnect(alias: string): Promise<void> {
        const pool = this.pools.get(alias);
        if (!pool) return;
        log.info(`Closing Native Postgres pool [${alias}]...`);
        await pool.end();
        this.pools.delete(alias);
    }

    public async disconnectAll(): Promise<void> {
        for (const alias of [...this.pools.keys()]) {
            await this.disconnect(alias);
        }
    }
}

export const pgDB = new PostgresRegistry();