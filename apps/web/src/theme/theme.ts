import { logger } from '../lib/logger.js';

export type ThemeMode = 'light' | 'dark' | 'system';

const THEME_KEY = 'dash.theme';

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {

  }
  return 'system';
}

export function resolveTheme(mode: ThemeMode = getThemeMode()): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {

  }
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  logger.debug('theme.apply', { mode, resolved });
}
