# Zene — Data shapes

Catalog of **existing** TypeScript shapes in the codebase (no invented types).  
Source paths are authoritative; this file is an index for agents and operators.

---

## Security plugin (`src/plugins/security/src/lib/types.ts`)

| Shape | Kind | Notes |
|-------|------|--------|
| `PunishOp` | union | ban, unban, kick, timeout, untimeout, softban, tempban, hackban |
| `SecurityActor` | interface | `userId`, optional `tag` |
| `GuildAuthzDecision` | interface | per-guild allow/deny with reason enum |
| `GuildTargetingResult` | interface | allowed guild ids + denied decisions |
| `PerGuildActionResult` | interface | single-guild action outcome |
| `ActionBatchResult` | interface | multi-guild batch + denied list |
| `TempbanRecord` | interface | scheduled unban row |
| `SecurityGuildSettingsRow` | interface | per-guild settings stamp |
| `InfractionRow` | interface | warn/note-style record |
| `ViolationRow` | interface | strike points per user/guild |
| `ChannelOverwriteSnapshot` | interface | lockdown restore data |
| `FreezeStateRow` | interface | lockdown / freeze persistence |
| `SnipeEntry` | interface | last deleted message cache entry |
| `LockdownOptions` | interface | pause invites / lock channels / quarantine |
| `AutoModFilterName` | union | filter identifiers |
| `AutoModActionName` | union | delete, warn, timeout, strike, tempRole |
| `AutoModSettings` | interface | thresholds + actions + exempts |
| `AutoModHit` | interface | filter hit on a message |
| `SpamSignatureEntry` / `SpamSignaturesFile` | interface | fingerprint DB shapes |
| `AntiNukeEventKey` | union | audit event keys |
| `AntiNukePunishment` | union | stripRoles, kick, ban, timeout, quarantine, tempRole |
| `AntiNukeRule` | interface | threshold window + punishment |
| `RaidSettings` | interface | join-rate protection |
| `VerifySettings` | interface | captcha gate config |
| `CaptchaChallenge` | interface | in-flight captcha |
| `BlacklistKind` | union | word, link, regex |
| `BlacklistEntry` | interface | automod blacklist row |
| `TempRoleRecord` | interface | temporary role grant |

Related: `src/plugins/security/src/lib/events.ts` (`PunishEventPayload`, `SecurityEventName`), `proof.ts` (`ProofMeta`), `captchaCanvas.ts` (`CaptchaImageResult`), `bits.ts` (`SecurityBit`).

---

## Core moderation (`src/plugins/core/src/handlers/moderation.ts`)

| Shape | Kind |
|-------|------|
| `ModerationActor` | interface |
| `PerGuildModerationResult` | interface |
| `ModerationBatchResult` | interface |
| `BanOptions` / `KickOptions` / `TimeoutOptions` / `UntimeoutOptions` / `RoleOptions` / `NickOptions` | interfaces |

---

## Permissions (`src/core/types/permissions.ts`)

| Shape | Kind |
|-------|------|
| `PermBitDoc` | interface |
| `BotWideRoleDoc` | interface |
| `ServerRoleDoc` | interface |
| `PermUserCacheDoc` | interface |
| `ResolvedPermissions` | interface |
| `InteractionAccess` | interface |
| `PermissionCheckResult` | interface |
| `CreateBotRoleInput` / `CreateServerRoleInput` | interfaces |
| `PermissionErrorCode` | union |
| `PermissionError` | class |

---

## Token (`src/core/manager/token.ts`)

| Shape | Kind |
|-------|------|
| `Bit` | type alias |
| `BitSets` | const groups of permission bits |
| `TokenPayload` / `VerifiedToken` | interfaces |
| `TokenIssueOptions` / `TokenRefreshOptions` | interfaces |
| `TokenStore` / `DbTokenStore` | interface / class |
| `DeviceTokenMeta` | interface |
| `TokenManager` | class |
| `TokenError` / `TokenErrorCode` | class / union |

---

## Plugin loader (`src/core/loader/types.ts`)

| Shape | Kind |
|-------|------|
| `DiscoveredPlugin` | interface |
| `PreloadedPlugin` | interface |
| `PluginBootStatus` | enum |
| `IntegrityStatus` | union |
| `IntegrityGateOptions` / `IntegrityGateResult` | interfaces |

---

## Defaults / boot (`src/core/defaults.ts`, `src/core/bootstrap/pipeline.ts`)

| Shape | Kind |
|-------|------|
| `DefaultKind` | union string \| boolean \| number |
| `DefaultEntry` | interface |
| `runBootPipeline` | function (no data shape) |

---

## Feature requirements (`src/core/manager/featureRequirements.ts`)

| Shape | Kind |
|-------|------|
| `FeatureRequirement` | interface |
| `IntentName` | type |

---

*Update this file when new persistence or public option bags are added to the codebase.*

## Token crypto (`src/core/manager/tokenCrypto.ts`)

| Shape | Kind |
|-------|------|
| `SignedTokenParts` | interface |
| `b64Encode` / `b64Decode` / `hmacSign` / `packVersion` / `safeEqual` | functions |
| `signingKey` / `deriveMasterKey` / `assembleToken` / `splitToken` | functions |

## Permissions guards (`src/core/manager/permissions/guards.ts`)

| Shape | Kind |
|-------|------|
| `OWNER_BIT` / `BOT_PROTECTED_BIT` / `SERVER_PROTECTED_BIT` | const strings |
| `bitsIncludeOwner` / `isEnvOwner` / `envOwnerIds` | functions |

## Updater config (`src/core/manager/updater/config.ts`)

| Shape | Kind |
|-------|------|
| `HARD_EXCLUDES` | Set of path segments |
| `loadUpdaterConfig` | function → `UpdaterConfig` |

## Security command meta (`src/plugins/security/src/commands/punishMeta.ts`)

| Shape | Kind |
|-------|------|
| `OP_BIT` | map PunishOp → server bit |
| `PUNISH_OPS` | Set of op names |
| `actorFrom` | User → SecurityActor |
