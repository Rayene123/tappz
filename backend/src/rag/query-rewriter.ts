// src/rag/query-rewriter.ts

import { generateText } from '../utils/llm';

/**
 * Rewrites a user query to be self-contained using conversation history.
 */
export async function rewriteQuery(query: string, history: string[]): Promise<string> {
  const prompt = `
Rewrite the following user query to be self-contained, using the conversation history for context.

Conversation:
${history.join('\n')}

Query:
${query}

Rewritten Query:
`;
  return (await generateText(prompt)).trim();
}