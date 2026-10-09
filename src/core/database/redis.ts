import { Redis } from 'ioredis';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('RedisDB');

export interface RedisClients {
    main: Redis;
    pub: Redis;
    sub: Redis;
}

export class RedisRegistry {
    private instances = new Map<string, RedisClients>();

    public async connect(alias: string, uri: string): Promise<void> {
        if (this.instances.has(alias)) return;

        log.info(`Initializing Redis triad (Main, Pub, Sub) for: [${alias}]`);

        const main = new Redis(uri, { lazyConnect: true, maxRetriesPerRequest: 3 });
        const pub = new Redis(uri, { lazyConnect: true, maxRetriesPerRequest: 3 });
        const sub = new Redis(uri, { lazyConnect: true, maxRetriesPerRequest: 3 });

        const attachListeners = (client: Redis, name: string) => {
            client.on('error', (err) => log.error(`Redis ${name} [${alias}] Error: ${err.message}`));
            client.on('reconnecting', () => log.warn(`Redis ${name} [${alias}] is reconnecting...`));
            client.on('ready', () => log.info(`Redis ${name} [${alias}] connection restored.`));
        };

        attachListeners(main, 'Main');
        attachListeners(pub, 'Pub');
        attachListeners(sub, 'Sub');

        await Promise.all([main.connect(), pub.connect(), sub.connect()]);
        this.instances.set(alias, { main, pub, sub });
        log.info(`Redis triad [${alias}] connected successfully.`);
    }

    public has(alias: string): boolean {
        return this.instances.has(alias);
    }

    public tryGet(alias: string): RedisClients | null {
        return this.instances.get(alias) ?? null;
    }

    public get(alias: string): RedisClients {
        const instance = this.instances.get(alias);
        if (!instance) throw new Error(`Redis instance [${alias}] not found!`);
        return instance;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [name, clients] of this.instances.entries()) {
            try {
                await clients.main.ping();
                status[name] = true;
            } catch {
                status[name] = false;
            }
        }
        return status;
    }

    public async disconnect(alias: string): Promise<void> {
        const clients = this.instances.get(alias);
        if (!clients) return;
        log.info(`Closing Redis triad [${alias}]...`);
        clients.main.disconnect();
        clients.pub.disconnect();
        clients.sub.disconnect();
        this.instances.delete(alias);
    }

    public async disconnectAll(): Promise<void> {
        for (const alias of [...this.instances.keys()]) {
            await this.disconnect(alias);
        }
    }
}

export const redisDB = new RedisRegistry();
