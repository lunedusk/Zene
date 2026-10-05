import type { NavigationItem } from './types.js';


export const defaultNavigation: NavigationItem[] = [
  {
    id: 'dash.home',
    label: 'Overview',
    href: '/dashboard',
    section: 'global',
    order: 10,
    visibility: { type: 'authenticated' },
  },
  {
    id: 'dash.search',
    label: 'Search',
    href: '/search',
    section: 'global',
    order: 15,
    visibility: { type: 'authenticated' },
  },
  {
    id: 'dash.servers',
    label: 'Servers',
    href: '/servers',
    section: 'global',
    order: 20,
    requiredBit: 'bot.servers.view',
  },
  {
    id: 'dash.owner',
    label: 'Owner',
    href: '/owner',
    section: 'owner',
    order: 30,
    visibility: { type: 'owner' },
  },
  {
    id: 'dash.account',
    label: 'Account',
    href: '/account',
    section: 'account',
    order: 90,
    visibility: { type: 'authenticated' },
  },
  {
    id: 'dash.plugin.placeholder',
    label: 'Plugin surface',
    href: '/dashboard/plugin-demo',
    section: 'plugin',
    order: 40,
    requiredBit: 'bot.plugins.view',
  },
];
