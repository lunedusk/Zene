/**
 * Canonical frontend application identity (deployment-facing, not technical package identity).
 * Source hierarchy: owner config → runtime Dashboard API → generic platform fallback (never a fixed product name).
 */

export interface DashboardApplicationIdentity {
  /** Display name of the bot/application (e.g. "ExampleBot"). */
  botName: string;
  applicationName?: string;
  description?: string;
  avatarUrl?: string;
  iconUrl?: string;
  faviconUrl?: string;
  inviteUrl?: string;
  supportUrl?: string;
  documentationUrl?: string;
  websiteUrl?: string;
  discordApplicationId?: string;
  locale?: string;
  timezone?: string;
  branding?: {
    logoUrl?: string;
    wordmarkUrl?: string;
    accent?: string;
  };
}

export const IDENTITY_SCHEMA_VERSION = 1 as const;

/** Generic fallback — not a product brand name. */
export function genericIdentityFallback(): DashboardApplicationIdentity {
  return {
    botName: 'Dashboard',
    applicationName: 'Dashboard',
    description: 'Operational dashboard',
  };
}
