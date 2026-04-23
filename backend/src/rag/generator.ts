import { streamText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { CitationSchema } from '../schemas/citation.schema.js';
import { ChunkPayload } from '../ingest/vector-store.js';
import { Message } from '../memory/memory.service.js';
import { z } from 'zod';

const model = google('gemini-2.5-flash');

export interface GenerateOptions {
  query: string;
  context: string;
  history: Message[];
  systemPrompt: string;
}

export function streamAnswer({ query, context, history, systemPrompt }: GenerateOptions) {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history,
    {
      role: 'user',
      content: `Context:\n${context}\n\nQuestion: ${query}`,
    },
  ];

  return streamText({
    model,
    system: systemPrompt,
    messages,
    maxTokens: 1024,
    temperature: 0.2,
  });
}

export async function generateCitations(
  answer: string,
  chunks: ChunkPayload[],
  query: string,
): Promise<z.infer<typeof CitationSchema>> {
  const { object } = await generateObject({
    model,
    schema: CitationSchema,
    prompt: `Given this answer and source chunks, extract citations that were actually used.

Answer: ${answer}

User query: ${query}

Available sources (only include ones referenced in the answer):
${chunks
  .map(
    (c, i) =>
      `[${i + 1}] ${c.sourceTitle} — ${c.section}: ${c.text.slice(0, 150)}`
  )
  .join('\n')}

Return only citations that appear as [N] in the answer above.`,
  });

  // Runtime validation (prevents silent bad LLM output)
  return CitationSchema.parse(object);
}