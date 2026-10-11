import { BasePlugin, type PluginManifest } from '#core/bases/Plugin.js';
import { GatewayConfigManager, type GatewayPluginConfig } from './src/lib/GatewayConfigManager.js';
import { bindGatewayRuntimeKeyRegistrar } from '#core/dashboard/gatewayKeyBridge.js';
import { NovaError } from '#core/errors/NovaError.js';

import { featureRequirements } from '#core/manager/featureRequirements.js';

export default class ApiGatewayPlugin extends BasePlugin {

    public readonly manifest: PluginManifest = {
        id:            'api',
        name:          'API',
        version:       '1.2.0',
        description:   'API Gateway — CORS, bearer auth, security headers, and OpenAPI spec.',
        author:        'Lunedusk',
        zene_version: '>=0.5.4',
        node_version:  '>=20',
    };

    public async onSetup(): Promise<void> {
        this.registerApiFeatureRequirements();
        const config = this.heart.assets.config.get<GatewayPluginConfig>('api');

        if (!config) {
            throw new NovaError('API config not found. Ensure data/configuration/config.json5 exists.', {
                code: 'GATEWAY.CONFIG_MISSING',
                category: 'gateway',
                severity: 'fatal',
                userMessage: 'API gateway configuration is missing.',
                statusCode: 500,
            });
        }

        GatewayConfigManager.instance.init(config);
        bindGatewayRuntimeKeyRegistrar({
            registerRuntimeKey: (entry) =>
                GatewayConfigManager.instance.registerRuntimeKey({
                    key: entry.key,
                    label: entry.label,
                    enabled: entry.enabled,
                    ...(entry.bits === undefined
                        ? {}
                        : { bits: [...entry.bits] }),
                }),
            revokeRuntimeKey: (label) =>
                GatewayConfigManager.instance.revokeRuntimeKey(label),
        });
        this.log.info('API Gateway config manager initialised.');
    }

    public async onEnable(): Promise<void> {
        this.log.info('API Gateway is live.');
    }

    public async onDisable(): Promise<void> {
        bindGatewayRuntimeKeyRegistrar(null);
        GatewayConfigManager.instance.clearRuntimeKeys();
        this.log.info('API Gateway shut down.');
    }
    private registerApiFeatureRequirements(): void {
        featureRequirements.register({
            id: 'api.gateway',
            pluginId: 'api',
            description: 'HTTP API gateway (no Discord guild perms)',
            permissions: [],
        });
    }
}
