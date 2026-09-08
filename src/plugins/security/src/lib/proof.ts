import type { Attachment } from 'discord.js';

export interface ProofMeta {
    readonly proofUrl: string;
    readonly proofName: string;
    readonly proofContentType: string | null;
    readonly proofSize: number;
}

export function extractProof(attachment: Attachment | null | undefined): ProofMeta | null {
    if (!attachment) return null;
    const url = attachment.url;
    if (!url || typeof url !== 'string') return null;
    return {
        proofUrl: url,
        proofName: attachment.name || 'proof',
        proofContentType: attachment.contentType ?? null,
        proofSize: attachment.size,
    };
}

export function proofMetadata(
    proof: ProofMeta | null | undefined,
): Record<string, unknown> | undefined {
    if (!proof) return undefined;
    return {
        proofUrl: proof.proofUrl,
        proofName: proof.proofName,
        proofContentType: proof.proofContentType,
        proofSize: proof.proofSize,
    };
}

export function formatProofLine(proof: ProofMeta | null | undefined): string | null {
    if (!proof) return null;
    return `[${proof.proofName}](${proof.proofUrl})`;
}
