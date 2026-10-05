

export type PublicSectionType =
  | 'hero'
  | 'features'
  | 'commands'
  | 'servers'
  | 'plugins'
  | 'statistics'
  | 'performance'
  | 'security'
  | 'integrations'
  | 'screenshots'
  | 'faq'
  | 'docs'
  | 'changelog'
  | 'cta'
  | 'custom';

export interface PublicSection {
  id: string;
  type: PublicSectionType;
  enabled: boolean;
  order: number;
  title?: string;
  description?: string;
  headline?: string;
  subhead?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  label?: string;
  href?: string;
  content?: string;
  items?: Array<{
    id: string;
    title?: string;
    description?: string;
    question?: string;
    answer?: string;
    icon?: string;
  }>;
}

export interface PublicSiteConfig {
  version: number;
  sections: PublicSection[];
  navigation?: Array<{ id: string; label: string; href: string; external?: boolean }>;
  metadata?: { title?: string; description?: string };
  publishedVersion?: number | null;
}
