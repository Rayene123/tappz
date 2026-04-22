export interface Chunk {
  text: string;
  chunkIndex: number;
  section: string;
}

const MAX_TOKENS = 200;
const OVERLAP_TOKENS = 50;

/**
 * Splits a document section into overlapping chunks.
 * Strategy: paragraph-aware splitting with token-based size limit.
 * Overlap ensures context continuity at chunk boundaries.
 */
export function chunkDocument(text: string, section: string): Chunk[] {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const chunks: Chunk[] = [];
  let buffer: string[] = [];
  let tokenCount = 0;
  let chunkIndex = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i]!;
    const paraTokens = countTokens(para);

    // If a single paragraph exceeds limit, split it by sentences
    if (paraTokens > MAX_TOKENS) {
      const sentences = para.match(/[^.!?]+[.!?]+/g) ?? [para];
      for (const sentence of sentences) {
        buffer.push(sentence.trim());
        tokenCount += countTokens(sentence);
        if (tokenCount >= MAX_TOKENS) {
          chunks.push({ text: buffer.join(' '), chunkIndex, section });
          chunkIndex++;
          buffer = applyOverlap(buffer);
          tokenCount = countTokens(buffer.join(' '));
        }
      }
      continue;
    }

    buffer.push(para);
    tokenCount += paraTokens;

    if (tokenCount >= MAX_TOKENS || i === paragraphs.length - 1) {
      if (buffer.length > 0) {
        chunks.push({ text: buffer.join('\n\n'), chunkIndex, section });
        chunkIndex++;
        buffer = applyOverlap(buffer);
        tokenCount = countTokens(buffer.join('\n\n'));
      }
    }
  }

  // Flush remaining
  if (buffer.length > 0 && tokenCount > 10) {
    chunks.push({ text: buffer.join('\n\n'), chunkIndex, section });
  }

  return chunks;
}

function countTokens(text: string): number {
  return text.split(/\s+/).length;
}

function applyOverlap(buffer: string[]): string[] {
  // Keep the last few items that sum to ~OVERLAP_TOKENS
  const overlap: string[] = [];
  let tokens = 0;
  for (let i = buffer.length - 1; i >= 0 && tokens < OVERLAP_TOKENS; i--) {
    overlap.unshift(buffer[i]!);
    tokens += countTokens(buffer[i]!);
  }
  return overlap;
}