import { generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { loadPrompt } from '../utils/prompts';
import { logger } from '../utils/logger';

/**
 * Rewrites a potentially ambiguous user query into a self-contained question
 * using conversation history for context resolution.
 * E.g., "What about its economy?" → "What is the economy of Tunisia?"
 */
export async function rewriteQuery(query: string, history: string[]): Promise<string> {
  // Skip rewriting if no history or query is already long/specific
  if (history.length === 0 || query.split(' ').length > 8) {
    return query;
  }

  const rewritePrompt = loadPrompt('rewrite');

  const prompt = `${rewritePrompt}

Conversation:
${history.join('\n')}
User: ${query}

Rewritten Query:`;

  try {
    const { text } = await generateText({
      model: google('gemini-2.0-flash'),
      prompt,
      maxTokens: 100,
    });
    const rewritten = text.trim();
    if (rewritten && rewritten !== query) {
      logger.debug(`Query rewritten: "${query}" → "${rewritten}"`);
    }
    return rewritten || query;
  } catch (err) {
    logger.error('Query rewrite failed, using original:', err);
    return query;
  }
}