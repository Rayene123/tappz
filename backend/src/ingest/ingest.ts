import { chunkDocument } from './chunker';
import { embedBatch } from './embedder';
import { upsertChunk, ensureCollection, ChunkPayload } from './vector-store';
import { logger } from '../utils/logger';

export interface DocumentSection {
  section: string;
  text: string;
}

export interface Document {
  title: string;
  sourceType: string;
  sections: DocumentSection[];
}

/**
 * Full ingestion pipeline: chunk → embed (batch) → upsert.
 * Uses batch embedding for efficiency.
 */
export async function ingestDocuments(docs: Document[]): Promise<void> {
  await ensureCollection();

  let totalChunks = 0;

  for (const doc of docs) {
    logger.info(`Ingesting: ${doc.title}`);

    // Collect all chunks from all sections
    const allChunks: ChunkPayload[] = [];
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

    // Batch embed all chunks for this document
    const texts = allChunks.map((c) => c.text);
    const embeddings = await embedBatch(texts);

    // Upsert all chunks
    for (let i = 0; i < allChunks.length; i++) {
      await upsertChunk(allChunks[i]!, embeddings[i]!);
    }

    totalChunks += allChunks.length;
    logger.info(`  → ${allChunks.length} chunks ingested`);
  }

  logger.info(`✅ Ingestion complete. Total chunks: ${totalChunks}`);
}