/**
 * Worker-thread entry: bootstrap PluginRuntimeHost on MessagePort.
 */
import { parentPort, workerData, isMainThread } from 'node:worker_threads';
import { PluginRuntimeHost } from './pluginHost.js';
import type { CoreToHostMessage, HostToCoreMessage } from '../protocol.js';

if (isMainThread || !parentPort) {
    throw new Error('workerEntry must run inside a Worker');
}

const data = workerData as {
    runtimeId: string;
    pluginId: string;
};

const port = parentPort;
const host = new PluginRuntimeHost(
    data.runtimeId,
    data.pluginId,
    'worker',
    (msg: HostToCoreMessage) => {
        port.postMessage(msg);
    },
);

port.on('message', (raw: unknown) => {
    void host.handle(raw as CoreToHostMessage);
});
