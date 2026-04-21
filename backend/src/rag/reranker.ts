// src/rag/reranker.ts

import { generateText } from '../utils/llm';

/**
 * Uses LLM to select the top 3 most relevant chunks for the query.
 */
export async function rerankChunks(query: string, chunks: any[]): Promise<any[]> {
  const prompt = `
Select the 3 most relevant chunks for answering the query.

Query: ${query}

Chunks:
${chunks.map((c, i) => `[${i}] ${c.text}`).join('\n')}

Return the indexes of the best 3 chunks as a comma-separated list (e.g., 0,2,4):
`;
  const result = await generateText(prompt);
  const indexes = result.match(/\d+/g)?.map(Number) || [];
  return indexes.map(i => chunks[i]);
}