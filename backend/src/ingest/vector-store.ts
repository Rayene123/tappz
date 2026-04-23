import { QdrantClient } from '@qdrant/js-client-rest';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
export const COLLECTION = process.env.QDRANT_COLLECTION || 'countries';

/**
 * DO NOT hardcode vector size anymore.
 * It will be inferred from first embedding.
 */
let VECTOR_SIZE: number | null = null;

let _client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!_client) {
    _client = new QdrantClient({ url: QDRANT_URL });
  }
  return _client;
}

/**
 * Ensures the Qdrant collection exists, creates it if not.
 * IMPORTANT: VECTOR_SIZE must be initialized before calling this.
 */
export async function ensureCollection(): Promise<void> {
  const client = getQdrantClient();
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);

  if (!exists) {
    if (!VECTOR_SIZE) {
      throw new Error(
        'VECTOR_SIZE is not initialized. Call initVectorSize() before ensureCollection().'
      );
    }

    await client.createCollection(COLLECTION, {
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine',
      },
    });

    console.log(`✅ Created Qdrant collection: ${COLLECTION}`);
  }
}

/**
 * Call this ONCE before ingestion starts
 */
export function initVectorSize(embedding: number[] | Float32Array) {
  VECTOR_SIZE = Array.from(embedding).length;
}

/**
 * Normalize embedding into safe number[]
 */
function normalizeVector(vec: number[] | Float32Array): number[] {
  return Array.from(vec).map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`Invalid embedding value detected: ${v}`);
    }
    return v;
  });
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
 */
export async function upsertChunk(
  chunk: ChunkPayload,
  embedding: number[] | Float32Array,
): Promise<void> {
  const client = getQdrantClient();

  const vector = normalizeVector(embedding);

  if (!VECTOR_SIZE) {
    VECTOR_SIZE = vector.length;
  }

  if (VECTOR_SIZE !== vector.length) {
    throw new Error(
      `Embedding dimension mismatch. Expected ${VECTOR_SIZE}, got ${vector.length}`
    );
  }

  const id = stringToUUID(`${chunk.sourceTitle}-${chunk.chunkIndex}`);

  await client.upsert(COLLECTION, {
    wait: true,
    points: [
      {
        id,
        vector,
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
 * Searches Qdrant for top-K similar chunks.
 */
export async function searchChunks(
  embedding: number[] | Float32Array,
  topK: number = 10,
): Promise<(ChunkPayload & { score: number })[]> {
  const client = getQdrantClient();

  const vector = normalizeVector(embedding);

  const result = await client.search(COLLECTION, {
    vector,
    limit: topK,
    with_payload: true,
  });

  console.log(
    result.map(r => ({
      title: r.payload?.sourceTitle,
      score: r.score,
    }))
  );
  
  return result
    .map((r) => {
      const p = r.payload as any;

      if (
        !p ||
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

        // 🔥 THIS IS THE CRITICAL FIX
        score: r.score,
      };
    })
    .filter(Boolean) as (ChunkPayload & { score: number })[];
}

function toChunkPayload(payload: unknown): ChunkPayload | null {
  if (!payload || typeof payload !== 'object') return null;

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
 * Simple deterministic UUID generator
 */
function stringToUUID(input: string): string {
  let hash = 5381;

  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) + hash + input.charCodeAt(i);
    hash = hash & hash;
  }

  const h = Math.abs(hash).toString(16).padStart(8, '0');

  return `${h.slice(0, 8)}-${h.slice(0, 4)}-4${h.slice(1, 4)}-a${h.slice(
    2,
    5,
  )}-${h.padEnd(12, '0').slice(0, 12)}`;
}