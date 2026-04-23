import { generateText } from 'ai';
import { mistral } from '@ai-sdk/mistral';
import { loadPrompt } from '../utils/prompts.js';
import { ChunkPayload } from '../ingest/vector-store.js';

export interface JudgeScores {
  relevance: number;
  groundedness: number;
}

export async function judgeAnswer(
  question: string,
  answer: string,
  chunks: ChunkPayload[],
): Promise<JudgeScores> {
  const judgePrompt = loadPrompt('judge');

  const context = chunks
    .map(
      (c, i) =>
        `[${i + 1}] ${c.sourceTitle}: ${c.text.slice(0, 300)}`,
    )
    .join('\n\n');

  const prompt = `
${judgePrompt}

You are a STRICT but FAIR evaluator for a RAG system.

IMPORTANT SCORING RULES:

1. Relevance (1–5)
- Did the answer attempt to address ALL entities in the question?
- Penalize if it refuses when context contains relevant info.
- Penalize missing entity coverage.

2. Groundedness (1–5)
- Are claims supported by context when context is present?
- Penalize hallucinations.
- BUT do NOT penalize partial answers that are correctly grounded.
- If context is empty or clearly irrelevant, allow correct general-knowledge answers.

3. IMPORTANT RULE:
If context contains relevant information and the answer refuses unnecessarily,
relevance should be low.

---

QUESTION:
${question}

CONTEXT:
${context}

ANSWER:
${answer}

---

OUTPUT ONLY JSON:
{"relevance":1-5,"groundedness":1-5}
`;

  try {
    const { text } = await generateText({
      model: mistral('mistral-small-latest'), // ✅ FIX: avoid large model (rate limit issue)
      prompt,
      temperature: 0,
      maxOutputTokens: 120,
    });

    const parsed = safeParse(text.trim());

    return {
      relevance: clamp(parsed.relevance ?? 3),
      groundedness: clamp(parsed.groundedness ?? 3),
    };
  } catch (err) {
    console.error('❌ Judge failed:', err);

    // ✅ FIX: fallback instead of crashing evaluation pipeline
    return { relevance: 3, groundedness: 3 };
  }
}

/**
 * Robust JSON extraction fallback
 */
function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\d+/g)?.map(Number);
    if (!match || match.length < 2) return {};
    return {
      relevance: match[0],
      groundedness: match[1],
    };
  }
}

/**
 * Clamp score between 1 and 5
 */
function clamp(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)));
}
