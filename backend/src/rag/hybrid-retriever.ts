import { embedText } from '../ingest/embedder.js';
import { searchChunks } from '../ingest/vector-store.js';
import { RetrievedChunk } from '../chat/qa-routing.js';

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function keywordScore(text: string, query: string): number {
  const words = query.toLowerCase().split(' ');
  const t = text.toLowerCase();

  let score = 0;

  for (const w of words) {
    if (w.length > 2 && t.includes(w)) {
      score += 1;
    }
  }

  return score;
}

function sourceTitleBoost(sourceTitle: string, query: string): number {
  const normalizedQuery = ` ${normalize(query)} `;
  const normalizedTitle = normalize(sourceTitle);

  if (!normalizedTitle) return 0;
  if (normalizedQuery.includes(` ${normalizedTitle} `)) return 1;

  const titleTokens = normalizedTitle.split(' ').filter((token) => token.length > 3);
  if (titleTokens.length > 0 && titleTokens.every((token) => normalizedQuery.includes(token))) {
    return 0.5;
  }

  return 0;
}

export async function retrieveChunks(query: string, topK = 5) {
  const embedding = await embedText(query);

  // 🔥 increase recall massively
  const rawResults = await searchChunks(embedding, topK * 15);

  if (!rawResults?.length) return [];

  // ❌ NO HARD FILTER (this was killing your system)
  const scored = rawResults.map((chunk): RetrievedChunk => {
    const vectorScore = chunk.score ?? 0;
    const keyword = keywordScore(chunk.text, query);

    const normalizedKeyword =
      keyword / Math.max(query.split(' ').length, 1);
    const titleBoost = sourceTitleBoost(chunk.sourceTitle, query);

    const finalScore =
      vectorScore * 0.45 + normalizedKeyword * 0.2 + titleBoost * 0.35;

    return {
      text: chunk.text,
      chunkIndex: chunk.chunkIndex,
      section: chunk.section,
      sourceTitle: chunk.sourceTitle,
      sourceType: chunk.sourceType,
      score: vectorScore,
      keywordScore: normalizedKeyword,
      relevanceScore: finalScore,
    };
  });

  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return scored.slice(0, topK);
}
