import {
  genericIdentityFallback,
  type DashboardApplicationIdentity,
} from './types.js';
import { logger } from '../lib/logger.js';

let identity: DashboardApplicationIdentity = genericIdentityFallback();
const listeners = new Set<(i: DashboardApplicationIdentity) => void>();

export function getIdentity(): DashboardApplicationIdentity {
  return identity;
}

export function setIdentity(next: DashboardApplicationIdentity): void {
  identity = {
    ...genericIdentityFallback(),
    ...next,
    botName: next.botName?.trim() || 'Dashboard',
  };
  logger.debug('identity.loaded', {
    botName: identity.botName,
    hasInvite: Boolean(identity.inviteUrl),
    hasAvatar: Boolean(identity.avatarUrl),
  });
  for (const fn of listeners) fn(identity);
}

export function subscribeIdentity(fn: (i: DashboardApplicationIdentity) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}


export function identityFromApiPayload(raw: unknown): DashboardApplicationIdentity {
  const base = genericIdentityFallback();
  if (!raw || typeof raw !== 'object') return base;
  const o = raw as Record<string, unknown>;
  const brandingRaw = o.branding && typeof o.branding === 'object' ? (o.branding as Record<string, unknown>) : undefined;
  return {
    botName: typeof o.botName === 'string' && o.botName.trim() ? o.botName.trim() : base.botName,
    applicationName: typeof o.applicationName === 'string' ? o.applicationName : undefined,
    description: typeof o.description === 'string' ? o.description : undefined,
    avatarUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : undefined,
    iconUrl: typeof o.iconUrl === 'string' ? o.iconUrl : undefined,
    faviconUrl: typeof o.faviconUrl === 'string' ? o.faviconUrl : undefined,
    inviteUrl: typeof o.inviteUrl === 'string' ? o.inviteUrl : undefined,
    supportUrl: typeof o.supportUrl === 'string' ? o.supportUrl : undefined,
    documentationUrl: typeof o.documentationUrl === 'string' ? o.documentationUrl : undefined,
    websiteUrl: typeof o.websiteUrl === 'string' ? o.websiteUrl : undefined,
    discordApplicationId: typeof o.discordApplicationId === 'string' ? o.discordApplicationId : undefined,
    locale: typeof o.locale === 'string' ? o.locale : undefined,
    timezone: typeof o.timezone === 'string' ? o.timezone : undefined,
    branding: brandingRaw
      ? {
          logoUrl: typeof brandingRaw.logoUrl === 'string' ? brandingRaw.logoUrl : undefined,
          wordmarkUrl: typeof brandingRaw.wordmarkUrl === 'string' ? brandingRaw.wordmarkUrl : undefined,
          accent: typeof brandingRaw.accent === 'string' ? brandingRaw.accent : undefined,
        }
      : undefined,
  };
}

export function documentTitle(pageLabel?: string): string {
  const name = identity.botName || 'Dashboard';
  if (!pageLabel) return name;
  return `${name} — ${pageLabel}`;
}

export function applyDocumentIdentity(pageLabel?: string): void {
  if (typeof document === 'undefined') return;
  document.title = documentTitle(pageLabel);
  const desc = identity.description;
  if (desc) {
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', desc);
  }
  const favicon = identity.faviconUrl || identity.iconUrl || identity.avatarUrl;
  if (favicon) {
    let link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = favicon;
  }
}
