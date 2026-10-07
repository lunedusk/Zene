/**
 * Late-bound invoker to avoid circular imports (bridge ↔ manager ↔ backends).
 */

export type IsolatedInvoker = (
    pluginId: string,
    kind: string,
    name: string,
    args: unknown,
) => Promise<unknown>;

let invoker: IsolatedInvoker | null = null;

export function setIsolatedInvoker(fn: IsolatedInvoker): void {
    invoker = fn;
}

export function getIsolatedInvoker(): IsolatedInvoker {
    if (!invoker) {
        throw new Error('Isolated invoker not bound — RuntimeManager not initialized');
    }
    return invoker;
}
