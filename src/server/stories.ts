const STOP_WORDS = new Set([
  "ali", "ampak", "bo", "bodo", "da", "do", "je", "in", "iz", "ki", "na", "nad", "ne", "od", "ob", "po", "pod", "pri", "se", "so", "sta", "smo", "ste", "ter", "to", "v", "za",
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "was", "were", "with",
]);
const MATCH_THRESHOLD = 0.55;
const MIN_SHARED_TOKENS = 2;

function tokens(title: string): Set<string> {
  const normalized = title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sl-SI");

  return new Set(
    normalized
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((token) => token.length >= 3 && !STOP_WORDS.has(token)) ?? [],
  );
}

export function headlineSimilarity(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return (2 * shared) / (leftTokens.size + rightTokens.size);
}

export interface StoryCandidate {
  id: string;
  title: string;
}

export interface StoryMatch extends StoryCandidate {
  score: number;
}

export function findStoryMatch(title: string, candidates: StoryCandidate[]): StoryMatch | null {
  const incoming = tokens(title);
  if (!incoming.size) return null;

  const matches = candidates.flatMap((candidate, index) => {
    const existing = tokens(candidate.title);
    let shared = 0;
    for (const token of incoming) {
      if (existing.has(token)) shared += 1;
    }
    const score = existing.size ? (2 * shared) / (incoming.size + existing.size) : 0;
    return shared >= MIN_SHARED_TOKENS && score >= MATCH_THRESHOLD
      ? [{ ...candidate, score, index }]
      : [];
  });

  matches.sort((left, right) => right.score - left.score || left.index - right.index);
  const best = matches[0];
  if (!best) return null;
  const { index: _index, ...match } = best;
  return match;
}
