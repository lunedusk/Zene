import type { Cv2LayoutSpec } from '#core/builders/index.js';

export const SETUP_IDS = {
    ROOT: 'security:setup:root',
    AUTOMOD: 'security:setup:automod',
    RAID: 'security:setup:raid',
    VERIFY: 'security:setup:verify',
    ANTINUKE_SAFE: 'security:setup:antinuke_safe',
    REFRESH: 'security:setup:refresh',
    CLOSE: 'security:setup:close',
} as const;

export interface SetupPanelState {
    readonly automodOn: boolean;
    readonly raidOn: boolean;
    readonly verifyOn: boolean;
    readonly antinukeSafeOn: boolean;
    readonly quarantineRoleId: string | null;
}

export function buildSetupLayout(state: SetupPanelState): Cv2LayoutSpec {
    const flag = (on: boolean): string => (on ? '✅ on' : '❌ off');
    return {
        version: 1,
        components: [
            {
                type: 'container',
                accentColor: 0x5865f2,
                children: [
                    {
                        type: 'text',
                        content: '**Security setup**',
                    },
                    {
                        type: 'text',
                        content:
                            'Toggle safe defaults for each module. Destructive anti-nuke rules stay off unless you enable the safe preset (channel/role delete thresholds only).',
                    },
                    {
                        type: 'text',
                        content: [
                            `• AutoMod: **${flag(state.automodOn)}**`,
                            `• Raid guard: **${flag(state.raidOn)}**`,
                            `• Verify: **${flag(state.verifyOn)}**`,
                            `• Anti-nuke safe preset: **${flag(state.antinukeSafeOn)}**`,
                            `• Quarantine role: \`${state.quarantineRoleId ?? 'not set'}\``,
                        ].join('\n'),
                    },
                    {
                        type: 'text',
                        content:
                            '_Set quarantine / verified roles with `/security raid set` and `/security verify settings` after enabling modules._',
                    },
                    {
                        type: 'actionRow',
                        components: [
                            {
                                type: 'button',
                                style: state.automodOn ? 'success' : 'secondary',
                                customId: SETUP_IDS.AUTOMOD,
                                label: 'AutoMod',
                            },
                            {
                                type: 'button',
                                style: state.raidOn ? 'success' : 'secondary',
                                customId: SETUP_IDS.RAID,
                                label: 'Raid',
                            },
                            {
                                type: 'button',
                                style: state.verifyOn ? 'success' : 'secondary',
                                customId: SETUP_IDS.VERIFY,
                                label: 'Verify',
                            },
                            {
                                type: 'button',
                                style: state.antinukeSafeOn ? 'success' : 'secondary',
                                customId: SETUP_IDS.ANTINUKE_SAFE,
                                label: 'Anti-nuke safe',
                            },
                        ],
                    },
                    {
                        type: 'actionRow',
                        components: [
                            {
                                type: 'button',
                                style: 'primary',
                                customId: SETUP_IDS.REFRESH,
                                label: 'Refresh',
                            },
                            {
                                type: 'button',
                                style: 'danger',
                                customId: SETUP_IDS.CLOSE,
                                label: 'Close',
                            },
                        ],
                    },
                ],
            },
        ],
    };
}

