import { generateText } from 'ai';
import { mistral } from '@ai-sdk/mistral';
import { logger } from '../utils/logger.js';
import { RetrievedChunk } from '../chat/qa-routing.js';

const model = mistral('mistral-small-latest');

function safeJsonParse(text: string): any | null {
  try {
    const cleaned = text
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  topK = 5,
): Promise<RetrievedChunk[]> {
  if (chunks.length <= topK) return chunks;

  const prompt = `
You are a strict relevance ranking system.

Return ONLY valid JSON:
{ "indices": [0,1,2] }

Rules:
- No explanation
- No extra text
- Indices must be unique
- Indices must be valid (0 to ${chunks.length - 1})

Query:
${query}

Chunks:
${chunks
  .map(
    (c, i) =>
      `[${i}] ${c.sourceTitle} - ${c.section}: ${c.text.slice(0, 200)}`,
  )
  .join('\n\n')}
`;

  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0,
      maxOutputTokens: 120,
      system: 'Return ONLY valid JSON.',
    });

    const parsed = safeJsonParse(text);

    if (!parsed?.indices || !Array.isArray(parsed.indices)) {
      logger.warn('Reranker invalid JSON output, fallback used');
      return chunks.slice(0, topK);
    }

    const indices = parsed.indices
      .filter((i: unknown) => Number.isInteger(i))
      .filter((i: number) => i >= 0 && i < chunks.length)
      .slice(0, topK);

    if (indices.length === 0) {
      logger.warn('Reranker returned empty indices, fallback used');
      return chunks.slice(0, topK);
    }

    return indices.map((i: number) => chunks[i]!);
  } catch (err) {
    logger.error('Reranker failed:', err);
    return chunks.slice(0, topK);
  }
}
