import { randomBytes } from "crypto";
import {
  b64Encode,
  b64Decode,
  hmacSign as sign,
  packVersion,
  safeEqual,
  signingKey as deriveSigningKey,
  deriveMasterKey,
  assembleToken,
  splitToken,
} from "#core/manager/tokenCrypto.js";
import type { Request, Response, NextFunction } from 'express';
import { NovaError } from '#core/errors/NovaError.js';

export type Bit = string;

export const BitSets = {
  SERVER_READONLY: ["server.config.view", "server.members.view"] as Bit[],
  SERVER_MANAGER: [
    "server.config.view",
    "server.config.manage",
    "server.members.view",
    "server.members.kick",
    "server.members.ban",
    "server.members.mute",
    "server.members.history",
    "server.members.notes",
    "server.members.nick",
    "server.members.role",
    "server.roles.manage",
    "server.lang.manage",
    "server.logs.view",
    "server.analytics.view",
  ] as Bit[],
  BOT_READONLY: ["bot.servers.view", "bot.plugins.view", "bot.logs.view"] as Bit[],
  BOT_ADMIN: [
    "bot.servers.view",
    "bot.servers.manage",
    "bot.servers.ban",
    "bot.members.view",
    "bot.members.kick",
    "bot.members.ban",
    "bot.members.mute",
    "bot.members.ban_global",
    "bot.members.nick",
    "bot.members.role",
    "bot.plugins.view",
    "bot.plugins.manage",
    "bot.plugins.reload",
    "bot.roles.manage",
    "bot.theme.manage",
    "bot.dash.pages.manage",
    "bot.logs.view",
    "bot.audit.view",
    "bot.audit.export",
    "bot.errors.view",
    "bot.errors.export",
    "bot.analytics.view",
    "bot.fleet.view",
    "bot.fleet.restart",
    "bot.shard.view",
    "bot.shard.shift",
    "bot.worker.restart",
    "bot.crosshost.view",
    "bot.crosshost.manage",
    "bot.cache.manage",
    "bot.config.reload",
    "bot.lang.reload",
  ] as Bit[],
  BOT_FLEET_OPS: [
    "bot.fleet.view",
    "bot.fleet.restart",
    "bot.shard.view",
    "bot.shard.shift",
    "bot.worker.restart",
    "bot.crosshost.view",
    "bot.crosshost.manage",
  ] as Bit[],
  SERVER_MODERATION: [
    "server.members.view",
    "server.members.kick",
    "server.members.ban",
    "server.members.mute",
    "server.members.nick",
    "server.members.role",
    "server.members.history",
    "server.members.notes",
  ] as Bit[],
} as const;

export interface TokenPayload {
  userId: string;
  iat: number;
  exp: number;
  jti: string;
  deviceId: string;
  deviceLabel?: string;
  bits: Bit[];
  guildId?: string;
  tokenVersion: string;
  iss: string;
  aud: string;
}

export interface VerifiedToken {
  payload: TokenPayload;
  raw: string;
}

export interface TokenIssueOptions {
  bits?: Bit[];
  guildId?: string;
  deviceId?: string;
  deviceLabel?: string;
  ttlSeconds?: number;
  useDeviceVersion?: boolean;
}

export interface TokenRefreshOptions {
  getBits?: (userId: string, guildId?: string) => Promise<Bit[]>;
}

export type AuditEventType =
  | "token.issued"
  | "token.verified"
  | "token.refreshed"
  | "token.revoked_device"
  | "token.revoked_all"
  | "token.verify_failed"
  | "token.expired"
  | "token.rotation_attack";

export interface AuditEvent {
  type: AuditEventType;
  userId?: string;
  deviceId?: string;
  guildId?: string;
  jti?: string;
  reason?: string;
  timestamp: number;
}

export type AuditHandler = (event: AuditEvent) => void | Promise<void>;

export interface TokenManagerOptions {
  ttlSeconds?: number;
  maxTtlSeconds?: number;
  issuer?: string;
  audience?: string;
  bitAllowlist?: ReadonlySet<Bit>;
  onAudit?: AuditHandler;
  onVerifyFailure?: (error: TokenError) => void | Promise<void>;
}

export interface DeviceTokenMeta {
  _id: string;
  userId: string;
  deviceId: string;
  guildId?: string;
  tokenVersion: number;
  deviceLabel?: string;
  issuedAt: number;
  lastSeenAt: number;
  lastJti?: string;
}

export interface TokenStore {
  getGlobalVersion(userId: string): Promise<number>;
  incrementGlobalVersion(userId: string): Promise<number>;
  getDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number>;
  incrementDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number>;
  upsertDevice(
    userId: string,
    deviceId: string,
    meta: Partial<Omit<DeviceTokenMeta, "_id" | "userId" | "deviceId" | "guildId">>,
    guildId?: string
  ): Promise<void>;
  listDevices(userId: string): Promise<DeviceTokenMeta[]>;
  deleteDevice(userId: string, deviceId: string, guildId?: string): Promise<void>;
  getLastJti(userId: string, deviceId: string, guildId?: string): Promise<string | undefined>;
}

export class DbTokenStore implements TokenStore {
  private db!: import('#core/database/sqlAdapter.js').SqlAdapter;
  private ready = false;

  constructor(private readonly choice?: { engine?: string | null; alias?: string | null }) {}

  async init(): Promise<void> {
    if (this.ready) return;
    const { resolveTokenBackend } = await import('#core/database/backendSelector.js');
    const { openSqlAdapter } = await import('#core/database/sqlAdapter.js');
    this.db = openSqlAdapter(resolveTokenBackend(this.choice));
    this.ready = true;
  }

  private async ensure(): Promise<void> {
    if (!this.ready) await this.init();
  }

  private deviceKey(userId: string, deviceId: string, guildId?: string): string {
    return guildId
      ? `device:${guildId}:${userId}:${deviceId}`
      : `device:${userId}:${deviceId}`;
  }

  async getGlobalVersion(userId: string): Promise<number> {
    await this.ensure();
    if (this.db.engine === 'mongo') {
      const row = await this.db.mongoCollection('token_global').findOne({ _id: `global:${userId}` });
      return Number(row?.tokenVersion ?? 0);
    }
    const row = await this.db.get(`SELECT tokenVersion FROM token_global WHERE id = ?`, [`global:${userId}`]);
    return Number(row?.tokenVersion ?? 0);
  }

  async incrementGlobalVersion(userId: string): Promise<number> {
    await this.ensure();
    const id = `global:${userId}`;
    if (this.db.engine === 'mongo') {
      const col = this.db.mongoCollection('token_global');
      const existing = await col.findOne({ _id: id });
      const next = Number(existing?.tokenVersion ?? 0) + 1;
      await col.updateOne(
        { _id: id },
        { $set: { _id: id, id, tokenVersion: next } },
        { upsert: true },
      );
      return next;
    }
    const excluded = this.db.engine === 'postgres' ? 'token_global.tokenVersion + 1' : 'tokenVersion + 1';
    if (this.db.engine === 'postgres') {
      await this.db.run(
        `INSERT INTO token_global (id, tokenVersion) VALUES (?, 1)
         ON CONFLICT (id) DO UPDATE SET tokenVersion = token_global.tokenVersion + 1`,
        [id],
      );
    } else {
      await this.db.run(
        `INSERT INTO token_global (id, tokenVersion) VALUES (?, 1)
         ON CONFLICT(id) DO UPDATE SET tokenVersion = tokenVersion + 1`,
        [id],
      );
    }
    const row = await this.db.get(`SELECT tokenVersion FROM token_global WHERE id = ?`, [id]);
    return Number(row?.tokenVersion ?? 0);
  }

  async getDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    await this.ensure();
    const id = this.deviceKey(userId, deviceId, guildId);
    if (this.db.engine === 'mongo') {
      const row = await this.db.mongoCollection('token_devices').findOne({ _id: id });
      return Number(row?.tokenVersion ?? 0);
    }
    const row = await this.db.get(`SELECT tokenVersion FROM token_devices WHERE id = ?`, [id]);
    return Number(row?.tokenVersion ?? 0);
  }

  async incrementDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    await this.ensure();
    const id = this.deviceKey(userId, deviceId, guildId);
    const now = Math.floor(Date.now() / 1000);
    if (this.db.engine === 'mongo') {
      const col = this.db.mongoCollection('token_devices');
      const existing = await col.findOne({ _id: id });
      const next = Number(existing?.tokenVersion ?? 0) + 1;
      await col.updateOne(
        { _id: id },
        {
          $set: {
            _id: id,
            id,
            userId,
            deviceId,
            guildId: guildId ?? null,
            tokenVersion: next,
            issuedAt: Number(existing?.issuedAt ?? now),
            lastSeenAt: now,
          },
        },
        { upsert: true },
      );
      return next;
    }
    if (this.db.engine === 'postgres') {
      await this.db.run(
        `INSERT INTO token_devices (id, userId, deviceId, guildId, tokenVersion, issuedAt, lastSeenAt)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (id) DO UPDATE SET tokenVersion = token_devices.tokenVersion + 1`,
        [id, userId, deviceId, guildId ?? null, now, now],
      );
    } else {
      await this.db.run(
        `INSERT INTO token_devices (id, userId, deviceId, guildId, tokenVersion, issuedAt, lastSeenAt)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET tokenVersion = tokenVersion + 1`,
        [id, userId, deviceId, guildId ?? null, now, now],
      );
    }
    const row = await this.db.get(`SELECT tokenVersion FROM token_devices WHERE id = ?`, [id]);
    return Number(row?.tokenVersion ?? 0);
  }

  async upsertDevice(
    userId: string,
    deviceId: string,
    meta: Partial<Omit<DeviceTokenMeta, "_id" | "userId" | "deviceId" | "guildId">>,
    guildId?: string
  ): Promise<void> {
    await this.ensure();
    const id = this.deviceKey(userId, deviceId, guildId);
    const now = Math.floor(Date.now() / 1000);
    if (this.db.engine === 'mongo') {
      const col = this.db.mongoCollection('token_devices');
      const existing = await col.findOne({ _id: id });
      const merged = {
        tokenVersion: meta.tokenVersion ?? Number(existing?.tokenVersion ?? 0),
        deviceLabel: meta.deviceLabel ?? (existing?.deviceLabel as string | undefined) ?? null,
        issuedAt: Number(existing?.issuedAt ?? meta.issuedAt ?? now),
        lastSeenAt: meta.lastSeenAt ?? now,
        lastJti: meta.lastJti ?? (existing?.lastJti as string | undefined) ?? null,
      };
      await col.updateOne(
        { _id: id },
        {
          $set: {
            _id: id,
            id,
            userId,
            deviceId,
            guildId: guildId ?? null,
            ...merged,
          },
        },
        { upsert: true },
      );
      return;
    }
    const existing = await this.db.get(`SELECT * FROM token_devices WHERE id = ?`, [id]);
    const merged = {
      tokenVersion: meta.tokenVersion ?? Number(existing?.tokenVersion ?? 0),
      deviceLabel: meta.deviceLabel ?? existing?.deviceLabel ?? null,
      issuedAt: Number(existing?.issuedAt ?? meta.issuedAt ?? now),
      lastSeenAt: meta.lastSeenAt ?? now,
      lastJti: meta.lastJti ?? existing?.lastJti ?? null,
    };
    if (this.db.engine === 'postgres') {
      await this.db.run(
        `INSERT INTO token_devices (id, userId, deviceId, guildId, tokenVersion, deviceLabel, issuedAt, lastSeenAt, lastJti)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           tokenVersion = EXCLUDED.tokenVersion,
           deviceLabel  = EXCLUDED.deviceLabel,
           lastSeenAt   = EXCLUDED.lastSeenAt,
           lastJti      = EXCLUDED.lastJti`,
        [id, userId, deviceId, guildId ?? null, merged.tokenVersion, merged.deviceLabel, merged.issuedAt, merged.lastSeenAt, merged.lastJti],
      );
    } else {
      await this.db.run(
        `INSERT INTO token_devices (id, userId, deviceId, guildId, tokenVersion, deviceLabel, issuedAt, lastSeenAt, lastJti)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           tokenVersion = excluded.tokenVersion,
           deviceLabel  = excluded.deviceLabel,
           lastSeenAt   = excluded.lastSeenAt,
           lastJti      = excluded.lastJti`,
        [id, userId, deviceId, guildId ?? null, merged.tokenVersion, merged.deviceLabel, merged.issuedAt, merged.lastSeenAt, merged.lastJti],
      );
    }
  }

  async listDevices(userId: string): Promise<DeviceTokenMeta[]> {
    await this.ensure();
    if (this.db.engine === 'mongo') {
      const rows = await this.db.mongoCollection('token_devices').find({ userId });
      return rows.map((r) => ({
        _id: String(r.id ?? r._id),
        userId: String(r.userId),
        deviceId: String(r.deviceId),
        guildId: r.guildId != null ? String(r.guildId) : undefined,
        tokenVersion: Number(r.tokenVersion),
        deviceLabel: r.deviceLabel != null ? String(r.deviceLabel) : undefined,
        issuedAt: Number(r.issuedAt),
        lastSeenAt: Number(r.lastSeenAt),
        lastJti: r.lastJti != null ? String(r.lastJti) : undefined,
      }));
    }
    const rows = await this.db.all(`SELECT * FROM token_devices WHERE userId = ?`, [userId]);
    return rows.map((r) => ({
      _id: String(r.id),
      userId: String(r.userId),
      deviceId: String(r.deviceId),
      guildId: r.guildId != null ? String(r.guildId) : undefined,
      tokenVersion: Number(r.tokenVersion),
      deviceLabel: r.deviceLabel != null ? String(r.deviceLabel) : undefined,
      issuedAt: Number(r.issuedAt),
      lastSeenAt: Number(r.lastSeenAt),
      lastJti: r.lastJti != null ? String(r.lastJti) : undefined,
    }));
  }

  async deleteDevice(userId: string, deviceId: string, guildId?: string): Promise<void> {
    await this.ensure();
    const id = this.deviceKey(userId, deviceId, guildId);
    if (this.db.engine === 'mongo') {
      await this.db.mongoCollection('token_devices').deleteOne({ _id: id });
      return;
    }
    await this.db.run(`DELETE FROM token_devices WHERE id = ?`, [id]);
  }

  async getLastJti(userId: string, deviceId: string, guildId?: string): Promise<string | undefined> {
    await this.ensure();
    const id = this.deviceKey(userId, deviceId, guildId);
    if (this.db.engine === 'mongo') {
      const row = await this.db.mongoCollection('token_devices').findOne({ _id: id });
      return row?.lastJti != null ? String(row.lastJti) : undefined;
    }
    const row = await this.db.get(`SELECT lastJti FROM token_devices WHERE id = ?`, [id]);
    return row?.lastJti != null ? String(row.lastJti) : undefined;
  }
}

/** @deprecated Use DbTokenStore */
export const SqliteTokenStore = DbTokenStore;


export class TokenManager {
  private readonly masterKeyBuf: Buffer;
  private readonly store: TokenStore;
  private readonly ttlSeconds: number;
  private readonly maxTtlSeconds: number;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly bitAllowlist: ReadonlySet<Bit> | undefined;
  private readonly onAudit: AuditHandler | undefined;
  private readonly onVerifyFailure: ((e: TokenError) => void | Promise<void>) | undefined;

  constructor(masterSecret: string, store: TokenStore, options: TokenManagerOptions = {}) {
    if (!masterSecret || masterSecret.length < 32) {
      throw new NovaError("MASTER_SECRET must be at least 32 characters", {
      code: "TOKEN.CONFIG.MASTER_SECRET",
      category: "token",
      severity: "fatal",
      userMessage: "Token signing secret is not configured correctly.",
      statusCode: 500,
    });
    }
    this.masterKeyBuf = deriveMasterKey(masterSecret);

    this.store           = store;
    this.ttlSeconds       = options.ttlSeconds    ?? 900;
    this.maxTtlSeconds    = options.maxTtlSeconds ?? 86_400;
    this.issuer           = options.issuer         ?? "token-manager";
    this.audience         = options.audience       ?? "default";
    this.bitAllowlist     = options.bitAllowlist;
    this.onAudit          = options.onAudit;
    this.onVerifyFailure  = options.onVerifyFailure;
  }

  private signingKey(userId: string, tokenVersion: string): Buffer {
    return deriveSigningKey(this.masterKeyBuf, userId, tokenVersion);
  }

  private async emit(event: AuditEvent): Promise<void> {
    if (!this.onAudit) return;
    try {
      await this.onAudit(event);
    } catch {
    }
  }

  private validateBits(bits: Bit[]): void {
    if (!this.bitAllowlist) return;
    for (const b of bits) {
      if (!this.bitAllowlist.has(b)) {
        throw new TokenError("INVALID_PERMISSION", `Bit "${b}" is not in the allowlist`);
      }
    }
  }

  async issue(userId: string, options: TokenIssueOptions = {}): Promise<string> {
    validateSnowflake(userId);

    const bits = options.bits ?? [];
    this.validateBits(bits);

    const ttl = Math.min(options.ttlSeconds ?? this.ttlSeconds, this.maxTtlSeconds);

    const deviceId = options.deviceId ?? randomBytes(16).toString("hex");
    const jti      = randomBytes(16).toString("hex");
    const now      = Math.floor(Date.now() / 1000);
    const guildId  = options.guildId;

    const globalVersion = await this.store.getGlobalVersion(userId);
    const deviceVersion = options.useDeviceVersion
      ? await this.store.getDeviceVersion(userId, deviceId, guildId)
      : 0;
    const tokenVersion = packVersion(globalVersion, deviceVersion);

    const payload: TokenPayload = {
      userId,
      iat: now,
      exp: now + ttl,
      jti,
      deviceId,
      ...(options.deviceLabel && { deviceLabel: options.deviceLabel }),
      bits,
      ...(guildId && { guildId }),
      tokenVersion,
      iss: this.issuer,
      aud: this.audience,
    };

    const userPart    = b64Encode(userId);
    const payloadPart = b64Encode(JSON.stringify(payload));
    const body        = `R${userPart}_${payloadPart}`;
    const key         = this.signingKey(userId, tokenVersion);
    const signature   = sign(body, key);
    const token       = `${body}.${signature}`;

    await this.store.upsertDevice(userId, deviceId, {
      tokenVersion: deviceVersion,
      ...(options.deviceLabel && { deviceLabel: options.deviceLabel }),
      issuedAt:   now,
      lastSeenAt: now,
      lastJti:    jti,
    }, guildId);

    await this.emit({
      type:      "token.issued",
      userId,
      deviceId,
      guildId,
      jti,
      timestamp: Date.now(),
    });

    return token;
  }

  async verify(token: string, options: { skipRotationCheck?: boolean } = {}): Promise<VerifiedToken> {
    let parsedUserId: string | undefined;
    let parsedPayload: TokenPayload | undefined;
    let specificEventEmitted = false;

    try {
      if (typeof token !== "string" || !token.startsWith("R")) {
        throw new TokenError("INVALID_FORMAT", "Token must be a string starting with R");
      }

      const dotIdx = token.lastIndexOf(".");
      if (dotIdx === -1) {
        throw new TokenError("INVALID_FORMAT", "Token missing signature separator");
      }

      const body        = token.slice(0, dotIdx);
      const providedSig = token.slice(dotIdx + 1);

      if (!providedSig) {
        throw new TokenError("INVALID_FORMAT", "Token has empty signature");
      }

      const underscoreIdx = body.indexOf("_");
      if (underscoreIdx === -1) {
        throw new TokenError("INVALID_FORMAT", "Token missing _ separator");
      }

      const userPart    = body.slice(1, underscoreIdx);
      const payloadPart = body.slice(underscoreIdx + 1);

      try {
        parsedUserId = b64Decode(userPart);
      } catch {
        throw new TokenError("INVALID_FORMAT", "Malformed userId segment");
      }

      let rawPayload: unknown;
      try {
        rawPayload = JSON.parse(b64Decode(payloadPart));
      } catch {
        throw new TokenError("INVALID_FORMAT", "Malformed payload segment");
      }

      const rawObj = rawPayload as Record<string, unknown>;
      const embeddedVersion = typeof rawObj?.tokenVersion === "string" ? rawObj.tokenVersion : "0:0";

      validateSnowflake(parsedUserId);

      const key         = this.signingKey(parsedUserId, embeddedVersion);
      const expectedSig = sign(body, key);

      if (!safeEqual(providedSig, expectedSig)) {
        throw new TokenError("INVALID_SIGNATURE", "Token signature is invalid");
      }
      assertPayloadShape(rawPayload);
      parsedPayload = rawPayload;

      if (parsedPayload.userId !== parsedUserId) {
        throw new TokenError("INVALID_FORMAT", "userId mismatch between header and payload");
      }

      if (parsedPayload.iss !== this.issuer) {
        throw new TokenError("INVALID_ISSUER", `Token issuer "${parsedPayload.iss}" does not match expected "${this.issuer}"`);
      }
      if (parsedPayload.aud !== this.audience) {
        throw new TokenError("INVALID_AUDIENCE", `Token audience "${parsedPayload.aud}" does not match expected "${this.audience}"`);
      }

      const now = Math.floor(Date.now() / 1000);
      if (parsedPayload.exp <= now) {
        specificEventEmitted = true;
        await this.emit({
          type:      "token.expired",
          userId:    parsedPayload.userId,
          deviceId:  parsedPayload.deviceId,
          guildId:   parsedPayload.guildId,
          jti:       parsedPayload.jti,
          timestamp: Date.now(),
        });
        throw new TokenError("TOKEN_EXPIRED", "Token has expired");
      }

      const globalVersion = await this.store.getGlobalVersion(parsedPayload.userId);
      const deviceVersion = await this.store.getDeviceVersion(parsedPayload.userId, parsedPayload.deviceId, parsedPayload.guildId);
      const expectedVersion = packVersion(globalVersion, deviceVersion);

      if (parsedPayload.tokenVersion !== expectedVersion) {
        throw new TokenError("TOKEN_REVOKED", "Token has been revoked");
      }

      if (!options.skipRotationCheck) {
        const lastJti = await this.store.getLastJti(parsedPayload.userId, parsedPayload.deviceId, parsedPayload.guildId);
        if (lastJti && lastJti !== parsedPayload.jti) {
          await this.store.incrementDeviceVersion(parsedPayload.userId, parsedPayload.deviceId, parsedPayload.guildId);
          specificEventEmitted = true;
          await this.emit({
            type:      "token.rotation_attack",
            userId:    parsedPayload.userId,
            deviceId:  parsedPayload.deviceId,
            guildId:   parsedPayload.guildId,
            jti:       parsedPayload.jti,
            reason:    `Expected jti=${lastJti}, got jti=${parsedPayload.jti}`,
            timestamp: Date.now(),
          });
          throw new TokenError("TOKEN_REVOKED", "Token reuse detected — device has been revoked");
        }
      }

      await this.store.upsertDevice(parsedPayload.userId, parsedPayload.deviceId, {
        lastSeenAt: Math.floor(Date.now() / 1000),
      }, parsedPayload.guildId);

      await this.emit({
        type:      "token.verified",
        userId:    parsedPayload.userId,
        deviceId:  parsedPayload.deviceId,
        guildId:   parsedPayload.guildId,
        jti:       parsedPayload.jti,
        timestamp: Date.now(),
      });

      return { payload: parsedPayload, raw: token };

    } catch (err) {
      if (err instanceof TokenError && !specificEventEmitted) {
        await this.emit({
          type:      "token.verify_failed",
          userId:    parsedUserId,
          deviceId:  parsedPayload?.deviceId,
          guildId:   parsedPayload?.guildId,
          jti:       parsedPayload?.jti,
          reason:    err.message,
          timestamp: Date.now(),
        });
        try {
          await this.onVerifyFailure?.(err);
        } catch {
        }
      } else if (err instanceof TokenError && specificEventEmitted) {
        try {
          await this.onVerifyFailure?.(err);
        } catch {
        }
      }
      throw err;
    }
  }

  async revokeAll(userId: string): Promise<number> {
    validateSnowflake(userId);
    const newVersion = await this.store.incrementGlobalVersion(userId);
    await this.emit({
      type:      "token.revoked_all",
      userId,
      timestamp: Date.now(),
    });
    return newVersion;
  }

  async revokeDevice(userId: string, deviceId: string, guildId?: string): Promise<number> {
    validateSnowflake(userId);
    const newVersion = await this.store.incrementDeviceVersion(userId, deviceId, guildId);
    await this.store.upsertDevice(userId, deviceId, {
      lastSeenAt: Math.floor(Date.now() / 1000),
    }, guildId);
    await this.emit({
      type:      "token.revoked_device",
      userId,
      deviceId,
      guildId,
      timestamp: Date.now(),
    });
    return newVersion;
  }

  async listDevices(userId: string): Promise<DeviceTokenMeta[]> {
    validateSnowflake(userId);
    return this.store.listDevices(userId);
  }

  async refresh(token: string, options: TokenRefreshOptions = {}): Promise<string> {
    const { payload } = await this.verify(token, { skipRotationCheck: true });

    let bits: Bit[];
    let staleBitsWarning: string | undefined;
    if (options.getBits) {
      bits = await options.getBits(payload.userId, payload.guildId);
    } else {
      bits = payload.bits;
      staleBitsWarning = "no getBits provided — old bits preserved (potentially stale)";
    }

    const newToken = await this.issue(payload.userId, {
      deviceId:    payload.deviceId,
      deviceLabel: payload.deviceLabel,
      bits,
      guildId: payload.guildId,
      useDeviceVersion: true,
    });

    await this.emit({
      type:      "token.refreshed",
      userId:    payload.userId,
      deviceId:  payload.deviceId,
      guildId:   payload.guildId,
      jti:       payload.jti,
      ...(staleBitsWarning && { reason: staleBitsWarning }),
      timestamp: Date.now(),
    });

    return newToken;
  }

  hasBit(verified: VerifiedToken, bit: Bit): boolean {
    return verified.payload.bits.includes(bit);
  }

  requireBit(verified: VerifiedToken, bit: Bit): void {
    if (!this.hasBit(verified, bit)) {
      throw new TokenError("PERMISSION_DENIED", `Token does not have required bit: "${bit}"`);
    }
  }

  requireBits(verified: VerifiedToken, ...bits: Bit[]): void {
    for (const b of bits) {
      this.requireBit(verified, b);
    }
  }

  debugDecodeUnsafe(token: string, _debugFlag: "I_UNDERSTAND_THIS_IS_UNSAFE"): Partial<TokenPayload> | null {
    try {
      const dotIdx = token.lastIndexOf(".");
      if (dotIdx === -1) return null;
      const body           = token.slice(0, dotIdx);
      const underscoreIdx  = body.indexOf("_");
      if (underscoreIdx === -1) return null;
      const payloadPart = body.slice(underscoreIdx + 1);
      const raw = JSON.parse(b64Decode(payloadPart)) as Partial<TokenPayload>;
      return { ...raw, tokenVersion: undefined };
    } catch {
      return null;
    }
  }
}

export type TokenErrorCode =
  | "INVALID_FORMAT"
  | "INVALID_SIGNATURE"
  | "INVALID_SNOWFLAKE"
  | "INVALID_PERMISSION"
  | "INVALID_ISSUER"
  | "INVALID_AUDIENCE"
  | "TOKEN_EXPIRED"
  | "TOKEN_REVOKED"
  | "PERMISSION_DENIED";

const TOKEN_HTTP_STATUS: Record<TokenErrorCode, number> = {
  INVALID_FORMAT: 400,
  INVALID_SIGNATURE: 401,
  INVALID_SNOWFLAKE: 400,
  INVALID_PERMISSION: 400,
  INVALID_ISSUER: 401,
  INVALID_AUDIENCE: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REVOKED: 401,
  PERMISSION_DENIED: 403,
};

const TOKEN_USER_MESSAGE: Record<TokenErrorCode, string> = {
  INVALID_FORMAT: "The token format is invalid.",
  INVALID_SIGNATURE: "The token signature is invalid.",
  INVALID_SNOWFLAKE: "A provided identifier is not a valid snowflake.",
  INVALID_PERMISSION: "One or more permission bits are not allowed.",
  INVALID_ISSUER: "The token issuer is not valid.",
  INVALID_AUDIENCE: "The token audience is not valid.",
  TOKEN_EXPIRED: "The token has expired.",
  TOKEN_REVOKED: "The token has been revoked.",
  PERMISSION_DENIED: "The token is missing a required permission.",
};

export class TokenError extends NovaError {
  readonly tokenCode: TokenErrorCode;

  constructor(code: TokenErrorCode, message: string) {
    super(message, {
      code: `TOKEN.${code}`,
      category: "token",
      severity: "error",
      userMessage: TOKEN_USER_MESSAGE[code],
      statusCode: TOKEN_HTTP_STATUS[code],
      details: { code },
    });
    this.name = "TokenError";
    this.tokenCode = code;
  }
}

function validateSnowflake(id: string): void {
  if (typeof id !== "string" || !/^\d{17,19}$/.test(id)) {
    throw new TokenError("INVALID_SNOWFLAKE", `"${id}" is not a valid Discord snowflake`);
  }
}

function assertPayloadShape(p: unknown): asserts p is TokenPayload {
  if (typeof p !== "object" || p === null)
    throw new TokenError("INVALID_FORMAT", "Payload is not an object");

  const o = p as Record<string, unknown>;

  if (typeof o.userId       !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid userId");
  if (typeof o.iat          !== "number")  throw new TokenError("INVALID_FORMAT", "Missing or invalid iat");
  if (typeof o.exp          !== "number")  throw new TokenError("INVALID_FORMAT", "Missing or invalid exp");
  if (typeof o.jti          !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid jti");
  if (typeof o.deviceId     !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid deviceId");
  if (!Array.isArray(o.bits))              throw new TokenError("INVALID_FORMAT", "Missing or invalid bits");
  if (o.guildId !== undefined && typeof o.guildId !== "string")
    throw new TokenError("INVALID_FORMAT", "Invalid guildId");
  if (typeof o.tokenVersion !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid tokenVersion");
  if (typeof o.iss          !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid iss");
  if (typeof o.aud          !== "string")  throw new TokenError("INVALID_FORMAT", "Missing or invalid aud");

  if (o.exp <= o.iat)
    throw new TokenError("INVALID_FORMAT", "exp must be after iat");
  if ((o.exp as number) - (o.iat as number) > 7 * 24 * 3600)
    throw new TokenError("INVALID_FORMAT", "Token TTL exceeds 7-day maximum");
  if (!/^\d+:\d+$/.test(o.tokenVersion as string))
    throw new TokenError("INVALID_FORMAT", "tokenVersion has invalid format");
}

export async function extractBearer(
  authHeader: string | null | undefined,
  manager: TokenManager
): Promise<VerifiedToken> {
  if (!authHeader) {
    throw new TokenError("INVALID_FORMAT", "Missing Authorization header");
  }

  const spaceIdx = authHeader.indexOf(" ");
  if (spaceIdx === -1) {
    throw new TokenError("INVALID_FORMAT", "Authorization header must be: Bearer <token>");
  }

  const scheme = authHeader.slice(0, spaceIdx);
  const token  = authHeader.slice(spaceIdx + 1).trim();

  if (scheme !== "Bearer") {
    throw new TokenError("INVALID_FORMAT", `Unsupported auth scheme: "${scheme}"`);
  }

  if (!token || token.includes(" ")) {
    throw new TokenError("INVALID_FORMAT", "Authorization header token must not contain spaces");
  }

  return manager.verify(token);
}

export async function extractCookie(
  cookieHeader: string | null | undefined,
  manager: TokenManager,
  cookieName = "auth_token"
): Promise<VerifiedToken> {
  if (!cookieHeader) {
    throw new TokenError("INVALID_FORMAT", "Missing Cookie header");
  }

  const token = cookieHeader
    .split(";")
    .map(part => part.trim().split("="))
    .find(([name]) => name === cookieName)
    ?.[1];

  if (!token) {
    throw new TokenError("INVALID_FORMAT", `Cookie "${cookieName}" not found`);
  }

  return manager.verify(decodeURIComponent(token));
}

export type AuthedRequest = Request & { auth?: unknown };

export function requireAuth(
  manager: TokenManager,
  options: { bits?: Bit[] } = {}
) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const verified = await extractBearer(req.headers.authorization, manager);

      if (options.bits) {
        for (const bit of options.bits) {
          manager.requireBit(verified, bit);
        }
      }

      req.auth = verified;
      next();
    } catch (err) {
      if (err instanceof TokenError) {
        const status =
          err.code === "PERMISSION_DENIED" ? 403 :
          err.code === "TOKEN_EXPIRED"     ? 401 :
          err.code === "TOKEN_REVOKED"     ? 401 : 401;

        res.status(status).json({ error: err.code, message: err.message });
        return;
      }
      next(err);
    }
  };
}

export class InMemoryTokenStore implements TokenStore {
  private globalVersions  = new Map<string, number>();
  private deviceVersions  = new Map<string, number>();
  private deviceMeta      = new Map<string, DeviceTokenMeta>();

  async getGlobalVersion(userId: string): Promise<number> {
    return this.globalVersions.get(userId) ?? 0;
  }

  async incrementGlobalVersion(userId: string): Promise<number> {
    const next = (this.globalVersions.get(userId) ?? 0) + 1;
    this.globalVersions.set(userId, next);
    return next;
  }

  private deviceKey(userId: string, deviceId: string, guildId?: string): string {
    return guildId ? `${guildId}:${userId}:${deviceId}` : `${userId}:${deviceId}`;
  }

  async getDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    return this.deviceVersions.get(this.deviceKey(userId, deviceId, guildId)) ?? 0;
  }

  async incrementDeviceVersion(userId: string, deviceId: string, guildId?: string): Promise<number> {
    const key  = this.deviceKey(userId, deviceId, guildId);
    const next = (this.deviceVersions.get(key) ?? 0) + 1;
    this.deviceVersions.set(key, next);
    return next;
  }

  async upsertDevice(
    userId: string,
    deviceId: string,
    meta: Partial<Omit<DeviceTokenMeta, "_id" | "userId" | "deviceId" | "guildId">>,
    guildId?: string
  ): Promise<void> {
    const key      = this.deviceKey(userId, deviceId, guildId);
    const existing = this.deviceMeta.get(key) ?? {
      _id:        key,
      userId,
      deviceId,
      guildId,
      tokenVersion: 0,
      issuedAt:   Math.floor(Date.now() / 1000),
      lastSeenAt: Math.floor(Date.now() / 1000),
    };
    this.deviceMeta.set(key, { ...existing, ...meta });
  }

  async listDevices(userId: string): Promise<DeviceTokenMeta[]> {
    return [...this.deviceMeta.values()].filter(v => v.userId === userId);
  }

  async deleteDevice(userId: string, deviceId: string, guildId?: string): Promise<void> {
    const key = this.deviceKey(userId, deviceId, guildId);
    this.deviceVersions.delete(key);
    this.deviceMeta.delete(key);
  }

  async getLastJti(userId: string, deviceId: string, guildId?: string): Promise<string | undefined> {
    return this.deviceMeta.get(this.deviceKey(userId, deviceId, guildId))?.lastJti;
  }
}