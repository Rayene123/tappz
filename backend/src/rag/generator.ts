import { generateObject, generateText, streamText } from 'ai';
import { mistral } from '@ai-sdk/mistral';
import { Message } from '../memory/memory.service.js';
import { CitationSchema } from '../schemas/citation.schema.js';
import { z } from 'zod';
import { ChunkPayload } from '../ingest/vector-store.js';

const model = mistral('mistral-small-latest');

export type AnswerMode = 'general' | 'rag' | 'mixed';

export interface GenerateOptions {
  query: string;
  context: string;
  history: Message[];
  systemPrompt: string;
  mode: AnswerMode;
  requireComparisonSynthesis?: boolean;
}

function buildPrompt({
  query,
  context,
  history,
  systemPrompt,
  mode,
  requireComparisonSynthesis = false,
}: GenerateOptions): string {
  const groundingRules =
    mode === 'general'
      ? `You may answer using your own model knowledge. Do not mention missing knowledge base context. Do not use citations unless context is explicitly provided. Answer in a complete sentence that restates the subject of the question.`
      : mode === 'mixed'
        ? `Use relevant retrieved context when it helps. If the retrieved context is weak or incomplete, you may fill gaps with general knowledge. Add bracket citations like [1] to every sentence or bullet that relies on retrieved context. Cover all entities or list items requested by the user.`
        : `Use retrieved context as the primary source. You may synthesize across multiple chunks. If context is partial, answer what you can and avoid unnecessary refusal. Add bracket citations like [1] to every sentence or bullet grounded in retrieved context. Cover all entities or list items requested by the user.`;

  const comparisonRule = requireComparisonSynthesis
    ? `This is a comparison question. Produce one unified comparative answer that synthesizes across documents instead of listing one document at a time.`
    : '';

  const listRule =
    /which|list|major religions|countries/i.test(query)
      ? `If the question asks for a set, list, or multiple entities, provide the full set you can support rather than a single example.`
      : '';

  const conversation = history
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  return [
    systemPrompt,
    groundingRules,
    comparisonRule,
    listRule,
    conversation ? `CONVERSATION HISTORY:\n${conversation}` : '',
    context ? `CONTEXT:\n${context}` : 'CONTEXT:\nNone',
    `QUESTION:\n${query}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function generateAnswer(options: GenerateOptions): Promise<string> {
  const prompt = buildPrompt(options);

  const { text } = await generateText({
    model,
    prompt,
    temperature: options.mode === 'general' ? 0.3 : 0.2,
  });

  return text.trim();
}

export function streamAnswer(options: GenerateOptions) {
  const prompt = buildPrompt(options);

  return streamText({
    model,
    prompt,
    temperature: options.mode === 'general' ? 0.3 : 0.2,
  });
}

export async function generateCitations(
  answer: string,
  chunks: ChunkPayload[],
  useCitations: boolean,
): Promise<z.infer<typeof CitationSchema>> {
  if (!useCitations || chunks.length === 0) {
    return { citations: [] };
  }

  const citedChunks = chunks.map((chunk, index) => ({
    id: index + 1,
    sourceTitle: chunk.sourceTitle,
    excerpt: chunk.text.slice(0, 300),
  }));

  const prompt = [
    'Extract only the citations that are actually referenced in the answer.',
    'Return JSON that matches the provided schema exactly.',
    'If no citations are used, return an empty citations array.',
    `ANSWER:\n${answer}`,
    `AVAILABLE CITATIONS:\n${JSON.stringify(citedChunks, null, 2)}`,
  ].join('\n\n');

  const { object } = await generateObject({
    model,
    schema: CitationSchema,
    prompt,
    temperature: 0,
  });

  return object;
}
