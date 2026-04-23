import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { loadPrompt } from '../utils/prompts.js';
import { ChunkPayload } from '../ingest/vector-store.js';

export interface JudgeScores {
  relevance: number;
  groundedness: number;
}

/**
 * Uses Gemini as an impartial judge to score relevance and groundedness.
 * Returns scores 1–5 for each dimension.
 */
export async function judgeAnswer(
  question: string,
  answer: string,
  chunks: ChunkPayload[],
): Promise<JudgeScores> {
  const judgePrompt = loadPrompt('judge');
  const context = chunks.map((c, i) => `[${i + 1}] ${c.sourceTitle}: ${c.text.slice(0, 300)}`).join('\n\n');

  const prompt = `${judgePrompt}

---
Question: ${question}

Retrieved Context:
${context}

Generated Answer:
${answer}

Score (relevance,groundedness):`;

  try {
    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      prompt,
      maxTokens: 10,
      temperature: 0,
    });

    const matches = text.trim().match(/(\d+)[,\s]+(\d+)/);
    if (!matches) {
      console.warn(`Judge returned unexpected format: "${text}". Defaulting to 3,3.`);
      return { relevance: 3, groundedness: 3 };
    }

    const relevance = Math.min(5, Math.max(1, parseInt(matches[1]!, 10)));
    const groundedness = Math.min(5, Math.max(1, parseInt(matches[2]!, 10)));
    return { relevance, groundedness };
  } catch (err) {
    console.error('Judge call failed:', err);
    return { relevance: 0, groundedness: 0 };
  }
}