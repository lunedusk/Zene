import {
    SlashCommandBuilder,
    type ChatInputCommandInteraction,
    type AutocompleteInteraction,
} from 'discord.js';
import { getLogger } from '#core/utils/logger.js';
import type { IHeart } from '#core/heart/index.js';
import type { CommandConfig } from '#core/bases/Command.js';
import {
    assertCommandName,
    assertDescription,
    assertGroupCount,
    assertOptionCount,
    assertSubcommandCount,
    DiscordLimitError,
    DuplicateRegistrationError,
    StructureLockedError,
} from './discordLimits.js';
import {
    buildRequirementContext,
    evaluateRequirements,
    requirementsMode,
    type RegisterRequirements,
} from './requirements.js';
import { interactionRegistry } from '#core/manager/interaction/registry.js';

const log = getLogger('CommandRegistry');

export type ChatExecute = (interaction: ChatInputCommandInteraction) => Promise<void>;
export type ChatAutocomplete = (interaction: AutocompleteInteraction) => Promise<void>;

export interface RegisteredRoot {
    readonly name: string;
    readonly ownerPluginId: string;
    /** Present for SDK/runtime-scoped registrations. */
    readonly runtimeId?: string;
    /** Present for SDK/runtime-scoped registrations. */
    readonly generation?: number;
    /**
     * InteractionRegistry owner key.
     * File-based commands use pluginId; SDK uses sdk:pluginId:runtimeId:generation.
     */
    readonly dispatchOwner: string;
    data: SlashCommandBuilder;
    config: CommandConfig;
    execute: ChatExecute;
    autocomplete?: ChatAutocomplete;
    subHandlers: Map<string, ChatExecute>;
}

let frozen = false;
const roots = new Map<string, RegisteredRoot>();

export function isCommandStructureFrozen(): boolean {
    return frozen;
}

export function freezeCommandStructure(): void {
    frozen = true;
    log.info('Command structure frozen');
    void import('#plugins/core/src/utils/helpUtils.js')
        .then(({ HelpUtils }) => {
            HelpUtils.clearCache();
        })
        .catch(() => undefined);
    void import('#core/manager/event.js')
        .then(({ eventBus }) =>
            eventBus.emitConcurrent('commands.structure.freeze', {
                roots: [...roots.keys()],
                at: Date.now(),
            }),
        )
        .catch(() => undefined);
}

export function assertStructureWritable(resync?: boolean): void {
    if (frozen && !resync) {
        throw new StructureLockedError(
            'Command structure is frozen; pass resync: true to mutate and resync application commands',
        );
    }
}

export function getRegisteredRoot(name: string): RegisteredRoot | undefined {
    return roots.get(name);
}

/**
 * Remove a root command only when ownership matches.
 * SDK registrations must pass runtimeId + generation so R1 cannot remove R2.
 * File-based commands omit runtime fields and match pluginId-only ownership.
 */
export function unregisterRootCommand(filter: {
    readonly name: string;
    readonly pluginId: string;
    readonly runtimeId?: string;
    readonly generation?: number;
}): boolean {
    const root = roots.get(filter.name);
    if (!root) return false;
    if (root.ownerPluginId !== filter.pluginId) return false;
    if (filter.runtimeId !== undefined && root.runtimeId !== filter.runtimeId) {
        return false;
    }
    if (filter.generation !== undefined && root.generation !== filter.generation) {
        return false;
    }
    interactionRegistry.chat.unregisterByOwner(root.dispatchOwner);
    interactionRegistry.autocomplete.unregisterByOwner(root.dispatchOwner);
    roots.delete(filter.name);
    log.info(
        `[${filter.pluginId}] unregistered root command /${filter.name}` +
            (filter.runtimeId
                ? ` runtime=${filter.runtimeId} gen=${String(filter.generation)}`
                : ''),
    );
    return true;
}

export function listCommandTree(): {
    frozen: boolean;
    roots: Array<{
        name: string;
        ownerPluginId: string;
        runtimeId?: string;
        generation?: number;
        dispatchOwner: string;
        subHandlers: string[];
    }>;
} {
    return {
        frozen,
        roots: [...roots.values()].map((r) => ({
            name: r.name,
            ownerPluginId: r.ownerPluginId,
            runtimeId: r.runtimeId,
            generation: r.generation,
            dispatchOwner: r.dispatchOwner,
            subHandlers: [...r.subHandlers.keys()],
        })),
    };
}

export async function registerRootCommand(opts: {
    heart: IHeart;
    pluginId: string;
    data: SlashCommandBuilder;
    config: CommandConfig;
    execute: ChatExecute;
    autocomplete?: ChatAutocomplete;
    requirements?: RegisterRequirements;
    resync?: boolean;
    /** SDK/runtime generation ownership (optional for file-based loaders). */
    runtimeId?: string;
    generation?: number;
}): Promise<boolean> {
    assertStructureWritable(opts.resync);
    const name = opts.data.name;
    assertCommandName(name, 'command');
    if (typeof opts.data.description === 'string') {
        assertDescription(opts.data.description, 'command');
    }

    const ctx = buildRequirementContext(opts.heart, opts.pluginId);
    const req = await evaluateRequirements(opts.requirements ?? opts.config.requirements, ctx);
    if (!req.ok) {
        const mode = requirementsMode(opts.requirements ?? opts.config.requirements, 'strict');
        const msg = `Command "${name}" requirements failed: ${req.reasons.join('; ')}`;
        if (mode === 'strict') {
            throw new Error(msg);
        }
        log.info(`[${opts.pluginId}] skipped command ${name}: ${req.reasons.join('; ')}`);
        return false;
    }

    if (roots.has(name)) {
        throw new DuplicateRegistrationError(
            `Root command "${name}" is already registered by plugin "${roots.get(name)!.ownerPluginId}"`,
        );
    }

    const json = opts.data.toJSON() as {
        options?: Array<{ type: number; options?: unknown[] }>;
    };
    const options = json.options ?? [];
    const groups = options.filter((o) => o.type === 2);
    const subs = options.filter((o) => o.type === 1);
    assertGroupCount(groups.length, name);
    assertSubcommandCount(subs.length, name);
    assertOptionCount(
        options.filter((o) => o.type !== 1 && o.type !== 2).length,
        name,
    );

    const dispatchOwner =
        opts.runtimeId !== undefined && opts.generation !== undefined
            ? `sdk:${opts.pluginId}:${opts.runtimeId}:${opts.generation}`
            : opts.pluginId;

    roots.set(name, {
        name,
        ownerPluginId: opts.pluginId,
        runtimeId: opts.runtimeId,
        generation: opts.generation,
        dispatchOwner,
        data: opts.data,
        config: opts.config,
        execute: opts.execute,
        autocomplete: opts.autocomplete,
        subHandlers: new Map(),
    });

    opts.heart.discord.interactions.chat.register(
        name,
        async (i: ChatInputCommandInteraction) => {
            const root = roots.get(name);
            if (!root) return;
            const sub = i.options.getSubcommand(false);
            const group = i.options.getSubcommandGroup(false);
            const key = group && sub ? `${group}:${sub}` : sub;
            if (key && root.subHandlers.has(key)) {
                await root.subHandlers.get(key)!(i);
                return;
            }
            await root.execute(i);
        },
        dispatchOwner,
        {
            data: opts.data,
            access: opts.config,
        },
    );

    if (opts.autocomplete) {
        opts.heart.discord.interactions.autocomplete.register(
            name,
            opts.autocomplete,
            dispatchOwner,
        );
    }

    log.info(`[${opts.pluginId}] registered root command /${name}`);
    return true;
}

export interface ExtendSubcommand {
    kind: 'subcommand';
    name: string;
    description: string;
    group?: string;
    requirements?: RegisterRequirements;
    execute: ChatExecute;
}

export interface ExtendGroup {
    kind: 'group';
    name: string;
    description: string;
    requirements?: RegisterRequirements;
    subcommands: Array<{
        name: string;
        description: string;
        requirements?: RegisterRequirements;
        execute: ChatExecute;
    }>;
}

export type CommandExtension = ExtendSubcommand | ExtendGroup;

export async function extendCommand(
    heart: IHeart,
    pluginId: string,
    rootName: string,
    extension: CommandExtension,
    options?: { resync?: boolean },
): Promise<boolean> {
    assertStructureWritable(options?.resync);
    const root = roots.get(rootName);
    if (!root) {
        throw new Error(`Cannot extend unknown root command "${rootName}"`);
    }

    const ctx = buildRequirementContext(heart, pluginId);

    if (extension.kind === 'subcommand') {
        assertCommandName(extension.name, 'subcommand');
        assertDescription(extension.description, 'subcommand');
        const req = await evaluateRequirements(extension.requirements, ctx);
        if (!req.ok) {
            const mode = requirementsMode(extension.requirements, 'soft');
            if (mode === 'strict') {
                throw new Error(
                    `Subcommand ${rootName}.${extension.name}: ${req.reasons.join('; ')}`,
                );
            }
            log.info(
                `[${pluginId}] skipped subcommand ${rootName}.${extension.name}: ${req.reasons.join('; ')}`,
            );
            return false;
        }

        const handlerKey = extension.group
            ? `${extension.group}:${extension.name}`
            : extension.name;
        if (root.subHandlers.has(handlerKey)) {
            throw new DuplicateRegistrationError(
                `Subcommand "${handlerKey}" already exists under /${rootName}`,
            );
        }

        try {
            if (extension.group) {
                throw new Error(
                    `Adding a subcommand into an existing group via kind:"subcommand" is not supported; use kind:"group" with subcommands[]`,
                );
            }
            root.data.addSubcommand((sub) =>
                sub.setName(extension.name).setDescription(extension.description),
            );
        } catch (err: unknown) {
            if (err instanceof Error && err.message.includes('kind:"group"')) throw err;
            throw new DiscordLimitError(
                err instanceof Error ? err.message : String(err),
                'subcommand',
                25,
                -1,
            );
        }

        root.subHandlers.set(handlerKey, extension.execute);
        heart.discord.interactions.chat.register(
            rootName,
            async (i: ChatInputCommandInteraction) => {
                const r = roots.get(rootName);
                if (!r) return;
                const sub = i.options.getSubcommand(false);
                const group = i.options.getSubcommandGroup(false);
                const key = group && sub ? `${group}:${sub}` : sub;
                if (key && r.subHandlers.has(key)) {
                    await r.subHandlers.get(key)!(i);
                    return;
                }
                await r.execute(i);
            },
            root.dispatchOwner,
            { data: root.data, access: root.config },
        );
        log.info(`[${pluginId}] extended /${rootName} +${handlerKey}`);
        return true;
    }

    assertCommandName(extension.name, 'subcommand_group');
    assertDescription(extension.description, 'subcommand_group');
    const groupReq = await evaluateRequirements(extension.requirements, ctx);
    if (!groupReq.ok) {
        const mode = requirementsMode(extension.requirements, 'soft');
        if (mode === 'strict') {
            throw new Error(`Group ${rootName}.${extension.name}: ${groupReq.reasons.join('; ')}`);
        }
        log.info(
            `[${pluginId}] skipped group ${rootName}.${extension.name}: ${groupReq.reasons.join('; ')}`,
        );
        return false;
    }

    assertSubcommandCount(extension.subcommands.length, `${rootName}.${extension.name}`);
    const accepted: typeof extension.subcommands = [];
    for (const sub of extension.subcommands) {
        const subReq = await evaluateRequirements(sub.requirements, ctx);
        if (!subReq.ok) {
            const mode = requirementsMode(sub.requirements, 'soft');
            if (mode === 'strict') {
                throw new Error(
                    `Sub ${rootName}.${extension.name}.${sub.name}: ${subReq.reasons.join('; ')}`,
                );
            }
            log.info(
                `[${pluginId}] skipped ${rootName}.${extension.name}.${sub.name}: ${subReq.reasons.join('; ')}`,
            );
            continue;
        }
        accepted.push(sub);
    }
    if (accepted.length === 0) return false;

    root.data.addSubcommandGroup((g) => {
        g.setName(extension.name).setDescription(extension.description);
        for (const sub of accepted) {
            assertCommandName(sub.name, 'subcommand');
            assertDescription(sub.description, 'subcommand');
            g.addSubcommand((s) => s.setName(sub.name).setDescription(sub.description));
        }
        return g;
    });

    for (const sub of accepted) {
        const key = `${extension.name}:${sub.name}`;
        if (root.subHandlers.has(key)) {
            throw new DuplicateRegistrationError(
                `Subcommand "${key}" already exists under /${rootName}`,
            );
        }
        root.subHandlers.set(key, sub.execute);
    }

    heart.discord.interactions.chat.register(
        rootName,
        async (i: ChatInputCommandInteraction) => {
            const r = roots.get(rootName);
            if (!r) return;
            const sub = i.options.getSubcommand(false);
            const group = i.options.getSubcommandGroup(false);
            const key = group && sub ? `${group}:${sub}` : sub;
            if (key && r.subHandlers.has(key)) {
                await r.subHandlers.get(key)!(i);
                return;
            }
            await r.execute(i);
        },
        root.ownerPluginId,
        { data: root.data, access: root.config },
    );

    log.info(`[${pluginId}] extended /${rootName} group ${extension.name} (${accepted.length} subs)`);
    return true;
}

export function clearCommandRegistryForTests(): void {
    roots.clear();
    frozen = false;
}
