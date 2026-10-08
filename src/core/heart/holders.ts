import type { PermissionsManager } from '#core/manager/permissions.js';
import type { PermissionCache } from '#core/manager/permissionCache.js';
import type { TokenManager } from '#core/manager/token.js';
import type { Client } from 'discord.js';

let permissionsManager: PermissionsManager | null = null;
let permissionCache: PermissionCache | null = null;
let tokenManager: TokenManager | null = null;
let primaryClient: Client<true> | null = null;

export function setHeartPermissions(
    manager: PermissionsManager,
    cache: PermissionCache,
): void {
    permissionsManager = manager;
    permissionCache = cache;
}

export function getHeartPermissions(): {
    manager: PermissionsManager | null;
    cache: PermissionCache | null;
} {
    return { manager: permissionsManager, cache: permissionCache };
}

export function setHeartTokenManager(manager: TokenManager): void {
    tokenManager = manager;
}

export function getHeartTokenManager(): TokenManager | null {
    return tokenManager;
}

export function setHeartClient(client: Client<true> | Client | null): void {
    primaryClient = client ? (client as Client<true>) : null;
}

export function getHeartClient(): Client<true> | null {
    return primaryClient;
}
