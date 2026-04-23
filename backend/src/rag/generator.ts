import { Mistral } from '@mistralai/mistralai';
import { Message } from '../memory/memory.service.js';
import { CitationSchema } from '../schemas/citation.schema.js';
import { z } from 'zod';
import { ChunkPayload } from '../ingest/vector-store.js';

const client = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY!,
});

function normalizeContent(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.text ?? ''))
      .join('');
  }

  return '';
}

export type AnswerMode = 'general' | 'rag' | 'mixed';

export interface GenerateOptions {
  query: string;
  context: string;
  history: Message[];
  systemPrompt: string;
  mode: AnswerMode;
  requireComparisonSynthesis?: boolean;
}

export async function generateAnswer({
  query,
  context,
  history,
  systemPrompt,
  mode,
  requireComparisonSynthesis = false,
}: GenerateOptions): Promise<string> {
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

  const messages = [
    {
      role: 'system' as const,
      content: [systemPrompt, groundingRules, comparisonRule, listRule]
        .filter(Boolean)
        .join('\n\n'),
    },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    {
      role: 'user' as const,
      content: [
        context ? `CONTEXT:\n${context}` : 'CONTEXT:\nNone',
        `QUESTION:\n${query}`,
      ].join('\n\n'),
    },
  ];

  const res = await client.chat.complete({
    model: 'mistral-small-latest',
    temperature: mode === 'general' ? 0.3 : 0.2,
    messages,
  });

  return normalizeContent(res.choices?.[0]?.message?.content).trim();
}

export async function generateCitations(
  answer: string,
  chunks: ChunkPayload[],
  useCitations: boolean,
): Promise<z.infer<typeof CitationSchema>> {
  if (!useCitations || chunks.length === 0) {
    return { citations: [] };
  }

  const matches = [...answer.matchAll(/\[(\d+)\]/g)];
  const citedIds = new Set(
    matches.map((m) => Number(m[1])).filter((n) => !isNaN(n)),
  );

  const citations = Array.from(citedIds)
    .filter((id) => id >= 1 && id <= chunks.length)
    .map((id) => {
      const chunk = chunks[id - 1];
      return {
        id,
        sourceTitle: chunk.sourceTitle,
        excerpt: chunk.text.slice(0, 150),
      };
    });

  return { citations };
}
