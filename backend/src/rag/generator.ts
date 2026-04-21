// src/rag/generator.ts

import { streamText } from 'ai'; // Vercel AI SDK
import core = require('zod/v4/core');

/**
 * Streams an answer from the LLM using context and prompt.
 */
export function streamAnswer({ query, context, history, systemPrompt }) {
  return streamText({
    model: core.process.env.LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion:\n${query}`,
      },
    ],
  });
}