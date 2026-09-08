import { createHash, randomBytes } from 'node:crypto';

export interface CaptchaImageResult {
    readonly code: string;
    readonly png: Buffer;
}

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCaptchaCode(length = 6): string {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        const b = bytes[i] ?? 0;
        out += CHARSET[b % CHARSET.length] ?? 'A';
    }
    return out;
}

/**
 * Render a distorted captcha PNG. Uses `canvas` when available.
 * Throws if canvas cannot be loaded so the caller can surface a clear error.
 */
export async function renderCaptchaPng(code?: string): Promise<CaptchaImageResult> {
    const text = (code ?? randomCaptchaCode(6)).toUpperCase();

    let createCanvas: (w: number, h: number) => {
        getContext: (t: '2d') => CanvasRenderingContext2DLike;
        toBuffer: (mime: string) => Buffer;
    };

    try {
        const mod = await import('canvas');
        createCanvas = mod.createCanvas as typeof createCanvas;
    } catch (err: unknown) {
        throw new Error(
            `canvas module unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
    }

    const width = 280;
    const height = 100;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background noise
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = randomColor(40, 80);
        ctx.beginPath();
        ctx.moveTo(Math.random() * width, Math.random() * height);
        ctx.lineTo(Math.random() * width, Math.random() * height);
        ctx.stroke();
    }
    for (let i = 0; i < 120; i++) {
        ctx.fillStyle = randomColor(60, 120);
        ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2);
    }

    // Characters with jitter / rotation
    const step = width / (text.length + 1);
    for (let i = 0; i < text.length; i++) {
        const ch = text[i] ?? '';
        const x = step * (i + 1);
        const y = height / 2 + (Math.random() * 16 - 8);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((Math.random() - 0.5) * 0.55);
        ctx.font = `bold ${28 + Math.floor(Math.random() * 8)}px Sans`;
        ctx.fillStyle = randomColor(180, 255);
        ctx.fillText(ch, -10, 10);
        // partial cover bar
        if (Math.random() > 0.45) {
            ctx.fillStyle = `rgba(26,26,46,${0.35 + Math.random() * 0.25})`;
            ctx.fillRect(-12, -6, 22, 8);
        }
        ctx.restore();
    }

    // Foreground scribble
    for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = randomColor(100, 180);
        ctx.lineWidth = 1 + Math.random() * 2;
        ctx.beginPath();
        ctx.moveTo(0, Math.random() * height);
        ctx.bezierCurveTo(
            width * 0.3,
            Math.random() * height,
            width * 0.6,
            Math.random() * height,
            width,
            Math.random() * height,
        );
        ctx.stroke();
    }

    const png = canvas.toBuffer('image/png');
    return { code: text, png };
}

interface CanvasRenderingContext2DLike {
    fillStyle: string;
    strokeStyle: string;
    font: string;
    lineWidth: number;
    fillRect(x: number, y: number, w: number, h: number): void;
    stroke(): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    fillText(text: string, x: number, y: number): void;
    save(): void;
    restore(): void;
    translate(x: number, y: number): void;
    rotate(angle: number): void;
}

function randomColor(min: number, max: number): string {
    const r = min + Math.floor(Math.random() * (max - min));
    const g = min + Math.floor(Math.random() * (max - min));
    const b = min + Math.floor(Math.random() * (max - min));
    return `rgb(${r},${g},${b})`;
}

export function hashChallengeCode(code: string): string {
    return createHash('sha256').update(code.toUpperCase()).digest('hex').slice(0, 24);
}
