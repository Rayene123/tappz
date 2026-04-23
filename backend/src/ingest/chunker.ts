export interface Chunk {
  text: string;
  chunkIndex: number;
  section: string;
}

const MAX_TOKENS = 180;
const OVERLAP_TOKENS = 60;

/**
 * Clean, stable paragraph-level chunking
 */
export function chunkDocument(text: string, section: string): Chunk[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: Chunk[] = [];

  let buffer: string[] = [];
  let tokenCount = 0;
  let chunkIndex = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = enrich(paragraphs[i]!, section);
    const paraTokens = countTokens(para);

    // If single paragraph too big → split by sentences
    if (paraTokens > MAX_TOKENS) {
      const sentences = para.split(/(?<=[.!?])\s+/);

      for (const sentence of sentences) {
        const enriched = enrich(sentence, section);
        const tokens = countTokens(enriched);

        buffer.push(enriched);
        tokenCount += tokens;

        if (tokenCount >= MAX_TOKENS) {
          chunks.push(makeChunk(buffer, section, chunkIndex++));
          buffer = getOverlap(buffer);
          tokenCount = countTokens(buffer.join(' '));
        }
      }

      continue;
    }

    buffer.push(para);
    tokenCount += paraTokens;

    if (tokenCount >= MAX_TOKENS) {
      chunks.push(makeChunk(buffer, section, chunkIndex++));
      buffer = getOverlap(buffer);
      tokenCount = countTokens(buffer.join(' '));
    }
  }

  if (buffer.length > 0) {
    chunks.push(makeChunk(buffer, section, chunkIndex));
  }

  return chunks;
}

/**
 * Adds semantic structure for embeddings
 */
function enrich(text: string, section: string): string {
  return `[SECTION: ${section}] ${text}`;
}

/**
 * Stable chunk builder
 */
function makeChunk(
  buffer: string[],
  section: string,
  index: number,
): Chunk {
  return {
    chunkIndex: index,
    section,
    text: buffer.join(' ').trim(),
  };
}

/**
 * Proper overlap (token-aware, stable)
 */
function getOverlap(buffer: string[]): string[] {
  const result: string[] = [];
  let tokens = 0;

  for (let i = buffer.length - 1; i >= 0; i--) {
    const t = countTokens(buffer[i]!);
    if (tokens + t > OVERLAP_TOKENS) break;

    result.unshift(buffer[i]!);
    tokens += t;
  }

  return result;
}

/**
 * Token estimator (simple but stable)
 */
function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}