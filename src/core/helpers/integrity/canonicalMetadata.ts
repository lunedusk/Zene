/**
 * Phase 1B — Canonical signed plugin metadata.
 *
 * Single authority boundary for fields that participate in .nvx authentication.
 * Runtime-only fields (emoji, icon) are intentionally absent.
 *
 * Serialization remains FlatBuffer + existing NCPLUG signature; this module
 * normalizes and projects metadata so pack / unpack / signedMetadata / bypass
 * share one interpretation.
 */

import type { PluginManifest } from '#core/bases/Plugin.js';
import { IntegrityError } from './errors.js';

/** How the metadata was obtained. */
export type MetadataAuthority =
    /** New Phase 1A+ artifact: priority field present in signed table. */
    | 'signed'
    /** Signature verified, but priority field absent (pre–Phase 1A .nvx). */
    | 'legacy-signed'
    /** Operator-controlled unsigned manifest.json path. */
    | 'bypass-unsigned';

/**
 * Canonical representation of plugin fields that the integrity boundary cares about.
 * Arrays/maps are already normalized for deterministic comparison.
 */
export interface CanonicalPluginMetadata {
    readonly authority: MetadataAuthority;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly author?: string;
    /** Sorted unique dependency plugin ids. */
    readonly dependencies: readonly string[];
    /** Single string form used in FlatBuffer (array ranges joined with space when packing). */
    readonly zene_version?: string;
    readonly node_version?: string;
    /** Sorted-key map of npm package → version range. */
    readonly nodeDependencies: Readonly<Record<string, string>>;
    /**
     * Boot priority. Present when authenticated (signed) or supplied on bypass.
     * Absent on legacy-signed (field never in signed table).
     */
    readonly priority?: number;
    /** True only when the signed FlatBuffer carried an explicit priority field. */
    readonly priorityAuthenticated: boolean;
    /** Sorted, normalized relative paths excluded from hashing. */
    readonly ignoreHash: readonly string[];
}

/** Stable JSON-like view for tests (deterministic key order). */
export function toDeterministicView(meta: CanonicalPluginMetadata): Record<string, unknown> {
    return {
        authority: meta.authority,
        id: meta.id,
        name: meta.name,
        version: meta.version,
        description: meta.description ?? null,
        author: meta.author ?? null,
        dependencies: [...meta.dependencies],
        zene_version: meta.zene_version ?? null,
        node_version: meta.node_version ?? null,
        nodeDependencies: { ...meta.nodeDependencies },
        priority: meta.priority === undefined ? null : meta.priority,
        priorityAuthenticated: meta.priorityAuthenticated,
        ignoreHash: [...meta.ignoreHash],
    };
}

export function normalizeIgnoreHash(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const cleaned = raw
        .filter((p): p is string => typeof p === 'string')
        .map((p) => p.replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter((p) => p.length > 0 && !p.includes('..'));
    return [...new Set(cleaned)].sort();
}

export function normalizeDependencies(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const ids = raw
        .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
        .map((d) => d.trim());
    return [...new Set(ids)].sort();
}

export function normalizeNodeDependencies(raw: unknown): Record<string, string> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
            out[k.trim()] = v.trim();
        }
    }
    const sorted: Record<string, string> = {};
    for (const key of Object.keys(out).sort()) {
        sorted[key] = out[key]!;
    }
    return sorted;
}

/**
 * Validate integer priority at the metadata boundary.
 * Omitted → undefined (caller may default to 0 when packing new artifacts).
 */
export function normalizePriority(raw: unknown, context: string): number | undefined {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
        throw new IntegrityError(
            `Invalid priority for ${context}: must be a finite integer (received ${String(raw)}).`,
        );
    }
    return raw;
}

export function normalizeZeneVersion(raw: unknown): string | undefined {
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (Array.isArray(raw)) {
        const parts = raw.map(String).map((s) => s.trim()).filter(Boolean);
        return parts.length > 0 ? parts.join(' ') : undefined;
    }
    return undefined;
}

export interface BuildCanonicalInput {
    readonly authority: MetadataAuthority;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly author?: string;
    readonly dependencies?: unknown;
    readonly zene_version?: unknown;
    readonly node_version?: unknown;
    readonly nodeDependencies?: unknown;
    readonly priority?: unknown;
    readonly priorityAuthenticated: boolean;
    readonly ignoreHash?: unknown;
}

export function buildCanonical(input: BuildCanonicalInput): CanonicalPluginMetadata {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const version = typeof input.version === 'string' ? input.version.trim() : '';
    if (!id || !name || !version) {
        throw new IntegrityError(
            `Canonical metadata requires non-empty id, name, and version (got id=${JSON.stringify(id)}).`,
        );
    }

    const priority = normalizePriority(input.priority, `plugin [${id}]`);

    if (input.authority === 'signed' && !input.priorityAuthenticated) {
        throw new IntegrityError(
            `Internal error: authority "signed" requires priorityAuthenticated for plugin [${id}].`,
        );
    }
    if (input.authority === 'legacy-signed' && input.priorityAuthenticated) {
        throw new IntegrityError(
            `Internal error: authority "legacy-signed" cannot claim priorityAuthenticated for plugin [${id}].`,
        );
    }

    const node_version =
        typeof input.node_version === 'string' && input.node_version.trim()
            ? input.node_version.trim()
            : undefined;

    const description =
        typeof input.description === 'string' && input.description.length > 0
            ? input.description
            : undefined;
    const author =
        typeof input.author === 'string' && input.author.length > 0 ? input.author : undefined;

    return {
        authority: input.authority,
        id,
        name,
        version,
        description,
        author,
        dependencies: normalizeDependencies(input.dependencies),
        zene_version: normalizeZeneVersion(input.zene_version),
        node_version,
        nodeDependencies: normalizeNodeDependencies(input.nodeDependencies),
        priority:
            input.authority === 'legacy-signed'
                ? undefined
                : priority === undefined && input.authority === 'signed'
                  ? 0
                  : priority,
        priorityAuthenticated: input.priorityAuthenticated,
        ignoreHash: normalizeIgnoreHash(input.ignoreHash),
    };
}

/**
 * Build canonical metadata from a PluginManifest-like object for packing (new signed artifact).
 * Omitted priority becomes authenticated 0.
 */
export function canonicalForPack(manifest: PluginManifest): CanonicalPluginMetadata {
    return buildCanonical({
        authority: 'signed',
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        dependencies: manifest.dependencies,
        zene_version: manifest.zene_version,
        node_version: manifest.node_version,
        nodeDependencies: manifest.nodeDependencies,
        priority: manifest.priority,
        priorityAuthenticated: true,
        ignoreHash: manifest.ignoreHash,
    });
}

/**
 * Project canonical metadata to the runtime PluginManifest shape used by discovery/boot.
 * Does not attach emoji/icon (runtime-only / unsigned).
 */
export function toPluginManifest(meta: CanonicalPluginMetadata): PluginManifest {
    const out: PluginManifest = {
        id: meta.id,
        name: meta.name,
        version: meta.version,
        description: meta.description,
        author: meta.author,
        dependencies: meta.dependencies.length > 0 ? [...meta.dependencies] : undefined,
        zene_version: meta.zene_version,
        node_version: meta.node_version,
        nodeDependencies:
            Object.keys(meta.nodeDependencies).length > 0 ? { ...meta.nodeDependencies } : undefined,
        priority: meta.priority,
        ignoreHash: meta.ignoreHash.length > 0 ? [...meta.ignoreHash] : undefined,
    };
    return out;
}

/**
 * Decode fields already extracted from a verified FlatBuffer root into canonical form.
 * Call only after signature verification has succeeded.
 */
export function canonicalFromVerifiedFlatFields(fields: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly author?: string;
    readonly dependencies: readonly string[];
    readonly zene_version?: string;
    readonly node_version?: string;
    readonly nodeDependencies: Readonly<Record<string, string>>;
    readonly priorityAuthenticated: boolean;
    readonly priority?: number;
    readonly ignoreHash: readonly string[];
}): CanonicalPluginMetadata {
    return buildCanonical({
        authority: fields.priorityAuthenticated ? 'signed' : 'legacy-signed',
        id: fields.id,
        name: fields.name,
        version: fields.version,
        description: fields.description,
        author: fields.author,
        dependencies: fields.dependencies,
        zene_version: fields.zene_version,
        node_version: fields.node_version,
        nodeDependencies: fields.nodeDependencies,
        priority: fields.priorityAuthenticated ? fields.priority : undefined,
        priorityAuthenticated: fields.priorityAuthenticated,
        ignoreHash: fields.ignoreHash,
    });
}

/**
 * Bypass / unsigned JSON → canonical with authority bypass-unsigned.
 */
export function canonicalFromBypassJson(raw: Record<string, unknown>): CanonicalPluginMetadata {
    const nodeDepsRaw = raw.node_dependencies ?? raw.nodeDependencies;
    return buildCanonical({
        authority: 'bypass-unsigned',
        id: typeof raw.id === 'string' ? raw.id : '',
        name: typeof raw.name === 'string' ? raw.name : '',
        version: typeof raw.version === 'string' ? raw.version : '',
        description: typeof raw.description === 'string' ? raw.description : undefined,
        author: typeof raw.author === 'string' ? raw.author : undefined,
        dependencies: raw.dependencies,
        zene_version: raw.zene_version,
        node_version: raw.node_version,
        nodeDependencies: nodeDepsRaw,
        priority: raw.priority,
        priorityAuthenticated: false,
        ignoreHash: raw.ignoreHash ?? raw.ignore_hash,
    });
}
