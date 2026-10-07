/**
 * Isolated runtime fixture — derives identity from real execution context.
 */

import { isMainThread } from 'node:worker_threads';
import type { IsolatedPluginModule } from '../../host/pluginHost.js';

let setupRan = false;
let enableRan = false;

const fixture: IsolatedPluginModule = {
    async onSetup() {
        setupRan = true;
    },
    async onEnable() {
        enableRan = true;
    },
    async onDisable() {
        enableRan = false;
    },
    async onUnload() {
        setupRan = false;
        enableRan = false;
    },
    getEvidence() {
        return {
            setupRan,
            enableRan,
            pid: process.pid,
            isMainThread,
            hasDiscordToken: process.env.DiscordToken !== undefined,
            hasZeneRuntimeId: process.env.ZENE_RUNTIME_ID !== undefined,
        };
    },
    async registerWithHost(register) {
        register('resource', 'echo-resource', { label: 'fixture-echo' });
        register('event', 'echo.event', { once: false });
        register('handler', 'echoHandler');
        register('command', 'echo');
        register('route', 'echo-route', { path: '/echo' });
        register('interaction', 'echo-btn');
        register('provider', 'echo-provider', {
            category: 'plugin.custom',
            priority: 1,
        });
    },
    forceThrow() {
        throw new Error('fixture intentional failure');
    },
};

export default fixture;
