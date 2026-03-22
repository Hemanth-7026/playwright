/**
 * Lightweight fuzzy string matching.
 *
 * Uses a normalized Levenshtein distance so callers get a 0–1 similarity
 * score without pulling in heavy external dependencies.
 */
export function fuzzyMatch(input: string, pattern: string): number {
  const a = input.toLowerCase();
  const b = pattern.toLowerCase();

  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  // Substring containment gets a high score
  if (a.includes(b) || b.includes(a))
    return 0.9;

  // Normalized Levenshtein
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
      );
    }
  }

  const maxLen = Math.max(a.length, b.length);
  return 1 - matrix[a.length][b.length] / maxLen;
}

/** Returns true if the input fuzzy-matches any pattern above the threshold. */
export function matchesAny(
    input: string,
    patterns: string[],
    threshold: number,
): { matched: boolean; bestScore: number; bestPattern: string } {
  let bestScore = 0;
  let bestPattern = '';
  for (const pattern of patterns) {
    const score = fuzzyMatch(input, pattern);
    if (score > bestScore) {
      bestScore = score;
      bestPattern = pattern;
    }
  }
  return { matched: bestScore >= threshold, bestScore, bestPattern };
}
