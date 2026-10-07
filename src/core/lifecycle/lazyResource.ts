/**
 * Phase 2B — Lazy resource factory (heavy resources only).
 *
 * Not a blanket "all plugins are lazy" system.
 * Discord.js / resident core infrastructure must not be forced through this.
 *
 * "Auto reboot" here means: released resource can be recreated on next demand
 * via the same factory — not process restart.
 */

export interface LazyResourceOptions<T> {
    readonly factory: () => T | Promise<T>;
    readonly dispose?: (value: T) => void | Promise<void>;
}

export class LazyResource<T> {
    readonly #factory: () => T | Promise<T>;
    readonly #dispose?: (value: T) => void | Promise<void>;
    #value: T | undefined;
    #loading: Promise<T> | null = null;
    #initialized = false;

    constructor(options: LazyResourceOptions<T>) {
        this.#factory = options.factory;
        this.#dispose = options.dispose;
    }

    get isInitialized(): boolean {
        return this.#initialized;
    }

    async get(): Promise<T> {
        if (this.#initialized) return this.#value as T;
        if (this.#loading) return this.#loading;
        this.#loading = Promise.resolve(this.#factory()).then((v) => {
            this.#value = v;
            this.#initialized = true;
            this.#loading = null;
            return v;
        });
        return this.#loading;
    }

    /** Release held value so a later get() recreates it. */
    async release(): Promise<void> {
        if (!this.#initialized) return;
        const current = this.#value as T;
        this.#initialized = false;
        this.#value = undefined;
        this.#loading = null;
        if (this.#dispose) await this.#dispose(current);
    }
}
