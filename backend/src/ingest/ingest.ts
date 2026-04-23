import {
  chunkDocument,
} from './chunker.js';

import {
  embedBatch,
} from './embedder.js';

import {
  upsertChunk,
  ensureCollection,
  initVectorSize,
  ChunkPayload,
} from './vector-store.js';

import { logger } from '../utils/logger.js';

export interface DocumentSection {
  section: string;
  text: string;
}

export interface Document {
  title: string;
  sourceType: string;
  sections: DocumentSection[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const BATCH_SIZE = 8;

/**
 * Full ingestion pipeline: chunk → embed → upsert
 */
export async function ingestDocuments(docs: Document[]): Promise<void> {
  let totalChunks = 0;

  logger.info(`🚀 Starting ingestion of ${docs.length} documents`);

  // STEP 1: collect ALL chunks first
  const allChunks: ChunkPayload[] = [];

  for (const doc of docs) {
    logger.info(`Ingesting: ${doc.title}`);

    for (const sec of doc.sections) {
      const chunks = chunkDocument(sec.text, sec.section);

      for (const chunk of chunks) {
        allChunks.push({
          ...chunk,
          sourceTitle: doc.title,
          sourceType: doc.sourceType,
        });
      }
    }
  }

  logger.info(`📦 Total chunks generated: ${allChunks.length}`);

  if (allChunks.length === 0) {
    throw new Error('No chunks generated');
  }

  // STEP 2: init vector size using MULTIPLE samples (IMPORTANT FIX)
  const sampleTexts = allChunks.slice(0, 5).map((c) => c.text);
  const sampleEmbeddings = await embedBatch(sampleTexts);

  if (!sampleEmbeddings?.length) {
    throw new Error('Embedding init failed');
  }

  initVectorSize(sampleEmbeddings[0]);

  // STEP 3: ensure collection
  await ensureCollection();

  logger.info(`🧠 Vector store initialized`);

  // STEP 4: embed in batches
  for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
    const batch = allChunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) =>
      `[${c.sourceTitle}] ${c.section}: ${c.text}`
    );

    const embeddings = await embedBatch(texts);

    await Promise.all(
      batch.map((chunk, idx) =>
        upsertChunk(chunk, embeddings[idx]!)
      )
    );

    logger.info(`   → indexed ${i + batch.length}/${allChunks.length}`);

    await sleep(50);
  }

  totalChunks = allChunks.length;

  logger.info(`✅ Ingestion complete. Total chunks: ${totalChunks}`);
}