




export interface DashboardApplicationIdentity {

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


export function genericIdentityFallback(): DashboardApplicationIdentity {
  return {
    botName: 'Dashboard',
    applicationName: 'Dashboard',
    description: 'Operational dashboard',
  };
}
