import { chunkDocument } from './chunker';
import { embedText } from './embedder';
import { upsertChunk } from './vector-store';

/**
 * Ingests an array of documents into Qdrant.
 */
export async function ingestDocuments(docs: { title: string; sections: { section: string; text: string }[] }[]) {
  for (const doc of docs) {
    for (const sec of doc.sections) {
      const chunks = chunkDocument(sec.text, sec.section);
      for (const chunk of chunks) {
        const embedding = await embedText(chunk.text);
        await upsertChunk(
          { ...chunk, sourceTitle: doc.title },
          embedding
        );
      }
    }
  }
}