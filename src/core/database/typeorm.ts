import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('SqlRegistry');
const isProd = process.env.NODE_ENV === 'production';

function buildDataSourceOptions(
    protocol: string,
    uri: string,
    entities: Function[],
    poolSize: number,
): DataSourceOptions {
    const pathname = (() => {
        try {
            return new URL(uri).pathname.replace(/^\//, '');
        } catch {
            return '';
        }
    })();

    const common = {
        synchronize: !isProd,
        logging: false as const,
        entities,
    };

    switch (protocol) {
        case 'postgres':
        case 'postgresql':
            return {
                type: 'postgres',
                url: uri,
                ...common,
                extra: { max: poolSize },
            };
        case 'mysql':
            return {
                type: 'mysql',
                url: uri,
                ...common,
                extra: { max: poolSize },
            };
        case 'mariadb':
            return {
                type: 'mariadb',
                url: uri,
                ...common,
                extra: { max: poolSize },
            };
        case 'sqlite':
            return {
                type: 'better-sqlite3',
                database: pathname,
                ...common,
            };
        default:
            throw new Error(`Unsupported ORM dialect: ${protocol}`);
    }
}

export class SqlRegistry {
    private engines = new Map<string, DataSource>();

    public async connect(alias: string, uri: string, entities: Function[] = [], poolSize: number = 10): Promise<void> {
        if (this.engines.has(alias)) return;

        const url = new URL(uri);
        const protocol = url.protocol.replace(':', '');

        const options = buildDataSourceOptions(protocol, uri, entities, poolSize);
        const dbType = options.type;

        log.info(`Initializing TypeORM (${dbType}) for: [${alias}]`);

        const engine = new DataSource(options);
        await engine.initialize();
        this.engines.set(alias, engine);
        log.info(`TypeORM [${alias}] connected successfully.`);
    }

    public get(alias: string): DataSource {
        const engine = this.engines.get(alias);
        if (!engine) throw new Error(`TypeORM engine [${alias}] not found!`);
        return engine;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, engine] of this.engines.entries()) {
            try {
                await engine.query('SELECT 1');
                status[alias] = true;
            } catch {
                status[alias] = false;
            }
        }
        return status;
    }

    public async disconnectAll(): Promise<void> {
        for (const [alias, engine] of this.engines.entries()) {
            if (engine.isInitialized) {
                log.info(`Closing TypeORM connection [${alias}]...`);
                await engine.destroy();
            }
            this.engines.delete(alias);
        }
    }
}

export const ormDB = new SqlRegistry();
