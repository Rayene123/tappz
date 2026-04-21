/*
 * Splits a document into overlapping chunks by headings and paragraphs.
 * Adds section info for better retrieval and citation.
 */
function chunkDocument(
  text: string,
  section: string,
  overlap: number = 100
): { text: string; chunkIndex: number; section: string }[] {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const chunks: { text: string; chunkIndex: number; section: string }[] = [];
  let buffer: string[] = [];
  let tokenCount = 0;
  let chunkIndex = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    buffer.push(para);
    tokenCount += para.split(/\s+/).length;

    // If buffer exceeds ~200 tokens, create a chunk
    if (tokenCount >= 200 || i === paragraphs.length - 1) {
      chunks.push({
        text: buffer.join('\n\n'),
        chunkIndex,
        section,
      });
      // Overlap: keep last N tokens for next chunk
      const overlapParas = [];
      let overlapTokens = 0;
      for (let j = buffer.length - 1; j >= 0 && overlapTokens < overlap; j--) {
        overlapParas.unshift(buffer[j]);
        overlapTokens += buffer[j].split(/\s+/).length;
      }
      buffer = [...overlapParas];
      tokenCount = overlapTokens;
      chunkIndex++;
    }
  }
  return chunks;
}

module.exports = { chunkDocument };