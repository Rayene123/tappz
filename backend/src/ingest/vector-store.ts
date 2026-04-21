
import axios from 'axios';
import process = require('zod/v4/core');
import core = require('zod/v4/core');

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const COLLECTION = core.process.env.QDRANT_COLLECTION || 'countries';

/**
 * Upserts a chunk and its embedding into Qdrant.
 */
export async function upsertChunk(
  chunk: { text: string; chunkIndex: number; section: string; sourceTitle: string },
  embedding: number[]
) {
  await axios.put(`${QDRANT_URL}/collections/${COLLECTION}/points`, {
    points: [
      {
        id: `${chunk.sourceTitle}-${chunk.chunkIndex}`,
        vector: embedding,
        payload: {
          text: chunk.text,
          chunkIndex: chunk.chunkIndex,
          section: chunk.section,
          sourceTitle: chunk.sourceTitle,
        },
      },
    ],
  });
}