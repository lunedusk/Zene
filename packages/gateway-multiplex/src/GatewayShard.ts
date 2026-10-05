import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {
    CONNECT_TIMEOUT_MS,
    FATAL_CLOSE_CODES,
    GATEWAY_VERSION,
    GatewayCloseCode,
    GatewayOpcode,
    READY_TIMEOUT_MS,
    RESUMABLE_CLOSE_CODES,
} from './constants.js';
import type { IdentifyQueue } from './identifyQueue.js';
import type {
    GatewayPayload,
    HelloPayload,
    IdentifyProperties,
    PresenceUpdateData,
    ReadyPayload,
    SessionInfo,
    SessionStore,
    ShardStatus,
} from './types.js';

export interface GatewayShardOptions {
    readonly shardId: number;
    readonly shardCount: number;
    readonly token: string;
    readonly intents: number;
    readonly gatewayUrl: string;
    readonly largeThreshold: number;
    readonly properties: IdentifyProperties;
    readonly presence: PresenceUpdateData | null;
    readonly sessionStore: SessionStore;
    readonly identifyQueue: IdentifyQueue;
    readonly autoReconnect: boolean;
}

export class GatewayShard extends EventEmitter {
    public readonly shardId: number;
    private readonly opts: GatewayShardOptions;
    private ws: WebSocket | null = null;
    private status: ShardStatus = 'idle';
    private sequence: number | null = null;
    private sessionId: string | null = null;
    private resumeUrl: string | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private heartbeatAcked = true;
    private reconnectAttempts = 0;
    private destroyRequested = false;
    private connectGeneration = 0;

    public constructor(opts: GatewayShardOptions) {
        super();
        this.shardId = opts.shardId;
        this.opts = opts;
    }

    public getStatus(): ShardStatus {
        return this.status;
    }

    public getSequence(): number | null {
        return this.sequence;
    }

    public async connect(): Promise<void> {
        if (this.destroyRequested) {
            throw new Error(`Shard ${this.shardId} is destroyed`);
        }
        if (this.status === 'ready' || this.status === 'identifying' || this.status === 'resuming') {
            return;
        }

        const session = await this.opts.sessionStore.get(this.shardId);
        const canResume = session !== null && session.sessionId.length > 0;
        const urlBase = canResume && session.resumeUrl ? session.resumeUrl : this.opts.gatewayUrl;
        const url = buildGatewayUrl(urlBase);

        if (session) {
            this.sessionId = session.sessionId;
            this.sequence = session.sequence;
            this.resumeUrl = session.resumeUrl;
        }

        this.status = canResume ? 'reconnecting' : 'connecting';
        this.emit('debug', `shard ${this.shardId} connecting`, { url, canResume });

        const generation = ++this.connectGeneration;
        await this.openSocket(url, generation, canResume);
    }

    public async destroy(options?: { clearSession?: boolean }): Promise<void> {
        this.destroyRequested = true;
        this.clearHeartbeat();
        const ws = this.ws;
        this.ws = null;
        this.status = 'destroyed';
        if (options?.clearSession) {
            this.sessionId = null;
            this.sequence = null;
            this.resumeUrl = null;
            await this.opts.sessionStore.delete(this.shardId);
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.close(1000, 'shard destroyed');
            } catch {

            }
        }
        this.emit('disconnect', 1000, 'destroyed', false);
    }

    public send(op: number, data: unknown): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error(`Shard ${this.shardId} socket not open`);
        }
        this.ws.send(JSON.stringify({ op, d: data }));
    }

    private async openSocket(url: string, generation: number, preferResume: boolean): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const fail = (err: Error) => {
                if (settled || generation !== this.connectGeneration) return;
                settled = true;
                cleanup();
                reject(err);
            };
            const ok = () => {
                if (settled || generation !== this.connectGeneration) return;
                settled = true;
                cleanup();
                resolve();
            };

            const connectTimer = setTimeout(() => {
                fail(new Error(`Shard ${this.shardId} connect timeout`));
                try {
                    this.ws?.terminate();
                } catch {

                }
            }, CONNECT_TIMEOUT_MS);
            connectTimer.unref?.();

            let readyTimer: NodeJS.Timeout | null = null;

            const cleanup = () => {
                clearTimeout(connectTimer);
                if (readyTimer) clearTimeout(readyTimer);
            };

            try {
                const ws = new WebSocket(url);
                this.ws = ws;

                ws.on('open', () => {
                    this.emit('debug', `shard ${this.shardId} socket open`);
                });

                ws.on('message', (raw) => {
                    if (generation !== this.connectGeneration) return;
                    void this.onMessage(raw, preferResume, ok, fail, () => {
                        if (!readyTimer) {
                            readyTimer = setTimeout(() => {
                                fail(new Error(`Shard ${this.shardId} READY timeout`));
                            }, READY_TIMEOUT_MS);
                            readyTimer.unref?.();
                        }
                    });
                });

                ws.on('close', (code, reasonBuf) => {
                    const reason = reasonBuf.toString('utf8') || 'unknown';
                    void this.onClose(code, reason, generation);
                    if (!settled) {
                        fail(new Error(`Shard ${this.shardId} closed before ready: ${code} ${reason}`));
                    }
                });

                ws.on('error', (err) => {
                    this.emit('error', err instanceof Error ? err : new Error(String(err)));
                    if (!settled) {
                        fail(err instanceof Error ? err : new Error(String(err)));
                    }
                });
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private async onMessage(
        raw: WebSocket.RawData,
        preferResume: boolean,
        onReady: () => void,
        onFail: (err: Error) => void,
        armReadyTimeout: () => void,
    ): Promise<void> {
        let payload: GatewayPayload;
        try {
            const text = typeof raw === 'string' ? raw : Buffer.from(raw as Buffer).toString('utf8');
            payload = JSON.parse(text) as GatewayPayload;
        } catch (err) {
            onFail(err instanceof Error ? err : new Error('Invalid gateway JSON'));
            return;
        }

        if (typeof payload.s === 'number') {
            this.sequence = payload.s;
        }

        switch (payload.op) {
            case GatewayOpcode.Hello: {
                const hello = payload.d as HelloPayload;
                this.startHeartbeat(hello.heartbeat_interval);
                armReadyTimeout();
                try {
                    if (preferResume && this.sessionId && this.sequence !== null) {
                        this.status = 'resuming';
                        this.send(GatewayOpcode.Resume, {
                            token: this.opts.token,
                            session_id: this.sessionId,
                            seq: this.sequence,
                        });
                    } else {
                        await this.opts.identifyQueue.waitTurn(this.shardId);
                        this.status = 'identifying';
                        this.sendIdentify();
                    }
                } catch (err) {
                    onFail(err instanceof Error ? err : new Error(String(err)));
                }
                break;
            }
            case GatewayOpcode.HeartbeatAck: {
                this.heartbeatAcked = true;
                break;
            }
            case GatewayOpcode.Heartbeat: {
                this.sendHeartbeat();
                break;
            }
            case GatewayOpcode.Reconnect: {
                this.emit('debug', `shard ${this.shardId} received RECONNECT`);
                this.ws?.close(1001, 'reconnect requested');
                break;
            }
            case GatewayOpcode.InvalidSession: {
                const resumable = Boolean(payload.d);
                this.emit('debug', `shard ${this.shardId} invalid session`, { resumable });
                if (!resumable) {
                    this.sessionId = null;
                    this.sequence = null;
                    await this.opts.sessionStore.delete(this.shardId);
                }
                this.ws?.close(1001, 'invalid session');
                break;
            }
            case GatewayOpcode.Dispatch: {
                const event = payload.t;
                if (!event) break;
                const data = payload.d;
                const seq = typeof payload.s === 'number' ? payload.s : this.sequence ?? 0;

                if (event === 'READY') {
                    const ready = data as ReadyPayload;
                    this.sessionId = ready.session_id;
                    this.resumeUrl = ready.resume_gateway_url;
                    const info: SessionInfo = {
                        sessionId: ready.session_id,
                        sequence: this.sequence ?? 0,
                        resumeUrl: ready.resume_gateway_url,
                    };
                    await this.opts.sessionStore.set(this.shardId, info);
                    this.status = 'ready';
                    this.reconnectAttempts = 0;
                    this.emit('ready', ready);
                    onReady();
                } else if (event === 'RESUMED') {
                    this.status = 'ready';
                    this.reconnectAttempts = 0;
                    this.emit('resumed');
                    onReady();
                }

                this.emit('dispatch', event, data, seq);
                if (this.sessionId && this.sequence !== null && this.resumeUrl) {
                    await this.opts.sessionStore.set(this.shardId, {
                        sessionId: this.sessionId,
                        sequence: this.sequence,
                        resumeUrl: this.resumeUrl,
                    });
                }
                break;
            }
            default:
                break;
        }
    }

    private async onClose(code: number, reason: string, generation: number): Promise<void> {
        if (generation !== this.connectGeneration) return;
        this.clearHeartbeat();
        this.ws = null;

        const resumable = RESUMABLE_CLOSE_CODES.has(code) && this.sessionId !== null;
        const fatal = FATAL_CLOSE_CODES.has(code);

        this.status = 'disconnected';
        this.emit('disconnect', code, reason, resumable && !fatal);

        if (this.destroyRequested || fatal) {
            if (fatal || code === GatewayCloseCode.AuthenticationFailed) {
                await this.opts.sessionStore.delete(this.shardId);
            }
            return;
        }

        if (!this.opts.autoReconnect) return;

        this.reconnectAttempts += 1;
        const delay = Math.min(30_000, 500 * 2 ** Math.min(this.reconnectAttempts, 6));
        this.emit('reconnecting', this.reconnectAttempts);
        await sleep(delay);
        if (this.destroyRequested) return;
        try {
            await this.connect();
        } catch (err) {
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        }
    }

    private sendIdentify(): void {
        const body: Record<string, unknown> = {
            token: this.opts.token,
            intents: this.opts.intents,
            properties: {
                os: this.opts.properties.os,
                browser: this.opts.properties.browser,
                device: this.opts.properties.device,
            },
            large_threshold: this.opts.largeThreshold,
            shard: [this.shardId, this.opts.shardCount],
        };
        if (this.opts.presence) {
            body.presence = this.opts.presence;
        }
        this.send(GatewayOpcode.Identify, body);
    }

    private startHeartbeat(intervalMs: number): void {
        this.clearHeartbeat();
        this.heartbeatAcked = true;
        const jitter = Math.random() * intervalMs;
        this.heartbeatTimer = setTimeout(() => {
            this.sendHeartbeat();
            this.heartbeatInterval = setInterval(() => this.sendHeartbeat(), intervalMs);
            this.heartbeatInterval.unref?.();
        }, jitter);
        this.heartbeatTimer.unref?.();
    }

    private sendHeartbeat(): void {
        if (!this.heartbeatAcked) {
            this.emit('debug', `shard ${this.shardId} missing heartbeat ACK; reconnecting`);
            try {
                this.ws?.close(1001, 'missing heartbeat ack');
            } catch {

            }
            return;
        }
        this.heartbeatAcked = false;
        try {
            this.send(GatewayOpcode.Heartbeat, this.sequence);
        } catch {

        }
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }
}

function buildGatewayUrl(base: string): string {
    const cleaned = base.replace(/\/$/, '');
    const u = new URL(cleaned.includes('?') ? cleaned : `${cleaned}/`);
    u.searchParams.set('v', String(GATEWAY_VERSION));
    u.searchParams.set('encoding', 'json');
    return u.toString();
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        t.unref?.();
    });
}
