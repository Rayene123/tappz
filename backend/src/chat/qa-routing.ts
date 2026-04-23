import { ChunkPayload } from '../ingest/vector-store.js';

export type QueryIntent =
  | 'general_knowledge'
  | 'rag_lookup'
  | 'comparison'
  | 'follow_up';

export interface RetrievedChunk extends ChunkPayload {
  score: number;
  keywordScore: number;
  relevanceScore: number;
}

export interface RetrievalAssessment {
  useContext: boolean;
  isStrong: boolean;
  topScore: number;
  averageScore: number;
  sourceDiversity: number;
}

const STOPWORDS = new Set([
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'the', 'a', 'an', 'of',
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'about', 'tell', 'me', 'and',
  'to', 'in', 'its', 'that', 'this', 'these', 'those', 'compare', 'like',
  'country', 'countries', 'african',
  'major', 'practiced', 'practice', 'east', 'west', 'north', 'south',
]);

const GENERAL_KNOWLEDGE_PATTERNS = [
  /^what is \d+\s*[\+\-\*\/]\s*\d+\??$/i,
  /^who is /i,
  /^when is /i,
  /^what is the capital of /i,
  /^define /i,
];

const FOLLOW_UP_PATTERNS = [
  /\b(it|its|they|them|their|there|that|those|these)\b/i,
  /^(what about|how about|how does that compare|compare that|and what about)/i,
];

const COMPARISON_PATTERNS = [
  /\bcompare\b/i,
  /\bcomparison\b/i,
  /\bhow does\b.*\bcompare\b/i,
  /\bwhich\b.*\bversus\b/i,
  /\bdifference between\b/i,
];

function countDistinctSources(chunks: RetrievedChunk[]): number {
  return new Set(chunks.map((chunk) => chunk.sourceTitle)).size;
}

function stem(term: string): string {
  if (term.endsWith('ies') && term.length > 4) {
    return `${term.slice(0, -3)}y`;
  }

  if (term.endsWith('s') && term.length > 4) {
    return term.slice(0, -1);
  }

  return term;
}

export function classifyIntent(
  query: string,
  hasHistory: boolean,
  collectionName?: string,
): QueryIntent {
  if (hasHistory && FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(query))) {
    return 'follow_up';
  }

  if (COMPARISON_PATTERNS.some((pattern) => pattern.test(query))) {
    return 'comparison';
  }

  const lower = query.toLowerCase();

  if (
    GENERAL_KNOWLEDGE_PATTERNS.some((pattern) => pattern.test(query)) &&
    !lower.includes((collectionName ?? '').toLowerCase())
  ) {
    return 'general_knowledge';
  }

  return 'rag_lookup';
}

export function assessRetrieval(chunks: RetrievedChunk[]): RetrievalAssessment {
  if (chunks.length === 0) {
    return {
      useContext: false,
      isStrong: false,
      topScore: 0,
      averageScore: 0,
      sourceDiversity: 0,
    };
  }

  const topScore = chunks[0]?.relevanceScore ?? 0;
  const averageScore =
    chunks.reduce((sum, chunk) => sum + chunk.relevanceScore, 0) / chunks.length;
  const sourceDiversity = countDistinctSources(chunks);
  const isStrong = topScore >= 0.55 || averageScore >= 0.45;
  const useContext = isStrong || sourceDiversity >= 2;

  return {
    useContext,
    isStrong,
    topScore,
    averageScore,
    sourceDiversity,
  };
}

export function hasRelevantContextSignal(
  query: string,
  chunks: RetrievedChunk[],
): boolean {
  if (chunks.length === 0) return false;

  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(stem)
    .filter((term) => term.length > 3 && !STOPWORDS.has(term));

  if (queryTerms.length === 0) return true;

  const entityTerms = new Set(
    chunks
      .flatMap((chunk) =>
        chunk.sourceTitle
          .toLowerCase()
          .split(/\s+/)
          .map((term) => stem(term.replace(/[^a-z0-9]/g, '')))
          .filter((term) => term.length > 2),
      ),
  );

  const attributeTerms = queryTerms.filter((term) => !entityTerms.has(term));
  const normalizedQuery = query.toLowerCase();
  const explicitEntityChunks = chunks.filter((chunk) =>
    normalizedQuery.includes(chunk.sourceTitle.toLowerCase()),
  );

  const combined = chunks
    .slice(0, 4)
    .map((chunk) => `${chunk.sourceTitle} ${chunk.section} ${chunk.text}`.toLowerCase())
    .join(' ');

  const termsToCheck = attributeTerms.length > 0 ? attributeTerms : queryTerms;
  const matched = termsToCheck.filter((term) => combined.includes(term));

  if (attributeTerms.length > 0) {
    if (explicitEntityChunks.length > 0) {
      const explicitSources = new Set(explicitEntityChunks.map((chunk) => chunk.sourceTitle));
      const matchedSources = new Set(
        explicitEntityChunks
          .filter((chunk) => {
            const chunkText = `${chunk.section} ${chunk.text}`.toLowerCase();
            return attributeTerms.some((term) => chunkText.includes(term));
          })
          .map((chunk) => chunk.sourceTitle),
      );

      const requiredMatches = explicitSources.size > 1 ? 2 : 1;
      return matchedSources.size >= requiredMatches;
    }

    return matched.length >= Math.max(2, Math.ceil(attributeTerms.length / 2));
  }

  return matched.length / termsToCheck.length >= 0.4;
}

export function extractBestEntity(
  query: string,
  chunks: ChunkPayload[],
  previousEntity?: string,
): string | undefined {
  const sourceTitle = chunks[0]?.sourceTitle;
  if (sourceTitle) return sourceTitle;

  const titleCaseMatch = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g);
  if (titleCaseMatch?.length) {
    return titleCaseMatch[titleCaseMatch.length - 1];
  }

  return previousEntity;
}
