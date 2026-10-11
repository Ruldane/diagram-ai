/**
 * Matching for the command palette. Deliberately not fuzzy: scattered-letter
 * matches ("data" finding "Distribute horizontally") bury the result the
 * person is after, so every word typed has to start a word of the candidate
 * or, from three letters on, appear inside one.
 */

const SEPARATORS = /[\s\-_/.,:;!?()[\]{}"'“”‘’…]+/;
const MIN_INFIX_LENGTH = 3;

const words = (text: string): string[] => text.toLowerCase().split(SEPARATORS).filter(Boolean);

function wordScore(token: string, candidates: string[]): number {
  let best = 0;
  candidates.forEach((word, index) => {
    let score = 0;
    if (word === token) score = 1;
    else if (word.startsWith(token)) score = 0.8;
    else if (token.length >= MIN_INFIX_LENGTH && word.includes(token)) score = 0.4;
    // A match on the leading word reads as more intentional ("al" → "Align left" before "Select all").
    if (score && index === 0) score += 0.1;
    best = Math.max(best, score);
  });
  return best;
}

/**
 * How well `text` answers `search`: 0 when it does not, higher is better.
 * `keywords` (a category, aliases) also match, but count for half.
 */
export function matchScore(search: string, text: string, keywords: string[] = []): number {
  if (!search.trim()) return 1;
  const tokens = words(search);
  if (tokens.length === 0) return 0;
  const own = words(text);
  const extra = keywords.flatMap(words);
  let total = 0;
  for (const token of tokens) {
    const score = wordScore(token, own) || wordScore(token, extra) / 2;
    if (!score) return 0;
    total += score;
  }
  return total / tokens.length;
}

export interface Ranked<T> {
  item: T;
  score: number;
}

/** The items that match, best first; equal scores keep their original order. */
export function rank<T>(items: readonly T[], search: string, text: (item: T) => string, keywords?: (item: T) => string[]): Ranked<T>[] {
  const matches: Ranked<T>[] = [];
  for (const item of items) {
    const score = matchScore(search, text(item), keywords?.(item));
    if (score > 0) matches.push({ item, score });
  }
  return matches.sort((a, b) => b.score - a.score);
}
