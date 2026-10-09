import mongoose, { Connection } from 'mongoose';
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('MongoDB');

export class MongoRegistry {
    private connections = new Map<string, Connection>();

    public async connect(alias: string, uri: string, poolSize: number = 10): Promise<void> {
        if (this.connections.has(alias)) return;

        log.info(`Initializing MongoDB connection [${alias}] (Max Pool: ${poolSize})`);

        const conn = await mongoose.createConnection(uri, {
            maxPoolSize: poolSize,
            serverSelectionTimeoutMS: 5000,
        }).asPromise();
        
        this.connections.set(alias, conn);
        log.info(`MongoDB [${alias}] connected successfully.`);
    }

    public has(alias: string): boolean {
        return this.connections.has(alias);
    }

    public get(alias: string): Connection {
        const conn = this.connections.get(alias);
        if (!conn) throw new Error(`MongoDB connection [${alias}] not found!`);
        return conn;
    }

    public async pingAll(): Promise<Record<string, boolean>> {
        const status: Record<string, boolean> = {};
        for (const [alias, conn] of this.connections.entries()) {
            status[alias] = conn.readyState === 1;
        }
        return status;
    }

    public async disconnect(alias: string): Promise<void> {
        const conn = this.connections.get(alias);
        if (!conn) return;
        log.info(`Closing MongoDB connection [${alias}]...`);
        await conn.close();
        this.connections.delete(alias);
    }

    public async disconnectAll(): Promise<void> {
        for (const alias of [...this.connections.keys()]) {
            await this.disconnect(alias);
        }
    }
}

export const mongoDB = new MongoRegistry();