export interface CitationMetrics {
  hasCitations: boolean;
  citationCount: number;
  sourcesMatch: boolean;
  accuracy: number; // 0.0–1.0
}

interface Citation {
  id: number;
  sourceTitle: string;
  excerpt: string;
}

/**
 * Normalize text for robust matching
 */
function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Robust citation accuracy checker for RAG evaluation
 */
export function checkCitationAccuracy(
  answer: string,
  citations: any[],
  expectedSources: string[],
): CitationMetrics {

  // extract [1], [2] citations
  const inlineRefs = [...answer.matchAll(/\[(\d+)\]/g)];
  const hasCitations = inlineRefs.length > 0;
  const citationCount = inlineRefs.length;

  const citedTitles = citations.map((c) => normalize(c.sourceTitle));
  const expected = expectedSources.map(normalize);

  // ─────────────────────────────
  // OUT OF SCOPE CASE
  // ─────────────────────────────
  if (expectedSources.length === 0) {
    return {
      hasCitations,
      citationCount,
      sourcesMatch: !hasCitations,
      accuracy: hasCitations ? 0.5 : 1.0,
    };
  }

  // ─────────────────────────────
  // NO CITATIONS
  // ─────────────────────────────
  if (!hasCitations || citations.length === 0) {
    return {
      hasCitations: false,
      citationCount: 0,
      sourcesMatch: false,
      accuracy: 0.0,
    };
  }

  // ─────────────────────────────
  // MATCHING LOGIC (FIXED)
  // ─────────────────────────────
  const matchedSources = expected.filter((src) =>
    citedTitles.some((title) => title.includes(src)),
  );

  const accuracy =
    expected.length > 0
      ? matchedSources.length / expected.length
      : 1.0;

  return {
    hasCitations,
    citationCount,
    sourcesMatch: matchedSources.length === expected.length,
    accuracy: Math.min(1, accuracy),
  };
}
