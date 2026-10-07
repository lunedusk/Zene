/**
 * Child-process entry for isolated plugin host.
 * Started with: node --import ... processMain.js
 * Env: ZENE_RUNTIME_ID, ZENE_PLUGIN_ID
 */
import { PluginRuntimeHost } from './pluginHost.js';
import type { CoreToHostMessage, HostToCoreMessage } from '../protocol.js';

const runtimeId = process.env.ZENE_RUNTIME_ID ?? '';
const pluginId = process.env.ZENE_PLUGIN_ID ?? '';

if (!runtimeId || !pluginId) {
    process.stderr.write('processMain requires ZENE_RUNTIME_ID and ZENE_PLUGIN_ID\n');
    process.exit(1);
}

if (typeof process.send !== 'function') {
    process.stderr.write('processMain requires IPC channel\n');
    process.exit(1);
}

const send = process.send.bind(process);

const host = new PluginRuntimeHost(
    runtimeId,
    pluginId,
    'process',
    (msg: HostToCoreMessage) => {
        send(msg);
    },
);

process.on('message', (raw: unknown) => {
    void host.handle(raw as CoreToHostMessage);
});
