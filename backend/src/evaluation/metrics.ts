export interface CitationMetrics {
  hasCitations: boolean;
  citationCount: number;
  sourcesMatch: boolean;
  accuracy: number; // 0.0–1.0
}

/**
 * Programmatically checks citation accuracy:
 * 1. Are citations present in the answer? ([1], [2], etc.)
 * 2. Do cited source titles match expected sources?
 */
export function checkCitationAccuracy(
  answer: string,
  citations: Array<{ id: number; sourceTitle: string; excerpt: string }>,
  expectedSources: string[],
): CitationMetrics {
  // Check for inline citation markers [N]
  const inlineRefs = answer.match(/\[\d+\]/g) ?? [];
  const hasCitations = inlineRefs.length > 0;
  const citationCount = inlineRefs.length;

  if (expectedSources.length === 0) {
    // Out-of-scope question — should have NO citations
    return {
      hasCitations,
      citationCount,
      sourcesMatch: !hasCitations,
      accuracy: hasCitations ? 0.5 : 1.0,
    };
  }

  if (!hasCitations || citations.length === 0) {
    return {
      hasCitations: false,
      citationCount: 0,
      sourcesMatch: false,
      accuracy: 0.0,
    };
  }

  // Check how many expected sources appear in the citations
  const citedTitles = citations.map((c) => c.sourceTitle.toLowerCase());
  const matchedSources = expectedSources.filter((src) =>
    citedTitles.some((title) => title.includes(src.toLowerCase())),
  );

  const sourcesMatch = matchedSources.length === expectedSources.length;
  const accuracy = expectedSources.length > 0
    ? matchedSources.length / expectedSources.length
    : 1.0;

  return {
    hasCitations,
    citationCount,
    sourcesMatch,
    accuracy: Math.min(1.0, accuracy),
  };
}