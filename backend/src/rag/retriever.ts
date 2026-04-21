// src/rag/retriever.ts

import { embedText } from '../ingest/embedder';
import axios from 'axios';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = process.env.QDRANT_COLLECTION || 'countries';

/**
 * Retrieves top-K relevant chunks from Qdrant for a query.
 */
export async function retrieveChunks(query: string, topK = 10) {
  const embedding = await embedText(query);
  const response = await axios.post(`${QDRANT_URL}/collections/${COLLECTION}/points/search`, {
    vector: embedding,
    limit: topK,
    with_payload: true,
  });
  return response.data.result.map((item: any) => ({
    ...item.payload,
    id: item.id,
  }));
}