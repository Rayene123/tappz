/**
 * Formats chunks for LLM context with citation IDs.
 */
export function buildContext(chunks: any[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] ${c.text}`)
    .join('\n\n');
}