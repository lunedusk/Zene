
import { getLogger } from '#core/utils/logger.js';

const log = getLogger('GlobalCatcher');

export type TeardownHook = () => void | Promise<void>;

export interface UnhandledErrorPayload {
    type: 'unhandledRejection' | 'uncaughtException';
    message: string;
    stack?: string;
    origin?: string;
    timestamp: string;
}

type UnhandledEmitFn = (payload: UnhandledErrorPayload) => void;

let _unhandledEmitter: UnhandledEmitFn | null = null;

export function injectUnhandledEmitter(fn: UnhandledEmitFn): void {
    if (_unhandledEmitter) return;
    _unhandledEmitter = fn;
}
export class GlobalErrorCatcher {
    private isInitialized  = false;
    private isShuttingDown = false;
    private readonly teardownHooks: TeardownHook[] = [];

    public registerTeardown(hook: TeardownHook): void {
        this.teardownHooks.push(hook);
    }

    public init(): void {
        if (this.isInitialized) return;
        this.isInitialized = true;

        process.on('unhandledRejection', (reason: unknown) => {
            const err = reason instanceof Error ? reason : new Error(String(reason));
            log.error(`[Unhandled Rejection] ${err.message}`, { stack: err.stack });

            _unhandledEmitter?.({
                type:      'unhandledRejection',
                message:   err.message,
                stack:     err.stack,
                timestamp: new Date().toISOString(),
            });
        });

        process.on('uncaughtException', (error: Error, origin: string) => {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            log.error(`[Fatal Uncaught Exception] Origin: ${origin} | Msg: ${error.message}`, { stack: error.stack });

            _unhandledEmitter?.({
                type:      'uncaughtException',
                message:   error.message,
                stack:     error.stack,
                origin,
                timestamp: new Date().toISOString(),
            });

            this.executeFatalTeardown();
        });

        log.info('Global Error Catcher active. Fatal errors will trigger a graceful teardown.');
    }

    private async executeFatalTeardown(): Promise<void> {
        log.warn('Initiating emergency teardown sequence...');

        const timeout = setTimeout(() => {
            log.error('Emergency teardown timed out. Force exiting.');
            process.exit(1);
        }, 5000).unref();

        try {
            await Promise.allSettled(
                this.teardownHooks.map(async (hook) => {
                    try {
                        await hook();
                    } catch (err) {
                        log.error(`Teardown hook failed: ${(err as Error).message}`);
                    }
                })
            );
            log.info('Emergency teardown complete. Process exiting cleanly.');
        } finally {
            clearTimeout(timeout);
            process.exit(1);
        }
    }
}

export const globalCatcher = new GlobalErrorCatcher();