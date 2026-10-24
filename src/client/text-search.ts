export interface TextMatch {
  start: number;
  end: number;
}

/** Literal, case-insensitive matches with offsets in the original UTF-16 text. */
export function textMatches(text: string, query: string): TextMatch[] {
  if (!query) {
    return [];
  }
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return Array.from(text.matchAll(pattern), (match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export function nextTextMatch(current: number, direction: number, count: number): number {
  return count ? (current + direction + count) % count : 0;
}
