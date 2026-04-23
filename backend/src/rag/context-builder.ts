import { ChunkPayload } from '../ingest/vector-store.js';

export function buildContext(chunks: ChunkPayload[]): string {
  if (!chunks.length) return '';

  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.sourceTitle} | ${c.section}\n${c.text}`,
    )
    .join('\n');
}
