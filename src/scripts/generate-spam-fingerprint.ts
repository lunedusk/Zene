/**
 * Generate known-spam fingerprint entries and merge into the security plugin data file.
 *
 * Usage:
 *   npx tsx src/scripts/generate-spam-fingerprint.ts --image ./spam.png --label "scam-banner"
 *   npx tsx src/scripts/generate-spam-fingerprint.ts --text "buy now crypto" --label "promo"
 *   npx tsx src/scripts/generate-spam-fingerprint.ts --image ./a.png --out src/plugins/security/data/spam-signatures.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

type Kind = 'image' | 'text';

interface Entry {
    id: string;
    kind: Kind;
    label?: string;
    size?: number;
    width?: number;
    height?: number;
    header4?: string;
    header16?: string;
    footer4?: string;
    footer16?: string;
    first4?: string;
    first16?: string;
    last4?: string;
    last16?: string;
    blake3?: string;
    blake3Full?: string;
    text?: string;
}

interface FileShape {
    version: number;
    entries: Entry[];
}

function hexSlice(buf: Buffer, start: number, end: number): string {
    return buf.subarray(start, end).toString('hex');
}

async function blake3Hex(data: Buffer): Promise<string> {
    try {
        const mod = await import('blake3');
        const out = mod.hash(data) as Uint8Array | Buffer | string;
        if (typeof out === 'string') return out;
        return Buffer.from(out).toString('hex');
    } catch {
        // Fallback so the script still works without blake3 installed in tooling.
        return createHash('sha256').update(data).digest('hex');
    }
}

function parseArgs(argv: string[]): {
    image?: string;
    text?: string;
    label?: string;
    out: string;
} {
    let image: string | undefined;
    let text: string | undefined;
    let label: string | undefined;
    let out = path.resolve('src/plugins/security/data/spam-signatures.json');

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = argv[i + 1];
        if (a === '--image' && next) {
            image = next;
            i += 1;
        } else if (a === '--text' && next) {
            text = next;
            i += 1;
        } else if (a === '--label' && next) {
            label = next;
            i += 1;
        } else if (a === '--out' && next) {
            out = path.resolve(next);
            i += 1;
        }
    }
    return { image, text, label, out };
}

async function buildImageEntry(filePath: string, label?: string): Promise<Entry> {
    const buf = await fs.readFile(filePath);
    const size = buf.length;
    const hash = await blake3Hex(buf);
    const id = `img_${hash.slice(0, 16)}`;
    return {
        id,
        kind: 'image',
        label,
        size,
        header4: size >= 4 ? hexSlice(buf, 0, 4) : undefined,
        header16: size >= 16 ? hexSlice(buf, 0, 16) : undefined,
        footer4: size >= 4 ? hexSlice(buf, size - 4, size) : undefined,
        footer16: size >= 16 ? hexSlice(buf, size - 16, size) : undefined,
        first4: size >= 4 ? hexSlice(buf, 0, 4) : undefined,
        first16: size >= 16 ? hexSlice(buf, 0, 16) : undefined,
        last4: size >= 4 ? hexSlice(buf, size - 4, size) : undefined,
        last16: size >= 16 ? hexSlice(buf, size - 16, size) : undefined,
        blake3: hash,
        blake3Full: hash,
    };
}

async function buildTextEntry(text: string, label?: string): Promise<Entry> {
    const normalized = text.trim();
    const buf = Buffer.from(normalized, 'utf8');
    const size = buf.length;
    const hash = await blake3Hex(buf);
    const id = `txt_${hash.slice(0, 16)}`;
    return {
        id,
        kind: 'text',
        label,
        size,
        text: normalized,
        first4: size >= 4 ? hexSlice(buf, 0, 4) : undefined,
        first16: size >= 16 ? hexSlice(buf, 0, 16) : undefined,
        last4: size >= 4 ? hexSlice(buf, size - 4, size) : undefined,
        last16: size >= 16 ? hexSlice(buf, size - 16, size) : undefined,
        header4: size >= 4 ? hexSlice(buf, 0, 4) : undefined,
        footer4: size >= 4 ? hexSlice(buf, size - 4, size) : undefined,
        blake3: hash,
        blake3Full: hash,
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!args.image && !args.text) {
        console.error('Provide --image <path> and/or --text <string>');
        process.exit(1);
    }

    let file: FileShape = { version: 1, entries: [] };
    try {
        const raw = await fs.readFile(args.out, 'utf8');
        const parsed = JSON.parse(raw) as FileShape;
        if (parsed && Array.isArray(parsed.entries)) file = parsed;
    } catch {
        /* create new */
    }

    const next: Entry[] = [...file.entries];

    if (args.image) {
        const entry = await buildImageEntry(path.resolve(args.image), args.label);
        const idx = next.findIndex((e) => e.id === entry.id);
        if (idx >= 0) next[idx] = entry;
        else next.push(entry);
        console.log(`Image fingerprint ${entry.id} size=${entry.size}`);
    }
    if (args.text) {
        const entry = await buildTextEntry(args.text, args.label);
        const idx = next.findIndex((e) => e.id === entry.id);
        if (idx >= 0) next[idx] = entry;
        else next.push(entry);
        console.log(`Text fingerprint ${entry.id} size=${entry.size}`);
    }

    const out: FileShape = { version: file.version || 1, entries: next };
    await fs.mkdir(path.dirname(args.out), { recursive: true });
    await fs.writeFile(args.out, `${JSON.stringify(out, null, 4)}\n`, 'utf8');
    console.log(`Wrote ${args.out} (${next.length} entries)`);
}

main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
