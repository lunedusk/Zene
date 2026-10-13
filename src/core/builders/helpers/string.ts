export function sanitizeMarkdownString(
    str: string | undefined | null,
    maxLen: number,
    fallback = '\u200B',
): string {
    if (!str || str.trim() === '') return fallback;
    if (str.length <= maxLen) return str;

    let truncated = str.substring(0, maxLen - 3);
    truncated = truncated.replace(/\[[^\]]*\]\([^)]*$/, '');

    const openBold = (truncated.match(/\*\*/g) || []).length;
    if (openBold % 2 !== 0) {
        truncated = truncated.substring(0, truncated.length - 2);
        truncated += '**';
    }

    return truncated + '...';
}
