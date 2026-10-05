



export type PublicSectionType =
    | 'hero'
    | 'features'
    | 'commands'
    | 'servers'
    | 'plugins'
    | 'statistics'
    | 'performance'
    | 'security'
    | 'integrations'
    | 'screenshots'
    | 'faq'
    | 'docs'
    | 'changelog'
    | 'cta'
    | 'custom';

export interface PublicSectionBase {
    readonly id: string;
    readonly type: PublicSectionType;
    enabled: boolean;
    order: number;
    title?: string;
    description?: string;
    themeOverrides?: Record<string, string>;
    visibility?: { public?: boolean };
}

export interface PublicHeroSection extends PublicSectionBase {
    type: 'hero';
    headline?: string;
    subhead?: string;
    primaryCtaLabel?: string;
    primaryCtaHref?: string;
    secondaryCtaLabel?: string;
    secondaryCtaHref?: string;
}

export interface PublicFeaturesSection extends PublicSectionBase {
    type: 'features';
    items: Array<{ id: string; title: string; description: string; icon?: string }>;
}

export interface PublicFaqSection extends PublicSectionBase {
    type: 'faq';
    items: Array<{ id: string; question: string; answer: string }>;
}

export interface PublicCtaSection extends PublicSectionBase {
    type: 'cta';
    label?: string;
    href?: string;
}


export interface PublicScreenshotsSection extends PublicSectionBase {
    type: 'screenshots';
    items: Array<{ id: string; title?: string; description?: string; icon?: string }>;
}

export interface PublicGenericSection extends PublicSectionBase {
    type: Exclude<
        PublicSectionType,
        'hero' | 'features' | 'faq' | 'cta' | 'screenshots'
    >;
    content?: string;
}

export type PublicSection =
    | PublicHeroSection
    | PublicFeaturesSection
    | PublicFaqSection
    | PublicCtaSection
    | PublicScreenshotsSection
    | PublicGenericSection;

export interface PublicSiteConfig {
    version: number;
    sections: PublicSection[];
    navigation?: Array<{ id: string; label: string; href: string; external?: boolean }>;
    metadata?: { title?: string; description?: string };
}

export const PUBLIC_SITE_TARGET = {
    targetKind: 'public_site',
    targetKey: 'default',
} as const;

export function defaultPublicSite(): PublicSiteConfig {
    return {
        version: 1,
        sections: [
            {
                id: 'hero',
                type: 'hero',
                enabled: true,
                order: 0,
                headline: undefined,
                subhead: 'Permissions, plugins, and an owner-customizable dashboard.',
                primaryCtaLabel: 'Invite',
                secondaryCtaLabel: 'Dashboard',
                secondaryCtaHref: '/login',
            },
            {
                id: 'features',
                type: 'features',
                enabled: true,
                order: 10,
                title: 'Why teams choose it',
                items: [
                    {
                        id: 'f1',
                        title: 'Hierarchy-aware permissions',
                        description: 'Server actions respect rank and target checks.',
                    },
                    {
                        id: 'f2',
                        title: 'Plugin surfaces',
                        description: 'Plugins contribute pages through the dashboard registry.',
                    },
                    {
                        id: 'f3',
                        title: 'Owner customization',
                        description: 'Layouts and themes override defaults without forking source.',
                    },
                ],
            },
            {
                id: 'security',
                type: 'security',
                enabled: true,
                order: 20,
                title: 'Security',
                content:
                    'Authentication is separate from authorization. Capability and hierarchy checks run on the server.',
            },
            {
                id: 'commands',
                type: 'commands',
                enabled: true,
                order: 25,
                title: 'Commands',
                description: 'Browse registered slash commands.',
            },
            {
                id: 'statistics',
                type: 'statistics',
                enabled: true,
                order: 30,
                title: 'At a glance',
                description: 'Live operational counts from this deployment.',
            },
            {
                id: 'screenshots',
                type: 'screenshots',
                enabled: true,
                order: 40,
                title: 'Product',
                items: [],
            },
            {
                id: 'faq',
                type: 'faq',
                enabled: true,
                order: 50,
                title: 'FAQ',
                items: [
                    {
                        id: 'q1',
                        question: 'How do I invite the bot?',
                        answer: 'Use the Invite button when an invite URL is configured for this deployment.',
                    },
                    {
                        id: 'q2',
                        question: 'Who can access the owner dashboard?',
                        answer: 'Only elevated identities after server-side authorization.',
                    },
                ],
            },
            {
                id: 'cta',
                type: 'cta',
                enabled: true,
                order: 90,
                title: 'Get started',
                label: 'Open dashboard',
                href: '/login',
            },
        ],
        navigation: [
            { id: 'home', label: 'Home', href: '/' },
            { id: 'features', label: 'Features', href: '/features' },
            { id: 'commands', label: 'Commands', href: '/commands' },
            { id: 'docs', label: 'Docs', href: '/docs' },
            { id: 'changelog', label: 'Changelog', href: '/changelog' },
            { id: 'faq', label: 'FAQ', href: '/faq' },
            { id: 'security', label: 'Security', href: '/security' },
            { id: 'dashboard', label: 'Dashboard', href: '/login' },
        ],
        metadata: {},
    };
}

export function normalizePublicSite(raw: unknown): PublicSiteConfig {
    if (!raw || typeof raw !== 'object') return defaultPublicSite();
    const o = raw as Partial<PublicSiteConfig>;
    const base = defaultPublicSite();
    const sections = Array.isArray(o.sections) ? (o.sections as PublicSection[]) : base.sections;
    return {
        version: typeof o.version === 'number' ? o.version : 1,
        sections: sections
            .filter((s) => s && typeof s.id === 'string' && typeof s.type === 'string')
            .map((s, i) => ({
                ...s,
                enabled: s.enabled !== false,
                order: typeof s.order === 'number' ? s.order : i * 10,
            }))
            .sort((a, b) => a.order - b.order),
        navigation: Array.isArray(o.navigation) ? o.navigation : base.navigation,
        metadata: o.metadata && typeof o.metadata === 'object' ? o.metadata : {},
    };
}
