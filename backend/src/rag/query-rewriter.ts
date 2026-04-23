import { generateText } from 'ai';
import { mistral } from '@ai-sdk/mistral';
import { loadPrompt } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';

const model = mistral('mistral-small-latest');

export interface RewriteOptions {
  query: string;
  history: string[];
  lastEntity?: string;
}

const FOLLOW_UP_PATTERNS = [
  /\b(it|its|they|them|their|there|that|those|these|former|latter)\b/i,
  /^(what about|how about|and|also|compare that|how does that compare)/i,
];

function isLikelyFollowUp(query: string, hasHistory: boolean): boolean {
  if (!hasHistory) return false;
  return FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(query.trim()));
}

function injectEntity(query: string, entity: string): string {
  let rewritten = query.trim();

  rewritten = rewritten.replace(/\bits\b/gi, `${entity}'s`);
  rewritten = rewritten.replace(/\bit\b/gi, entity);
  rewritten = rewritten.replace(/\bthat\b/gi, entity);
  rewritten = rewritten.replace(/\bthere\b/gi, entity);

  if (/^what about\b/i.test(rewritten)) {
    rewritten = rewritten.replace(/^what about\b/i, `What about ${entity}`);
  }

  if (/^how does\s+that\s+compare\b/i.test(query)) {
    rewritten = query.replace(/^how does\s+that\s+compare\b/i, `How does ${entity} compare`);
  }

  return rewritten.replace(/\s+/g, ' ').trim();
}

export async function rewriteQuery({
  query,
  history,
  lastEntity,
}: RewriteOptions): Promise<string> {
  const hasHistory = history.length > 0;
  const followUp = isLikelyFollowUp(query, hasHistory);

  if (!followUp) {
    return query;
  }

  const seeded = lastEntity ? injectEntity(query, lastEntity) : query;
  const rewritePrompt = loadPrompt('rewrite');

  const prompt = `${rewritePrompt}

Conversation:
${history.join('\n')}
Last referenced entity: ${lastEntity ?? 'unknown'}
User: ${query}
Seed rewrite: ${seeded}

Rewritten Query:`;

  try {
    const { text } = await generateText({
      model,
      prompt,
      temperature: 0,
      maxOutputTokens: 120,
      system:
        'Rewrite follow-up questions into standalone questions. Prefer the seeded entity-aware rewrite when it is correct. Return only the rewritten query.',
    });

    const rewritten = text.trim();

    if (rewritten) {
      logger.debug(`Query rewritten: "${query}" -> "${rewritten}"`);
      return rewritten;
    }
  } catch (err) {
    logger.error('Query rewrite failed, using deterministic rewrite:', err);
  }

  return seeded;
}

export function detectFollowUp(query: string, hasHistory: boolean): boolean {
  return isLikelyFollowUp(query, hasHistory);
}
