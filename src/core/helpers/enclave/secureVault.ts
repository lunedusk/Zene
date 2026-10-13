import { createCipheriv, createDecipheriv, randomBytes, hkdf, CipherGCM, DecipherGCM } from 'node:crypto';
import { constants as zlibConstants } from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { VaultError, VaultFormatError, VaultIntegrityError, VaultConfigurationError } from './errors.js';
import { MAGIC_HEADER, FORMAT_VERSION, FLAG_COMPRESSED, MAX_SERIALIZER_NAME, DEFAULT_CHUNK_SIZE } from './constants.js';
import { scryptAsync, compressAsync, decompressAsync } from './utils.js';
import { Serializer, Serializers } from './serializers.js';

export interface VaultOptions {
    compress?: boolean;
    chunkSize?: number;
    extension?: string;
}

export class SecureVault {
    readonly #masterSecret: Buffer;
    readonly #mode: 'hkdf' | 'scrypt';
    readonly #options: Required<VaultOptions>;
    readonly #serializers = new Map<string, Serializer>();
    #isDestroyed = false;

    private constructor(masterSecret: Buffer, mode: 'hkdf' | 'scrypt', options?: VaultOptions) {
        this.#masterSecret = masterSecret;
        this.#mode = mode;
        this.#options = {
            compress: options?.compress ?? true,
            chunkSize: options?.chunkSize ?? DEFAULT_CHUNK_SIZE,
            extension: options?.extension ?? '.nc'
        };

        this.registerSerializer(Serializers.json);
        this.registerSerializer(Serializers.text);
        this.registerSerializer(Serializers.bytes);
    }

    public static fromKey(key: Buffer, options?: VaultOptions): SecureVault {
        if (key.length === 0) throw new VaultConfigurationError('Key cannot be empty');
        return new SecureVault(key, 'hkdf', options);
    }

    public static fromPassword(password: string, options?: VaultOptions): SecureVault {
        if (!password) throw new VaultConfigurationError('Password cannot be empty');
        return new SecureVault(Buffer.from(password, 'utf-8'), 'scrypt', options);
    }

    public destroy(): void {
        if (this.#isDestroyed) return;
        this.#masterSecret.fill(0);
        this.#isDestroyed = true;
    }

    private ensureNotDestroyed(): void {
        if (this.#isDestroyed) throw new VaultError('Attempted to use a destroyed Vault instance.');
    }

    public registerSerializer(serializer: Serializer): void {
        if (Buffer.byteLength(serializer.name) > MAX_SERIALIZER_NAME) {
            throw new VaultConfigurationError(`Serializer name exceeds ${MAX_SERIALIZER_NAME} bytes`);
        }
        this.#serializers.set(serializer.name, serializer);
    }

    async #deriveKey(salt: Buffer): Promise<Buffer> {
        this.ensureNotDestroyed();
        if (this.#mode === 'hkdf') {
            return new Promise((resolve, reject) => {
                hkdf('sha256', this.#masterSecret, salt, 'Enclave/ChaCha20Poly1305/v4', 32, (err, key) => {
                    if (err) reject(err);
                    else resolve(Buffer.from(key));
                });
            });
        } else {
            return await scryptAsync(this.#masterSecret, salt, 32, { N: 2 ** 14, r: 8, p: 1 });
        }
    }

    #getNonce(chunkIdx: number): Buffer {
        const nonce = Buffer.allocUnsafe(12);
        nonce.writeBigUInt64BE(BigInt(chunkIdx), 0);
        nonce.writeUInt32BE(0, 8);
        return nonce;
    }

    public async pack<T>(obj: T, serializerName = 'json', compress?: boolean): Promise<Buffer> {
        this.ensureNotDestroyed();
        const serializer = this.#serializers.get(serializerName);
        if (!serializer) throw new VaultError(`Unknown serializer: ${serializerName}`);

        const shouldCompress = compress ?? this.#options.compress;
        const rawPayload = serializer.encode(obj);

        const salt = randomBytes(16);
        const flags = shouldCompress ? FLAG_COMPRESSED : 0;
        const serNameBuf = Buffer.from(serializer.name, 'utf-8');

        const header = Buffer.concat([
            MAGIC_HEADER,
            Buffer.from([FORMAT_VERSION]),
            salt,
            Buffer.from([flags, serNameBuf.length]),
            serNameBuf
        ]);

        const key = await this.#deriveKey(salt);
        const outChunks: Buffer[] = [header];

        const aad = Buffer.allocUnsafe(header.length + 4);
        header.copy(aad, 0);

        let chunkIdx = 0;
        for (let i = 0; i < rawPayload.length; i += this.#options.chunkSize) {
            let chunk = rawPayload.subarray(i, i + this.#options.chunkSize);
            
            if (shouldCompress) {
                chunk = await compressAsync(chunk, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
            }

            const nonce = this.#getNonce(chunkIdx);
            aad.writeUInt32BE(chunkIdx, header.length); 

            const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }) as CipherGCM;
            
            cipher.setAAD(aad as any);

            const ciphertext = Buffer.concat([cipher.update(chunk), cipher.final(), cipher.getAuthTag()]);

            const sizeBuf = Buffer.allocUnsafe(4);
            sizeBuf.writeUInt32BE(ciphertext.length, 0);

            outChunks.push(sizeBuf, nonce, ciphertext);
            chunkIdx++;
        }

        if (serializer.isVolatile) {
            rawPayload.fill(0);
        }
        key.fill(0);
        
        return Buffer.concat(outChunks);
    }

    public async unpack<T = any>(blob: Buffer): Promise<T> {
        this.ensureNotDestroyed();
        if (blob.length < MAGIC_HEADER.length + 18) throw new VaultFormatError('Blob too short');
        
        let offset = 0;
        const magic = blob.subarray(offset, offset += MAGIC_HEADER.length);
        if (!magic.equals(MAGIC_HEADER)) throw new VaultFormatError('Invalid Magic Header');

        const version = blob.readUInt8(offset++);
        if (version !== FORMAT_VERSION) throw new VaultFormatError('Unsupported Format Version');

        const salt = blob.subarray(offset, offset += 16);
        const flags = blob.readUInt8(offset++);
        const isCompressed = (flags & FLAG_COMPRESSED) !== 0;

        const serLen = blob.readUInt8(offset++);
        const serName = blob.subarray(offset, offset += serLen).toString('utf-8');
        
        const headerBytes = blob.subarray(0, offset);
        const key = await this.#deriveKey(salt);
        const serializer = this.#serializers.get(serName);

        if (!serializer) throw new VaultError(`Unknown embedded serializer: ${serName}`);

        const decryptedChunks: Buffer[] = [];
        const aad = Buffer.allocUnsafe(headerBytes.length + 4);
        headerBytes.copy(aad, 0);

        let chunkIdx = 0;

        while (offset < blob.length) {
            if (offset + 4 > blob.length) throw new VaultFormatError('Truncated chunk size');
            const encSize = blob.readUInt32BE(offset);
            offset += 4;

            if (offset + 12 > blob.length) throw new VaultFormatError('Truncated nonce');
            const nonce = blob.subarray(offset, offset += 12);
            
            if (!nonce.equals(this.#getNonce(chunkIdx))) {
                throw new VaultIntegrityError(`Unexpected nonce at chunk ${chunkIdx}. File tampered.`);
            }

            if (offset + encSize > blob.length) throw new VaultFormatError('Truncated ciphertext');
            const encryptedChunk = blob.subarray(offset, offset += encSize);

            const ciphertext = encryptedChunk.subarray(0, -16);
            const authTag = encryptedChunk.subarray(-16);

            aad.writeUInt32BE(chunkIdx, headerBytes.length);

            try {
                const decipher = createDecipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 }) as DecipherGCM;
                
                decipher.setAAD(aad as any);
                decipher.setAuthTag(authTag);
                
                let plainChunk: any = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
                
                if (isCompressed) {
                    plainChunk = await decompressAsync(plainChunk);
                }
                
                decryptedChunks.push(plainChunk);
            } catch (_err) {
                throw new VaultIntegrityError(`AEAD Authentication failed for chunk ${chunkIdx}.`);
            }
            chunkIdx++;
        }

        const fullRaw = Buffer.concat(decryptedChunks);
        const result = serializer.decode(fullRaw);

        decryptedChunks.forEach(c => c.fill(0));
        key.fill(0);

        if (!serializer.retainsBufferReference) {
            fullRaw.fill(0);
        }

        return result as T;
    }

    public async packToFile(filepath: string, obj: any, serializerName = 'json'): Promise<void> {
        const payload = await this.pack(obj, serializerName);
        const dir = path.dirname(filepath);
        await fs.mkdir(dir, { recursive: true });
        
        const tempPath = `${filepath}.tmp`;
        await fs.writeFile(tempPath, payload);
        await fs.rename(tempPath, filepath);
    }

    public async unpackFromFile<T = any>(filepath: string): Promise<T> {
        const blob = await fs.readFile(filepath);
        return await this.unpack<T>(blob);
    }
}