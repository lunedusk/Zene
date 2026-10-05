declare module 'blake3' {
    export function hash(data: Uint8Array | string): Uint8Array | Buffer | string;
}

declare module 'canvas' {
    export function createCanvas(
        width: number,
        height: number,
    ): {
        getContext(type: '2d'): unknown;
        toBuffer(mime: string): Buffer;
    };
}
