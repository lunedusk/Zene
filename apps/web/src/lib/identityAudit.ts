/**
 * Automated dynamicity helpers — flag suspicious user-facing identity patterns.
 * Technical package names are allowlisted.
 */

const ALLOWED_TECHNICAL = [
  '@lunedusk/zene',
  '@lunedusk/zene-web',
  'lunedusk/Zene',
  'dash.session',
  '/api/dash',
];

const SUSPICIOUS =
  /\bZene\b|\bzene\b|discord\.gg\/[A-Za-z0-9]+|localhost:\d+|application[_-]?id\s*[:=]/i;

export function isAllowedTechnicalReference(text: string): boolean {
  return ALLOWED_TECHNICAL.some((a) => text.includes(a));
}

export function findSuspiciousIdentityStrings(samples: string[]): string[] {
  const hits: string[] = [];
  for (const s of samples) {
    if (isAllowedTechnicalReference(s)) continue;
    if (SUSPICIOUS.test(s)) hits.push(s);
  }
  return hits;
}
