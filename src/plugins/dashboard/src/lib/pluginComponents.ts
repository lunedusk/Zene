/**
 * Projects plugin-contributed composition components from the authoritative
 * dashboard contribution registry.
 *
 * Components are strictly declarative: a plugin may describe props, slots, and
 * a bounded presentation tag, but it may not ship executable render code,
 * remote URLs, or arbitrary endpoints. Registration is only projected while the
 * plugin passes the existing integrity gate.
 */

import { listContributions } from '#core/dashboard/index.js';
import { isPluginContributionAllowed } from './pluginContributionGate.js';

const CATEGORIES = new Set([
    'structure',
    'content',
    'presentation',
    'navigation',
    'forms',
    'data',
    'states',
    'discord',
]);
const GROUPS = new Set(['content', 'layout', 'style', 'media', 'data', 'visibility', 'interactions', 'a11y', 'advanced']);
const CONTROLS = new Set([
    'text',
    'textarea',
    'markdown',
    'number',
    'range',
    'boolean',
    'select',
    'color',
    'url',
    'image-url',
    'list',
    'binding',
]);
const LAYOUT_MODES = new Set(['flow', 'stack', 'row', 'grid', 'split', 'overlay']);
const TAGS = new Set(['div', 'section', 'article', 'aside', 'p']);

export interface PluginComponentView {
    type: string;
    version: number;
    name: string;
    description: string;
    category: string;
    keywords: string[];
    defaults: Record<string, unknown>;
    schema: Array<Record<string, unknown>>;
    slots: Array<Record<string, unknown>>;
    layoutModes: string[];
    responsive: boolean;
    resizable: boolean;
    interactive: boolean;
    pluginId: string;
    declarative: { tag: string; textProp?: string };
}

export interface PluginComponentProjection {
    components: PluginComponentView[];
    rejected: Array<{ pluginId: string; contributionId: string; reason: string }>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function sanitizeSchemaEntry(entry: unknown): Record<string, unknown> | null {
    if (!isPlainObject(entry)) return null;
    if (!isBoundedString(entry.key, 64) || !/^[a-z][a-zA-Z0-9]*$/.test(entry.key)) return null;
    if (!isBoundedString(entry.label, 120)) return null;
    if (!GROUPS.has(String(entry.group)) || !CONTROLS.has(String(entry.control))) return null;
    const out: Record<string, unknown> = {
        key: entry.key,
        label: entry.label,
        group: entry.group,
        control: entry.control,
    };
    if (entry.required === true) out.required = true;
    if (isBoundedString(entry.description, 400)) out.description = entry.description;
    if (isBoundedString(entry.placeholder, 200)) out.placeholder = entry.placeholder;
    if (entry.defaultValue !== undefined) out.defaultValue = entry.defaultValue;
    if (Array.isArray(entry.options)) {
        out.options = entry.options
            .filter((option) => isPlainObject(option) && isBoundedString(option.value, 120) && isBoundedString(option.label, 120))
            .slice(0, 40)
            .map((option) => ({ value: option.value, label: option.label }));
    }
    if (typeof entry.min === 'number' && Number.isFinite(entry.min)) out.min = entry.min;
    if (typeof entry.max === 'number' && Number.isFinite(entry.max)) out.max = entry.max;
    if (typeof entry.step === 'number' && Number.isFinite(entry.step)) out.step = entry.step;
    if (Array.isArray(entry.itemFields)) {
        out.itemFields = entry.itemFields
            .filter((field) => isPlainObject(field) && isBoundedString(field.key, 64) && isBoundedString(field.label, 120))
            .slice(0, 12)
            .map((field) => ({
                key: field.key,
                label: field.label,
                control: CONTROLS.has(String(field.control)) ? field.control : 'text',
                required: field.required === true,
            }));
    }
    return out;
}

function sanitizeComponent(raw: unknown, pluginId: string): PluginComponentView | { reason: string } {
    if (!isPlainObject(raw)) return { reason: 'component must be an object' };
    const type = raw.type;
    if (typeof type !== 'string') return { reason: 'component type is required' };
    const match = /^plugin\.([a-z0-9-]+)\.[a-z][a-zA-Z0-9-]{0,63}$/.exec(type);
    if (!match) return { reason: 'component type must be plugin.<pluginId>.<name>' };
    if (match[1] !== pluginId) return { reason: 'component type pluginId does not match contributing plugin' };
    if (!Number.isInteger(raw.version) || (raw.version as number) < 1 || (raw.version as number) > 1000) {
        return { reason: 'version must be a positive integer' };
    }
    if (!isBoundedString(raw.name, 80) || !isBoundedString(raw.description, 400)) {
        return { reason: 'name and description are required' };
    }
    if (!CATEGORIES.has(String(raw.category))) return { reason: 'unsupported category' };
    if (!isPlainObject(raw.defaults) || JSON.stringify(raw.defaults).length > 20_000) {
        return { reason: 'defaults must be a small JSON object' };
    }
    if (!Array.isArray(raw.schema) || raw.schema.length > 40) return { reason: 'schema must be an array (max 40)' };
    const schema: Array<Record<string, unknown>> = [];
    for (const entry of raw.schema) {
        const clean = sanitizeSchemaEntry(entry);
        if (!clean) return { reason: 'invalid schema entry' };
        schema.push(clean);
    }
    const slots: Array<Record<string, unknown>> = [];
    if (raw.slots !== undefined) {
        if (!Array.isArray(raw.slots) || raw.slots.length > 10) return { reason: 'slots must be an array (max 10)' };
        for (const slot of raw.slots) {
            if (!isPlainObject(slot) || !isBoundedString(slot.name, 40) || !/^[a-z][a-z0-9-]*$/.test(slot.name)) {
                return { reason: 'invalid slot name' };
            }
            if (!isBoundedString(slot.label, 80)) return { reason: 'slot label required' };
            const accepts = slot.accepts;
            if (accepts !== undefined && accepts !== '*' && (!Array.isArray(accepts) || accepts.some((t) => typeof t !== 'string'))) {
                return { reason: 'slot accepts must be "*" or a string array' };
            }
            slots.push({
                name: slot.name,
                label: slot.label,
                ...(accepts !== undefined ? { accepts } : {}),
                ...(typeof slot.min === 'number' ? { min: slot.min } : {}),
                ...(typeof slot.max === 'number' ? { max: slot.max } : {}),
            });
        }
    }
    const layoutModes = Array.isArray(raw.layoutModes)
        ? raw.layoutModes.filter((mode) => LAYOUT_MODES.has(String(mode))).slice(0, 6)
        : [];
    const declarative = isPlainObject(raw.declarative) ? raw.declarative : {};
    const tag = TAGS.has(String(declarative.tag)) ? String(declarative.tag) : 'div';
    const textProp = isBoundedString(declarative.textProp, 64) ? declarative.textProp : undefined;
    return {
        type,
        version: raw.version as number,
        name: raw.name,
        description: raw.description,
        category: String(raw.category),
        keywords: Array.isArray(raw.keywords)
            ? raw.keywords.filter((keyword): keyword is string => typeof keyword === 'string').slice(0, 12)
            : [],
        defaults: raw.defaults,
        schema,
        slots,
        layoutModes: layoutModes as string[],
        responsive: raw.responsive !== false,
        resizable: raw.resizable === true,
        interactive: raw.interactive === true,
        pluginId,
        declarative: { tag, ...(textProp ? { textProp } : {}) },
    };
}

export function listPluginComponents(): PluginComponentProjection {
    const components: PluginComponentView[] = [];
    const rejected: PluginComponentProjection['rejected'] = [];
    for (const contribution of listContributions({ kind: 'widget' })) {
        if (contribution.state !== 'active') continue;
        if (!isPluginContributionAllowed(contribution.pluginId)) {
            rejected.push({
                pluginId: contribution.pluginId,
                contributionId: contribution.contributionId,
                reason: 'plugin integrity gate rejected contributions',
            });
            continue;
        }
        const payload = contribution.payload;
        if (!isPlainObject(payload) || !Array.isArray(payload['compositionComponents'])) continue;
        for (const raw of payload['compositionComponents']) {
            const result = sanitizeComponent(raw, contribution.pluginId);
            if ('reason' in result) {
                rejected.push({
                    pluginId: contribution.pluginId,
                    contributionId: contribution.contributionId,
                    reason: result.reason,
                });
                continue;
            }
            components.push(result);
        }
    }
    return { components, rejected };
}
