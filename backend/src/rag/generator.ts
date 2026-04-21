import { streamText, generateObject, StreamTextResult } from 'ai';
import { google } from '@ai-sdk/google';
import { CitationSchema } from '../schemas/citation.schema';
import { ChunkPayload } from '../ingest/vector-store';
import { Message } from '../memory/memory.service';

const model = google('gemini-2.0-flash');

export interface GenerateOptions {
  query: string;
  context: string;
  history: Message[];
  systemPrompt: string;
}

export function streamAnswer({ query, context, history, systemPrompt }: GenerateOptions): StreamTextResult<Record<string, never>, string> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...history,
    {
      role: 'user' as const,
      content: `Context:\n${context}\n\nQuestion: ${query}`,
    },
  ];

  return streamText({
    model,
    system: systemPrompt,
    messages,
    maxTokens: 1024,
    temperature: 0.2,
  }) as StreamTextResult<Record<string, never>, string>;
}

export async function generateCitations(
  answer: string,
  chunks: ChunkPayload[],
  query: string,
) {
  const { object } = await generateObject({
    model,
    schema: CitationSchema,
    prompt: `Given this answer and source chunks, extract citations that were actually used.

Answer: ${answer}

Available sources (only include ones referenced in the answer):
${chunks.map((c, i) => `[${i + 1}] ${c.sourceTitle} — ${c.section}: ${c.text.slice(0, 150)}`).join('\n')}

Return only citations that appear as [N] in the answer above.`,
  });

  return object;
}