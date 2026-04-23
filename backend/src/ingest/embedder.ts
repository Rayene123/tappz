import { FlagEmbedding, EmbeddingModel } from 'fastembed';

let model: FlagEmbedding | null = null;

async function getModel() {
  if (!model) {
    model = await FlagEmbedding.init({
      model: EmbeddingModel.BGESmallENV15,
    });
  }
  return model;
}

/**
 * Single embedding
 */
export async function embedText(text: string): Promise<number[]> {
  const m = await getModel();

  const generator = await m.embed([text]);

  for await (const batch of generator) {
    if (!batch?.[0]) {
      throw new Error('Empty embedding result');
    }
    return batch[0];
  }

  throw new Error('Embedding failed');
}
/**
 * Batch embeddings
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const m = await getModel();

  const generator = await m.embed(texts);

  const results: number[][] = [];

  for await (const batch of generator) {
    for (const emb of batch) {
      results.push(emb);
    }
  }

  if (results.length !== texts.length) {
    throw new Error(
      `Embedding mismatch: expected ${texts.length}, got ${results.length}`
    );
  }

  return results;
}