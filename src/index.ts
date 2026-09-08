import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { secrets } from '#core/helpers/secretManager.js';
import { getLogger, flushLogs } from '#core/utils/logger.js';
import { materializeBootSharedRandEnv } from '#core/placeholder/sharedBootRand.js';
import { runBootPipeline } from '#core/bootstrap/pipeline.js';

const isUpdaterOnly =
    process.argv.includes('--updater') ||
    process.env.UpdaterOnly === '1' ||
    process.env.UPDATER_ONLY === '1';

function readArgValue(names: string[]): string | null {
    for (let i = 0; i < process.argv.length; i++) {
        const a = process.argv[i];
        for (const name of names) {
            if (a === name) return process.argv[i + 1] ?? null;
            if (a.startsWith(name + '=')) return a.slice(name.length + 1) || null;
        }
    }
    return null;
}

async function runUpdaterMode(): Promise<void> {
    const logger = getLogger('Bootstrap');
    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('system.boot.start', {
                mode: process.env.SHARD_LIST ? 'sharded-worker' : 'standalone',
                at: Date.now(),
            }),
        )
        .catch(() => undefined);
    try {
        runBootPipeline();
        const { runUpdater } = await import('#core/manager/updater/index.js');
        const force = process.argv.includes('--force');
        const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');
        const baselineOnly = process.argv.includes('--baseline-only') || process.argv.includes('--baselineOnly');
        const downgrade = process.argv.includes('--downgrade');
        const listBackups = process.argv.includes('--list-backups') || process.argv.includes('--listBackups');
        const installPlugin = readArgValue(['--install-plugin', '--installPlugin']);
        const targetTag = readArgValue(['--target']);
        const pluginTag = readArgValue(['--plugin-tag', '--pluginTag']);
        const restoreBackup = readArgValue(['--restore-backup', '--restoreBackup']);

        await runUpdater({
            force,
            dryRun,
            baselineOnly,
            installPlugin,
            targetTag,
            downgrade,
            pluginTag,
            listBackups,
            restoreBackup
        });
        await flushLogs();
        process.exit(process.exitCode ?? 0);
    } catch (error) {
        logger.error('FATAL UPDATER CRASH:', error);
        process.exit(1);
    }
}

async function runPreBootUpdater(logger: ReturnType<typeof getLogger>): Promise<boolean> {
    const { Updater, getUpdaterConfig } = await import('#core/manager/updater/index.js');
    const cfg = getUpdaterConfig();
    if (!cfg.autoUpdater) {
        logger.info('Pre-boot updater skipped (AutoUpdater=false)');
        return false;
    }

    logger.info('Pre-boot updater pass (no Discord client)…');
    const t0 = performance.now();
    const updater = new Updater();
    const plan = await updater.run({ dryRun: cfg.dryRun });
    const ms = Math.round(performance.now() - t0);
    logger.info(`Pre-boot updater finished in ${ms}ms — ${plan.reason} (allowed=${plan.allowed})`);

    if (plan.dryRun || !plan.allowed) return false;

    const coreChanged =
        !!plan.toTag && plan.fromTag !== plan.toTag &&
        (plan.filesToOverwrite.length > 0 || plan.filesToAdd.length > 0);

    const pluginsChanged = plan.pluginDecisions.some(
        d => d.action === 'update' || d.action === 'add' || d.action === 'remove'
    );

    if (coreChanged || pluginsChanged) {
        logger.info(
            `Pre-boot changes applied (core=${coreChanged}, plugins=${pluginsChanged}); exiting for clean restart`
        );
        return true;
    }
    return false;
}

async function runBotMode(): Promise<void> {
    const {
        Client, Partials, Events, ShardingManager
    } = await import('discord.js');
    const { intentBuilder } = await import('#core/helpers/intentsBuilder.js');
    const { pluginManager } = await import('#core/loader/index.js');
    const { httpServer } = await import('#core/manager/http/server.js');
    const { DiscordMiddleware } = await import('#core/manager/discordMiddleware.js');
    const { interactionHandler } = await import('#core/manager/interaction/handler.js');
    const { configManager } = await import('#core/manager/config.js');
    const { i18n } = await import('#core/manager/lang.js');
    const { eventManager } = await import('#core/manager/events/Manager.js');
    const { initAllDatabases } = await import('#core/database/bootstrap.js');
    const { globalCatcher } = await import('#core/errors/index.js');
    const { emojis } = await import('#core/manager/emoji.js');
    const { wireErrorBridge } = await import('#core/bootstrap/errorBridge.js');
    const { createPermissionsManager } = await import('#core/manager/permissions.js');
    const { createPermissionCache } = await import('#core/manager/permissionCache.js');

    class Zene {
        private readonly log = getLogger('Bootstrap');
        private readonly client: InstanceType<typeof Client<true>>;
        private isShuttingDown = false;
        private stopBackgroundUpdater: (() => void) | null = null;

        constructor() {
            const intentsInput = secrets.getOptional('DiscordIntents')
                ? secrets.get('DiscordIntents').split(',').map(s => s.trim())
                : undefined;

            this.client = new Client({
                intents: intentBuilder.build(intentsInput),
                partials: [
                    Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember,
                    Partials.Reaction, Partials.ThreadMember, Partials.GuildScheduledEvent
                ]
            }) as InstanceType<typeof Client<true>>;

            eventManager.bindNativeEvents(this.client);
            globalCatcher.init();
            wireErrorBridge();
            globalCatcher.registerTeardown(async () => await this.cleanupResources());
            this.setupProcessSignals();
        }

        private get isPrimaryShard(): boolean {
            const shards = this.client.options.shards;
            return !shards || (Array.isArray(shards) && shards[0] === 0) || shards === 0;
        }

        private get shardIdentifier(): string {
            const shards = this.client.options.shards;
            if (!shards) return '(Standalone)';
            return Array.isArray(shards) ? `(Shard ${shards.join(',')})` : `(Shard ${shards})`;
        }

        public async bootstrap(): Promise<void> {
            const start = performance.now();
            this.log.info(`Booting Zene ${this.shardIdentifier} [${process.env.NODE_ENV}]...`);

            try {
                const hotReloadEnabled = secrets.getBoolean('hotReloadEnabled', false);
                this.log.info('Initializing Discord Middleware...');
                DiscordMiddleware.apply();
                this.log.info('Preloading Plugins...');
                await pluginManager.preloadAll();

                this.log.info('Loading Configurations...');
                await configManager.init(hotReloadEnabled);

                this.log.info('Loading Language Dictionary...');
                await i18n.init(hotReloadEnabled);

                try {
                    const { logDisabledPlugins } = await import('#core/validation/pluginGate.js');
                    logDisabledPlugins();
                } catch (e) {
                    this.log.warn('Validation gate log skipped:', e);
                }

                this.log.info('Initializing Databases...');
                await initAllDatabases();

                this.log.info('Running database migrations...');
                const { runAllMigrations } = await import('#core/database/migrations/runner.js');
                const pluginMigrationSources = pluginManager.getPreloadedPluginDirs
                    ? pluginManager.getPreloadedPluginDirs()
                    : [];
                const migrationResult = await runAllMigrations({ plugins: pluginMigrationSources });
                for (const pluginId of migrationResult.failedPlugins) {
                    this.log.error(`Disabling plugin after migration failure: ${pluginId}`);
                    pluginManager.excludePreloadedPlugin(pluginId, 'migration_failed');
                    try {
                        await pluginManager.disable(pluginId);
                    } catch (err) {
                        this.log.warn(`Could not disable plugin ${pluginId}`, err);
                    }
                }

                this.log.info('Initializing Permission System...');
                const permMgr = createPermissionsManager();
                await permMgr.init();
                const permCache = createPermissionCache(permMgr);
                await permCache.init();
                permMgr.setCache(permCache);
                const { setHeartPermissions } = await import('#core/heart/index.js');
                setHeartPermissions(permMgr, permCache);

                this.log.info('Initializing Interaction Handler...');
                interactionHandler.init();

                await this.login();

                if (this.isPrimaryShard) {
                    httpServer.init();
                    await httpServer.start(parseInt(secrets.getOptional('APIPort') || '3000', 10));
                }

                this.log.info('Booting Plugins...');
                await pluginManager.bootAll(this.client);

                if (this.isPrimaryShard) {
                    httpServer.finalize();
                }

                await emojis.init(hotReloadEnabled);

                this.log.info('Syncing Commands...');
                await interactionHandler.syncCommands(this.client, secrets.getOptional('GuildID'));

                const duration = ((performance.now() - start) / 1000).toFixed(2);
                this.log.info(`Zene fully initialized in ${duration}s.`);

                if (this.isPrimaryShard) {
                    this.log.info('Panel Status Override: Bot Online, Running, Active, Bot Ready, Logged in, Server up and running');
                    try {
                        const { markUpdaterHealthy, startBackgroundUpdater, getUpdaterConfig } =
                            await import('#core/manager/updater/index.js');
                        markUpdaterHealthy();
                        if (getUpdaterConfig().mode === 'background') {
                            this.stopBackgroundUpdater = startBackgroundUpdater({ skipInitial: true });
                        }
                    } catch (e) {
                        this.log.warn('Updater post-boot hooks failed:', e);
                    }
                }
            } catch (error) {
                this.log.error('Critical failure during bootstrap sequence:', error);
                await this.cleanupResources().catch((cleanupErr: unknown) => {
                    this.log.error('Cleanup after bootstrap failure also failed:', cleanupErr);
                });
                throw error;
            }
        }

        private async login(): Promise<void> {
            return new Promise((resolve, reject) => {
                const onReady = (readyClient: InstanceType<typeof Client<true>>) => {
                    this.log.info(`Connected to Discord Gateway as ${readyClient.user.tag}`);
                    resolve();
                };

                this.client.once(Events.ClientReady, onReady);

                try {
                    this.client.login(secrets.get('DiscordToken')).catch(error => {
                        this.client.off(Events.ClientReady, onReady);
                        reject(error);
                    });
                } catch (error) {
                    this.client.off(Events.ClientReady, onReady);
                    reject(error);
                }
            });
        }

        private async cleanupResources(): Promise<void> {
            if (this.isShuttingDown) return;
            this.isShuttingDown = true;

            this.log.info(`Tearing down resources for ${this.shardIdentifier}...`);
            void import('#core/manager/event.js')
                .then(({ eventBus }) =>
                    eventBus.emitConcurrent('system.shutdown.start', {
                        signal: 'cleanup',
                        role: this.shardIdentifier,
                        at: Date.now(),
                    }),
                )
                .catch(() => undefined);

            try {
                this.stopBackgroundUpdater?.();
                this.stopBackgroundUpdater = null;

                await pluginManager.shutdownAll().catch((e: unknown) => this.log.error('Plugin shutdown error:', e));

                if (this.isPrimaryShard) {
                    await httpServer.stop().catch((e: unknown) => this.log.error('HTTP Server shutdown error:', e));
                }

                try {
                    if (this.client) {
                        this.client.destroy();
                    }
                } catch (e) {
                    this.log.warn('Client destroy during teardown failed:', e);
                }

                try {
                    const { sqliteDB } = await import('#core/database/sqlite.js');
                    await sqliteDB.disconnectAll();
                } catch (e) {
                    this.log.warn('SQLite disconnect during teardown failed:', e);
                }

                this.log.info(`Finishing teardown for ${this.shardIdentifier}`);
                await new Promise((r) => setTimeout(r, 250));
                await flushLogs();
            } catch (error) {
                this.log.error('Fatal error during resource cleanup:', error);
            }
        }

        private setupProcessSignals(): void {
            const handleSignal = async (signal: string) => {
                this.log.warn(`[${signal}] Signal received. Gracefully shutting down...`);
                await this.cleanupResources();
                process.exit(0);
            };

            process.on('SIGTERM', () => handleSignal('SIGTERM'));
            process.on('SIGINT', () => handleSignal('SIGINT'));
        }
    }

    const logger = getLogger('Bootstrap');
    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('system.boot.start', {
                mode: process.env.SHARD_LIST ? 'sharded-worker' : 'standalone',
                at: Date.now(),
            }),
        )
        .catch(() => undefined);
    const isSpawnedWorker = process.env.SHARD_LIST !== undefined || typeof process.send === 'function';

    try {
        runBootPipeline();

        if (!isSpawnedWorker) {
            try {
                const { checkPendingRollbackOnBoot } = await import('#core/manager/updater/index.js');
                const rolled = await checkPendingRollbackOnBoot();
                if (rolled) {
                    logger.warn('Auto-rollback completed – exiting for clean restart');
                    await flushLogs();
                    process.exit(0);
                }
            } catch (e) {
                logger.warn('Pending-rollback check skipped:', e);
            }

            try {
                const shouldRestart = await runPreBootUpdater(logger);
                if (shouldRestart) {
                    await flushLogs();
                    process.exit(0);
                }
            } catch (e) {
                logger.warn('Pre-boot updater failed (continuing boot):', e);
            }
        }

        if (!isSpawnedWorker) {
            materializeBootSharedRandEnv(process.cwd());
        }

        const crossHostEnabled = secrets.getBoolean('CROSS_HOST', false);
        if (crossHostEnabled) {
            const role = secrets.getOptional('CROSS_HOST_ROLE');
            if (role !== 'orchestrator' && role !== 'worker') {
                logger.error(
                    'CROSS_HOST is enabled but CROSS_HOST_ROLE must be set to "orchestrator" or "worker"',
                );
                await flushLogs();
                process.exit(1);
            }
            const { runCrossHost } = await import('#core/crosshost/bootstrap.js');
            await runCrossHost(role);
            return;
        }

        const isSharded = secrets.getBoolean('isSharded', false);

        if (isSharded && !isSpawnedWorker) {
            const masterLog = getLogger('ShardingManager');
            masterLog.info('Booting into Sharded Mode...');

            const entryFile = fileURLToPath(import.meta.url);
            materializeBootSharedRandEnv(process.cwd());
            const manager = new ShardingManager(entryFile, {
                token: secrets.get('DiscordToken'),
                totalShards: 'auto',
                respawn: true,
            });

            manager.on('shardCreate', shard => {
                masterLog.info(`Successfully launched Shard #${shard.id}`);
            });
            let masterShuttingDown = false;
            const shutdownMaster = () => {
                if (masterShuttingDown) return;
                masterShuttingDown = true;
                masterLog.warn('Shutting down. Broadcasting exit to fleet...');
                manager.respawn = false;
                setTimeout(() => process.exit(0), 2000);
            };
            process.on('SIGTERM', shutdownMaster);
            process.on('SIGINT', shutdownMaster);

            await manager.spawn();
        } else {
            const app = new Zene();
            await app.bootstrap();
        }
    } catch (error) {
        logger.error('FATAL APPLICATION CRASH:', error);
        process.exit(1);
    }
}

const BOOT_LOCK = Symbol.for('ZENE_BOOT_LOCK');

if (!(globalThis as any)[BOOT_LOCK]) {
    (globalThis as any)[BOOT_LOCK] = true;

    if (isUpdaterOnly) {
        runUpdaterMode();
    } else {
        runBotMode();
    }
}
