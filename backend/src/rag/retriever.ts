import { embedText } from '../ingest/embedder';
import { searchChunks, ChunkPayload } from '../ingest/vector-store';

/**
 * Retrieves top-K relevant chunks from Qdrant for a query.
 * Fetches more than needed (topK * 2) for re-ranking.
 */
export async function retrieveChunks(query: string, topK = 5): Promise<ChunkPayload[]> {
  const embedding = await embedText(query);
  // Fetch 2x for re-ranking headroom
  const results = await searchChunks(embedding, topK * 2);
  return results;
}