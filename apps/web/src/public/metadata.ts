/**
 * Dynamic document metadata from runtime identity — never hardcode product name.
 */

import { getIdentity } from '../identity/store.js';

export function applyPublicMetadata(input: {
  title?: string;
  description?: string;
  path?: string;
  noindex?: boolean;
}): void {
  const id = getIdentity();
  const title = input.title ? `${input.title} · ${id.botName}` : id.botName;
  document.title = title;

  const setMeta = (name: string, content: string, property = false) => {
    const attr = property ? 'property' : 'name';
    let el = document.head.querySelector(`meta[${attr}="${name}"]`);
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  setMeta('description', input.description ?? `${id.botName} — Discord bot platform`);
  setMeta('theme-color', getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#3b6cff');
  setMeta('og:title', title, true);
  setMeta('og:description', input.description ?? id.botName, true);
  setMeta('og:type', 'website', true);
  if (id.avatarUrl) setMeta('og:image', id.avatarUrl, true);
  setMeta('twitter:card', 'summary');
  setMeta('twitter:title', title);
  setMeta('robots', input.noindex ? 'noindex, nofollow' : 'index, follow');

  if (id.avatarUrl) {
    let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = id.avatarUrl;
  }
}
