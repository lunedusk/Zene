import { getLogger } from '#core/utils/logger.js';
import { SemVer } from '#core/utils/semver.js';
import type { TagInfo } from './types.js';

const log = getLogger('Updater:GitHub');

export class GitHubClient {
    private readonly token: string | null;
    private readonly timeoutMs: number;
    private readonly tagCache = new Map<string, TagInfo[]>();

    constructor(token: string | null, timeoutMs = 30_000) {
        this.token = token;
        this.timeoutMs = Math.max(5_000, Math.min(timeoutMs, 60_000));
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'Zene-Updater'
        };
        if (this.token) h.Authorization = `Bearer ${this.token}`;
        return h;
    }

    private async request<T>(url: string): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const started = Date.now();

        try {
            log.debug(`GET ${url}`);
            const res = await fetch(url, { headers: this.headers(), signal: controller.signal });

            if (res.status === 404) throw new Error(`GitHub resource not found: ${url}`);
            if (res.status === 401 || res.status === 403) {
                const body = await res.text().catch(() => '');
                throw new Error(
                    `GitHub auth/rate-limit error (${res.status}). ` +
                        `Provide GithubPat if the repository is private or rate-limited. Body: ${body.slice(0, 200)}`
                );
            }
            if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text().catch(() => '')}`);

            const data = (await res.json()) as T;
            log.debug(`OK ${url} (${Date.now() - started}ms)`);
            return data;
        } catch (e: any) {
            if (e?.name === 'AbortError') {
                throw new Error(`GitHub request timed out after ${this.timeoutMs}ms: ${url}`, { cause: e });
            }
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }

    static parseRepo(input: string): { owner: string; repo: string } {
        const cleaned = input.trim().replace(/\.git$/, '');
        const urlMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)/i);
        if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2] };
        const short = cleaned.match(/^([^/]+)\/([^/]+)$/);
        if (short) return { owner: short[1], repo: short[2] };
        throw new Error(`Invalid repository identifier: "${input}". Expected owner/repo or GitHub URL.`);
    }

    async listTags(owner: string, repo: string): Promise<TagInfo[]> {
        const key = `${owner}/${repo}`.toLowerCase();
        const cached = this.tagCache.get(key);
        if (cached) {
            log.debug(`listTags cache hit ${key} (${cached.length})`);
            return cached;
        }

        const all: TagInfo[] = [];
        let page = 1;
        const maxPages = 50;

        while (page <= maxPages) {
            const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100&page=${page}`;
            log.info(`Fetching tags ${owner}/${repo} page ${page}…`);
            const raw = await this.request<Array<{ name: string; commit: { sha: string } }>>(url);
            if (!Array.isArray(raw) || raw.length === 0) break;

            for (const t of raw) {
                let semver: SemVer | null = null;
                try {
                    semver = SemVer.parse(t.name);
                } catch {
                }
                all.push({ name: t.name, commit: t.commit.sha, semver });
            }
            log.info(`  page ${page}: +${raw.length} (total ${all.length})`);
            if (raw.length < 100) break;
            page++;
        }

        this.tagCache.set(key, all);
        log.info(`listTags ${owner}/${repo}: ${all.length} tag(s)`);
        return all;
    }

    clearTagCache(): void {
        this.tagCache.clear();
    }

    async getTagByName(owner: string, repo: string, tagName: string): Promise<TagInfo | null> {
        const tags = await this.listTags(owner, repo);
        const found = tags.find(
            t =>
                t.name === tagName ||
                t.name === tagName.replace(/^v/i, '') ||
                `v${t.name}` === tagName
        );
        if (found) return found;
        try {
            const want = SemVer.parse(tagName);
            return tags.find(t => t.semver && t.semver.isEqual(want)) ?? null;
        } catch {
            return null;
        }
    }

    async listPluginTags(owner: string, repo: string, pluginName: string): Promise<TagInfo[]> {
        const prefix = `plugin-${pluginName}-v`;
        const all = await this.listTags(owner, repo);
        const matched = all.filter(
            t =>
                t.name.startsWith(prefix) ||
                t.name.toLowerCase().startsWith(`plugin-${pluginName.toLowerCase()}-v`)
        );

        return matched
            .map(t => {
                let semver: SemVer | null = null;
                try {
                    const suffix = t.name.replace(new RegExp(`^plugin-${pluginName}-v`, 'i'), '');
                    semver = SemVer.parse(suffix.startsWith('v') ? suffix : `v${suffix}`);
                } catch {

                }
                return { ...t, semver };
            })
            .sort((a, b) => {
                if (a.semver && b.semver) return b.semver.compare(a.semver);
                if (a.semver) return -1;
                if (b.semver) return 1;
                return b.name.localeCompare(a.name);
            });
    }

    async listTagsForPluginScheme(
        kind: 'in-repo' | 'external',
        owner: string,
        repo: string,
        pluginName: string,
    ): Promise<TagInfo[]> {
        if (kind === 'external') {
            return this.listSemverTags(owner, repo);
        }
        return this.listPluginTags(owner, repo, pluginName);
    }

    async listSemverTags(owner: string, repo: string): Promise<TagInfo[]> {
        return (await this.listTags(owner, repo))
            .filter(t => t.semver !== null)
            .sort((a, b) => b.semver!.compare(a.semver!));
    }

    async getLatestAllowedTag(
        owner: string,
        repo: string,
        current: SemVer | null,
        devBuilds: boolean,
        excludeTags?: Set<string>
    ): Promise<TagInfo | null> {
        const tags = (await this.listTags(owner, repo))
            .filter(t => t.semver !== null)
            .filter(t => !excludeTags || !excludeTags.has(t.name))
            .sort((a, b) => b.semver!.compare(a.semver!));

        for (const tag of tags) {
            if (!current) return tag;
            if (tag.semver!.isLessThanOrEqual(current)) continue;

            if (tag.semver!.major > current.major || tag.semver!.minor > current.minor) {
                return tag;
            }
            if (devBuilds && tag.semver!.patch > current.patch) {
                return tag;
            }
        }
        return null;
    }

    async findNearestTag(owner: string, repo: string, reference: SemVer | null): Promise<TagInfo | null> {
        const tags = (await this.listTags(owner, repo))
            .filter(t => t.semver !== null)
            .sort((a, b) => b.semver!.compare(a.semver!));

        if (tags.length === 0) return null;
        if (!reference) return tags[0];

        const exact = tags.find(t => t.semver!.isEqual(reference));
        if (exact) return exact;

        let bestBelow: TagInfo | null = null;
        let bestAbove: TagInfo | null = null;

        for (const t of tags) {
            if (t.semver!.isLessThanOrEqual(reference)) {
                if (!bestBelow || t.semver!.isGreaterThan(bestBelow.semver!)) bestBelow = t;
            } else {
                if (!bestAbove || t.semver!.isLessThan(bestAbove.semver!)) bestAbove = t;
            }
        }

        return bestBelow ?? bestAbove ?? tags[0];
    }

    async getFileText(owner: string, repo: string, ref: string, filePath: string): Promise<string | null> {
        const url =
            `https://api.github.com/repos/${owner}/${repo}/contents/` +
            `${filePath
                .split('/')
                .map(encodeURIComponent)
                .join('/')}?ref=${encodeURIComponent(ref)}`;
        try {
            const data = await this.request<{ content?: string; encoding?: string; type?: string }>(url);
            if (data.type !== 'file' || !data.content) return null;
            const b64 = data.content.replace(/\n/g, '');
            return Buffer.from(b64, 'base64').toString('utf-8');
        } catch (e: any) {
            const msg = String(e.message || e);
            if (msg.includes('404') || msg.includes('not found')) return null;
            throw e;
        }
    }

    async downloadArchive(owner: string, repo: string, ref: string): Promise<Buffer> {
        const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${encodeURIComponent(ref)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 120_000));
        try {
            log.info(`Downloading archive ${owner}/${repo}@${ref}…`);
            const res = await fetch(url, {
                headers: this.headers(),
                signal: controller.signal,
                redirect: 'follow'
            });
            if (!res.ok) throw new Error(`Archive download failed ${res.status}`);
            const ab = await res.arrayBuffer();
            log.info(`Archive ${ref}: ${(ab.byteLength / 1024).toFixed(1)} KiB`);
            return Buffer.from(ab);
        } catch (e: any) {
            if (e?.name === 'AbortError') throw new Error(`Archive download timed out: ${ref}`, { cause: e });
            throw e;
        } finally {
            clearTimeout(timer);
        }
    }
}
