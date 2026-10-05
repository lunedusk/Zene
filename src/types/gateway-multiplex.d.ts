declare module '@lunedusk/gateway-multiplex' {
    export class GatewayMultiplex {
        constructor(options?: Record<string, unknown>);
        setShards(shardIds: readonly number[], totalShards: number): Promise<void> | void;
        addShard(shardId: number): Promise<void> | void;
        removeShard(shardId: number): Promise<void> | void;
        destroy(): Promise<void> | void;
        on(event: string, listener: (...args: unknown[]) => void): this;
    }
}
