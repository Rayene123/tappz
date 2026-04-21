import { google } from '@ai-sdk/google';
import { embedMany, embed } from 'ai';

const embeddingModel = google.textEmbeddingModel('text-embedding-004');

/**
 * Generates an embedding for a single text string.
 */
export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel,
    value: text,
  });
  return embedding;
}

/**
 * Generates embeddings for multiple texts in a single batch call.
 * More efficient for ingestion pipelines.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
  });
  return embeddings;
}