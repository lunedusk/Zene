/**
 * Build public command catalog from Zene CommandRegistry — no invented commands.
 */

import {
    listCommandTree,
    getRegisteredRoot,
} from '#core/loader/commandRegistry.js';

export interface PublicCommandEntry {
    id: string;
    name: string;
    description: string;
    usage: string;
    category: string;
    pluginId: string;
    aliases: string[];
    subcommands: string[];
    public: true;
}

export function buildPublicCommandCatalog(): {
    frozen: boolean;
    commands: PublicCommandEntry[];
} {
    const tree = listCommandTree();
    const commands: PublicCommandEntry[] = [];
    for (const root of tree.roots) {
        const reg = getRegisteredRoot(root.name);
        let description = '';
        try {
            const json = reg?.data?.toJSON?.() as { description?: string } | undefined;
            description = typeof json?.description === 'string' ? json.description : '';
        } catch {
            description = '';
        }
        commands.push({
            id: root.name,
            name: root.name,
            description,
            usage: `/${root.name}`,
            category: root.ownerPluginId || 'core',
            pluginId: root.ownerPluginId,
            aliases: [],
            subcommands: root.subHandlers,
            public: true,
        });
    }
    commands.sort((a, b) => a.name.localeCompare(b.name));
    return { frozen: tree.frozen, commands };
}
