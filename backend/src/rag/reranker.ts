import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { ChunkPayload } from '../ingest/vector-store';
import { logger } from '../utils/logger';

/**
 * Two-stage retrieval: LLM re-ranks candidate chunks and returns top-K most relevant.
 * This significantly improves precision over pure vector similarity.
 */
export async function rerankChunks(
  query: string,
  chunks: ChunkPayload[],
  topK = 5,
): Promise<ChunkPayload[]> {
  if (chunks.length <= topK) return chunks;

  const prompt = `You are a relevance judge. Given a user query and candidate document chunks, select the ${topK} most relevant chunk indices.

Query: "${query}"

Chunks:
${chunks.map((c, i) => `[${i}] (${c.sourceTitle} — ${c.section}): ${c.text.slice(0, 200)}...`).join('\n\n')}

Return ONLY a comma-separated list of the ${topK} best indices (e.g., "0,3,5,1,7"). No explanation.`;

  try {
    const { text } = await generateText({
      model: google('gemini-2.0-flash'),
      prompt,
      maxTokens: 50,
    });

    const indices = text
      .match(/\d+/g)
      ?.map(Number)
      .filter((i) => i >= 0 && i < chunks.length)
      .slice(0, topK) ?? [];

    if (indices.length === 0) {
      logger.warn('Reranker returned no valid indices, using original order');
      return chunks.slice(0, topK);
    }

    return indices.map((i) => chunks[i]!);
  } catch (err) {
    logger.error('Reranker failed, falling back to original order:', err);
    return chunks.slice(0, topK);
  }
}