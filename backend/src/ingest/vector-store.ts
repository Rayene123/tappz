import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
export const COLLECTION = process.env.QDRANT_COLLECTION || 'countries';
const VECTOR_SIZE = 3072; // text-embedding-001 (Google) dimension

let _client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({ url: QDRANT_URL });
  }
  return _client;
}

/**
 * Ensures the Qdrant collection exists, creates it if not.
 */
export async function ensureCollection(): Promise<void> {
  const client = getQdrantClient();
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);

  if (!exists) {
    await client.createCollection(COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine',
      },
    });
    console.log(`✅ Created Qdrant collection: ${COLLECTION}`);
  }
}

export interface ChunkPayload {
  text: string;
  chunkIndex: number;
  section: string;
  sourceTitle: string;
  sourceType: string;
}

/**
 * Upserts a chunk and its embedding into Qdrant.
 * Uses a deterministic string ID based on title+chunkIndex.
 */
export async function upsertChunk(chunk: ChunkPayload, embedding: number[]): Promise<void> {
  const client = getQdrantClient();
  // Qdrant requires numeric or UUID ids — use a hash
  const id = stringToUUID(`${chunk.sourceTitle}-${chunk.chunkIndex}`);

  await client.upsert(COLLECTION, {
    wait: true,
    points: [
      {
        id,
        vector: embedding,
        payload: {
          text: chunk.text,
          chunkIndex: chunk.chunkIndex,
          section: chunk.section,
          sourceTitle: chunk.sourceTitle,
          sourceType: chunk.sourceType,
        },
      },
    ],
  });
}

/**
 * Searches Qdrant for the top-K most similar vectors.
 */
export async function searchChunks(
  embedding: number[],
  topK: number = 10,
): Promise<ChunkPayload[]> {
  const client = getQdrantClient();
  const result = await client.search(COLLECTION, {
    vector: embedding,
    limit: topK,
    with_payload: true,
  });

  return result
    .map((r) => toChunkPayload(r.payload))
    .filter((payload): payload is ChunkPayload => payload !== null);
}

function toChunkPayload(payload: unknown): ChunkPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const p = payload as Record<string, unknown>;
  if (
    typeof p.text !== 'string' ||
    typeof p.chunkIndex !== 'number' ||
    typeof p.section !== 'string' ||
    typeof p.sourceTitle !== 'string' ||
    typeof p.sourceType !== 'string'
  ) {
    return null;
  }

  return {
    text: p.text,
    chunkIndex: p.chunkIndex,
    section: p.section,
    sourceTitle: p.sourceTitle,
    sourceType: p.sourceType,
  };
}

/**
 * Converts an arbitrary string to a deterministic UUID v5-like string.
 * Simple implementation using a hash.
 */
function stringToUUID(input: string): string {
  // Simple djb2 hash → format as UUID-like string
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash = hash & hash; // convert to 32-bit int
  }
  const h = Math.abs(hash).toString(16).padStart(8, '0');
  return `${h.slice(0, 8)}-${h.slice(0, 4)}-4${h.slice(1, 4)}-a${h.slice(2, 5)}-${h.padEnd(12, '0').slice(0, 12)}`;
}