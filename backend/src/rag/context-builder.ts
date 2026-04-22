import { ChunkPayload } from '../ingest/vector-store';

/**
 * Formats retrieved chunks into a numbered context string for the LLM.
 * Each chunk gets a citation ID [N] that the model references in its answer.
 */
export function buildContext(chunks: ChunkPayload[]): string {
  if (chunks.length === 0) {
    return 'No relevant context found.';
  }

  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] Source: ${c.sourceTitle} (${c.section})\n${c.text}`,
    )
    .join('\n\n---\n\n');
}