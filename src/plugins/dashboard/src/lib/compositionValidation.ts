/**
 * Server-side trust boundary for stored composition documents.
 *
 * The browser is never the authority for what can be persisted or published.
 * This validator is intentionally independent of the web app: it enforces the
 * canonical document envelope, bounded tree limits, a closed component-type
 * grammar, the binding-provider allowlist, and a closed interaction/condition
 * vocabulary. Component prop schemas remain a renderer concern; unknown props
 * are preserved but bounded, while unsafe URLs and executable payloads are
 * rejected.
 */

export interface CompositionValidationIssue {
    code: string;
    message: string;
    nodeId?: string;
    path?: string;
}

export interface CompositionValidationResult {
    ok: boolean;
    issues: CompositionValidationIssue[];
}

const MAX_BYTES = 512 * 1024;
const MAX_NODES = 1200;
const MAX_DEPTH = 24;
const MAX_SLOT_CHILDREN = 200;
const MAX_STRING = 200_000;

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

const TYPE_PATTERN =
    /^(?!plugin\.)(structure|content|presentation|navigation|forms|data|states|discord)\.[a-z][a-zA-Z0-9-]*$|^plugin\.[a-z0-9-]+\.[a-z][a-zA-Z0-9-]*$/;

const LAYOUT_MODES = new Set(['flow', 'stack', 'row', 'grid', 'split', 'overlay']);
const BREAKPOINTS = new Set(['desktop', 'tablet', 'mobile']);
const ALIGNMENTS = new Set(['start', 'center', 'end', 'stretch', 'baseline']);
const OVERFLOWS = new Set(['visible', 'hidden', 'auto', 'scroll']);
const POSITIONS = new Set(['relative', 'absolute', 'sticky', 'fixed']);
const CONDITIONS = new Set(['equals', 'not_equals', 'truthy', 'falsy', 'exists', 'in']);
const CONDITION_SOURCES = new Set(['session', 'data', 'state', 'document']);
const INTERACTION_TRIGGERS = new Set(['click', 'submit']);
const INTERACTION_KINDS = new Set(['navigate', 'external', 'scroll-to', 'set-state', 'submit-action']);
const SURFACE_KINDS = new Set(['public_page', 'dashboard_page', 'owner_page', 'custom']);
const URL_KEY_PATTERN = /(href|src|url|poster|image|link)$/i;

const BINDING_PROVIDERS: Record<string, { resources?: readonly string[]; fields: readonly string[] }> = {
    'public.stats': { resources: ['stats'], fields: ['servers', 'users', 'commandsExecuted', 'uptimeMs'] },
    'public.botInfo': { resources: ['identity'], fields: ['name', 'avatarUrl', 'inviteUrl'] },
    'public.commands': { resources: ['catalog'], fields: ['count', 'commands'] },
    'public.site': { resources: ['site'], fields: ['title', 'description', 'sectionCount'] },
    'account.servers': { resources: ['servers'], fields: ['servers', 'count'] },
    session: { resources: ['user'], fields: ['username', 'userId', 'authenticated', 'isOwner'] },
    document: { resources: ['metadata'], fields: ['title', 'description', 'name'] },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJson(value: unknown, depth = 0): boolean {
    if (depth > 32) return false;
    if (value === null) return true;
    const type = typeof value;
    if (type === 'string') return (value as string).length <= MAX_STRING;
    if (type === 'boolean') return true;
    if (type === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every((entry) => isJson(entry, depth + 1));
    if (isPlainObject(value)) {
        return Object.values(value).every((entry) => entry !== undefined && isJson(entry, depth + 1));
    }
    return false;
}

function isSafeUrl(value: string, kind: 'link' | 'media' = 'link'): boolean {
    const v = value.trim();
    if (!v) return true;
    // Protocol-relative URLs must be rejected before the relative-path allowance.
    // Checking '/' first would incorrectly accept '//evil.example/path'.
    if (v.startsWith('//')) return false;
    if (v.startsWith('/')) return true;
    if (v.startsWith('#')) return kind === 'link';
    const lower = v.toLowerCase();
    if (kind === 'link' && (lower.startsWith('mailto:') || lower.startsWith('tel:'))) return true;
    if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return false;
    try {
        const url = new URL(v);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
}

function isApprovedBinding(binding: Record<string, unknown>): boolean {
    if (typeof binding.provider !== 'string') return false;
    const provider = BINDING_PROVIDERS[binding.provider];
    if (!provider) return false;
    if (binding.resource !== undefined) {
        if (typeof binding.resource !== 'string') return false;
        if (!provider.resources || !provider.resources.includes(binding.resource)) return false;
    }
    if (binding.field !== undefined) {
        if (typeof binding.field !== 'string' || !provider.fields.includes(binding.field)) return false;
    }
    return true;
}

/** True when the payload claims to be a canonical composition. */
export function isCompositionPayload(payload: unknown): boolean {
    return isPlainObject(payload) && payload.kind === 'composition';
}

export function validateCompositionPayload(payload: unknown): CompositionValidationResult {
    const issues: CompositionValidationIssue[] = [];
    const add = (code: string, message: string, nodeId?: string, path?: string): void => {
        issues.push({ code, message, nodeId, path });
    };

    if (!isPlainObject(payload)) {
        return { ok: false, issues: [{ code: 'invalid_document', message: 'Composition payload must be an object' }] };
    }
    if (payload.kind !== 'composition') {
        add('invalid_kind', 'Document kind must be "composition"');
    }
    if (payload.schemaVersion !== 1) {
        add('unsupported_schema_version', 'Only composition schemaVersion 1 is supported');
    }
    if (typeof payload.id !== 'string' || payload.id.length < 1 || payload.id.length > 120) {
        add('invalid_document_id', 'Document id must be a non-empty string (max 120 chars)');
    }
    if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 160) {
        add('invalid_document_name', 'Document name is required (max 160 chars)');
    }
    if (!isPlainObject(payload.surface) || typeof payload.surface.kind !== 'string' || typeof payload.surface.key !== 'string') {
        add('invalid_surface', 'Document surface {kind,key} is required');
    } else {
        if (!SURFACE_KINDS.has(payload.surface.kind)) add('invalid_surface_kind', 'Surface kind is not supported');
        if (payload.surface.key.length < 1 || payload.surface.key.length > 128) add('invalid_surface_key', 'Surface key is invalid');
        if (payload.surface.route !== undefined && (typeof payload.surface.route !== 'string' || !isSafeUrl(payload.surface.route))) {
            add('unsafe_url', 'Surface route must be a safe URL');
        }
    }
    if (payload.metadata !== undefined) {
        if (!isPlainObject(payload.metadata)) {
            add('invalid_metadata', 'Metadata must be an object');
        } else {
            for (const key of ['title', 'description'] as const) {
                const value = payload.metadata[key];
                if (value !== undefined && (typeof value !== 'string' || value.length > 4000)) {
                    add('invalid_metadata', `Metadata ${key} must be a string (max 4000 chars)`);
                }
            }
            if (payload.metadata.noIndex !== undefined && typeof payload.metadata.noIndex !== 'boolean') {
                add('invalid_metadata', 'Metadata noIndex must be a boolean');
            }
        }
    }
    if (payload.navigation !== undefined) {
        if (!Array.isArray(payload.navigation) || payload.navigation.length > 50) {
            add('invalid_navigation', 'Navigation must be an array of at most 50 items');
        } else {
            payload.navigation.forEach((item, index) => {
                if (!isPlainObject(item) || typeof item.label !== 'string' || typeof item.href !== 'string') {
                    add('invalid_navigation', 'Navigation items require label and href', undefined, `navigation[${index}]`);
                } else if (!isSafeUrl(item.href)) {
                    add('unsafe_url', 'Navigation href must be safe', undefined, `navigation[${index}].href`);
                }
            });
        }
    }
    if (!isPlainObject(payload.root)) {
        add('missing_root', 'Document root node is required');
        return { ok: false, issues };
    }

    const seenObjects = new WeakSet<object>();
    const ids = new Set<string>();
    const nodeIds = new Set<string>();
    const scrollTargets: Array<{ nodeId?: string; target: string; path: string }> = [];
    let nodeCount = 0;

    interface Frame {
        node: Record<string, unknown>;
        path: string;
        depth: number;
        root: boolean;
    }
    const stack: Frame[] = [{ node: payload.root, path: 'root', depth: 0, root: true }];

    while (stack.length > 0) {
        const frame = stack.pop() as Frame;
        const { node, path, depth, root } = frame;
        if (depth > MAX_DEPTH) {
            add('max_depth', `Composition nesting exceeds ${MAX_DEPTH} levels`, undefined, path);
            continue;
        }
        if (seenObjects.has(node)) {
            add('cyclic_node', 'Node reuses an object reference', typeof node.id === 'string' ? node.id : undefined, path);
            continue;
        }
        seenObjects.add(node);
        nodeCount += 1;
        if (nodeCount > MAX_NODES) {
            if (nodeCount === MAX_NODES + 1) add('too_many_nodes', `Composition exceeds ${MAX_NODES} nodes`);
            continue;
        }
        const nodeId = typeof node.id === 'string' ? node.id : undefined;
        if (!nodeId || !/^[a-zA-Z0-9_-]{1,80}$/.test(nodeId)) {
            add('invalid_node_id', 'Node id must be 1-80 letters, digits, _ or -', nodeId, path);
        } else if (ids.has(nodeId)) {
            add('duplicate_node_id', `Duplicate node id "${nodeId}"`, nodeId, path);
        } else {
            ids.add(nodeId);
            nodeIds.add(nodeId);
        }
        if (typeof node.type !== 'string' || !TYPE_PATTERN.test(node.type)) {
            add('invalid_component_type', 'Node type must be a built-in category or plugin.<pluginId>.<name>', nodeId, `${path}.type`);
        }
        if (node.type === 'structure.page' && !root) {
            add('invalid_component_placement', 'Page components may only be the document root', nodeId, `${path}.type`);
        }
        if (!isPlainObject(node.props)) {
            add('invalid_props', 'Node props must be an object', nodeId, `${path}.props`);
        } else if (!isJson(node.props)) {
            add('invalid_props', 'Node props must be JSON-serializable', nodeId, `${path}.props`);
        } else {
            for (const [key, value] of Object.entries(node.props)) {
                if (typeof value === 'string' && URL_KEY_PATTERN.test(key) && !isSafeUrl(value, /image|src|poster/i.test(key) ? 'media' : 'link')) {
                    add('unsafe_url', `Property "${key}" contains an unsafe URL`, nodeId, `${path}.props.${key}`);
                }
            }
        }
        for (const [key, value] of Object.entries(node.bindings ?? {})) {
            if (!isPlainObject(value) || !isApprovedBinding(value)) {
                add('unknown_binding', `Binding "${key}" must use an approved provider/resource/field`, nodeId, `${path}.bindings.${key}`);
            }
        }
        if (node.bindings !== undefined && !isPlainObject(node.bindings)) {
            add('invalid_binding', 'Bindings must be an object', nodeId, `${path}.bindings`);
        }
        if (Array.isArray(node.conditions)) {
            node.conditions.forEach((condition, index) => {
                if (!isPlainObject(condition) || !CONDITION_SOURCES.has(String(condition.source))) {
                    add('invalid_condition', 'Condition source is not supported', nodeId, `${path}.conditions[${index}]`);
                    return;
                }
                if (!CONDITIONS.has(String(condition.operator))) {
                    add('invalid_condition', 'Condition operator is not supported', nodeId, `${path}.conditions[${index}]`);
                }
                if (condition.provider !== undefined && !isApprovedBinding({ provider: condition.provider, resource: condition.resource, field: condition.field })) {
                    add('unknown_binding', 'Condition references an unapproved provider', nodeId, `${path}.conditions[${index}]`);
                }
            });
        } else if (node.conditions !== undefined) {
            add('invalid_condition', 'Conditions must be an array', nodeId, `${path}.conditions`);
        }
        if (Array.isArray(node.interactions)) {
            node.interactions.forEach((interaction, index) => {
                const interactionPath = `${path}.interactions[${index}]`;
                if (!isPlainObject(interaction) || !INTERACTION_TRIGGERS.has(String(interaction.trigger))) {
                    add('invalid_interaction', 'Interaction trigger must be click or submit', nodeId, interactionPath);
                    return;
                }
                const action = interaction.action;
                if (!isPlainObject(action) || !INTERACTION_KINDS.has(String(action.kind))) {
                    add('invalid_interaction', 'Interaction action is not supported', nodeId, interactionPath);
                    return;
                }
                if (action.kind === 'navigate' && (typeof action.to !== 'string' || !isSafeUrl(action.to))) {
                    add('unsafe_url', 'Navigation target must be safe', nodeId, `${interactionPath}.action.to`);
                }
                if (action.kind === 'external' && (typeof action.href !== 'string' || !/^https?:\/\//i.test(action.href) || !isSafeUrl(action.href))) {
                    add('unsafe_url', 'External link must be an http(s) URL', nodeId, `${interactionPath}.action.href`);
                }
                if (action.kind === 'scroll-to') {
                    if (typeof action.nodeId !== 'string' || !action.nodeId) {
                        add('invalid_interaction', 'Scroll target must be a node id', nodeId, interactionPath);
                    } else {
                        scrollTargets.push({ nodeId, target: action.nodeId, path: `${interactionPath}.action.nodeId` });
                    }
                }
                if (action.kind === 'submit-action' && (typeof action.actionId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(action.actionId))) {
                    add('invalid_interaction', 'Approved action id is required', nodeId, interactionPath);
                }
                if (action.kind === 'set-state' && (typeof action.key !== 'string' || action.key.length > 80 || action.value === undefined || !isJson(action.value))) {
                    add('invalid_interaction', 'set-state requires a bounded key and JSON value', nodeId, interactionPath);
                }
            });
        } else if (node.interactions !== undefined) {
            add('invalid_interaction', 'Interactions must be an array', nodeId, `${path}.interactions`);
        }
        if (node.layout !== undefined) {
            if (!isPlainObject(node.layout)) {
                add('invalid_layout', 'layout must be an object', nodeId, `${path}.layout`);
            } else if (node.layout.mode !== undefined && !LAYOUT_MODES.has(String(node.layout.mode))) {
                add('invalid_layout', 'layout.mode is not supported', nodeId, `${path}.layout.mode`);
            } else {
                if (node.layout.alignItems !== undefined && !ALIGNMENTS.has(String(node.layout.alignItems))) {
                    add('invalid_layout', 'layout.alignItems is not supported', nodeId, `${path}.layout.alignItems`);
                }
                if (node.layout.justify !== undefined && !ALIGNMENTS.has(String(node.layout.justify))) {
                    add('invalid_layout', 'layout.justify is not supported', nodeId, `${path}.layout.justify`);
                }
                if (node.layout.overflow !== undefined && !OVERFLOWS.has(String(node.layout.overflow))) {
                    add('invalid_layout', 'layout.overflow is not supported', nodeId, `${path}.layout.overflow`);
                }
                if (node.layout.position !== undefined && !POSITIONS.has(String(node.layout.position))) {
                    add('invalid_layout', 'layout.position is not supported', nodeId, `${path}.layout.position`);
                }
            }
        }
        if (node.style !== undefined && !isPlainObject(node.style)) {
            add('invalid_style', 'style must be an object', nodeId, `${path}.style`);
        }
        if (node.hidden !== undefined && typeof node.hidden !== 'boolean') {
            add('invalid_property', 'hidden must be a boolean', nodeId, `${path}.hidden`);
        }
        if (node.locked !== undefined && typeof node.locked !== 'boolean') {
            add('invalid_property', 'locked must be a boolean', nodeId, `${path}.locked`);
        }
        if (node.responsive !== undefined) {
            if (!isPlainObject(node.responsive)) {
                add('invalid_responsive', 'responsive must be an object', nodeId, `${path}.responsive`);
            } else {
                for (const breakpoint of Object.keys(node.responsive)) {
                    if (!BREAKPOINTS.has(breakpoint)) {
                        add('invalid_breakpoint', `Unsupported breakpoint "${breakpoint}"`, nodeId, `${path}.responsive.${breakpoint}`);
                    }
                }
            }
        }
        const slots = isPlainObject(node.slots) ? node.slots : {};
        if (node.slots !== undefined && !isPlainObject(node.slots)) {
            add('invalid_slot', 'slots must be an object', nodeId, `${path}.slots`);
        }
        for (const [slotName, children] of Object.entries(slots)) {
            const slotPath = `${path}.slots.${slotName}`;
            if (!/^[a-z][a-z0-9-]*$/.test(slotName)) {
                add('invalid_slot', 'Slot names must be lowercase kebab-case', nodeId, slotPath);
                continue;
            }
            if (!Array.isArray(children)) {
                add('invalid_slot', 'Slot children must be an array', nodeId, slotPath);
                continue;
            }
            if (children.length > MAX_SLOT_CHILDREN) {
                add('slot_too_large', `Slot exceeds ${MAX_SLOT_CHILDREN} children`, nodeId, slotPath);
            }
            for (let index = 0; index < children.length; index += 1) {
                const child = children[index];
                if (!isPlainObject(child)) {
                    add('invalid_node', 'Slot children must be node objects', nodeId, `${slotPath}[${index}]`);
                    continue;
                }
                // Push in reverse so traversal remains document-order for diagnostics.
                stack.push({ node: child, path: `${slotPath}[${index}]`, depth: depth + 1, root: false });
            }
        }
    }

    // Scroll targets must resolve inside this document.
    for (const reference of scrollTargets) {
        if (!nodeIds.has(reference.target)) {
            add('missing_scroll_target', `Scroll target "${reference.target}" does not exist`, reference.nodeId, reference.path);
        }
    }
    try {
        const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        if (size > MAX_BYTES) add('document_too_large', `Document is ${size} bytes; maximum is ${MAX_BYTES}`);
    } catch {
        add('unserializable_document', 'Document is not JSON-serializable');
    }

    return { ok: issues.length === 0, issues };
}

/** Compact human-readable message for API errors. */
export function describeCompositionIssues(result: CompositionValidationResult): string {
    return result.issues
        .slice(0, 8)
        .map((issue) => `${issue.code}${issue.path ? ` @ ${issue.path}` : ''}: ${issue.message}`)
        .join('; ');
}
