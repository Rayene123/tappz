import { Injectable, Inject } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import { generateAnswer, generateCitations, AnswerMode } from '../rag/generator.js';
import { retrieveChunks } from '../rag/retriever.js';
import { rerankChunks } from '../rag/reranker.js';
import { rewriteQuery, detectFollowUp } from '../rag/query-rewriter.js';
import { buildContext } from '../rag/context-builder.js';
import { MemoryService } from '../memory/memory.service.js';
import { CitationSchema } from '../schemas/citation.schema.js';
import { loadPrompt } from '../utils/prompts.js';
import { logger } from '../utils/logger.js';
import {
  assessRetrieval,
  classifyIntent,
  extractBestEntity,
  hasRelevantContextSignal,
  QueryIntent,
  RetrievedChunk,
} from './qa-routing.js';

export interface StreamChatOptions {
  message: string;
  sessionId: string;
  reply: FastifyReply;
}

export interface AskResult {
  answer: string;
  citations: z.infer<typeof CitationSchema>['citations'];
  chunks: RetrievedChunk[];
  intent: QueryIntent;
  usedContext: boolean;
  rewrittenQuery: string;
}

const RERANK_TOP_K = 6;
const CONTEXT_LIMITATION_PATTERNS = [
  /not explicitly stated/i,
  /provided context/i,
  /context does not/i,
  /information is not available/i,
  /not enough information/i,
];

@Injectable()
export class ChatService {
  constructor(@Inject(MemoryService) private readonly memory: MemoryService) {}

  private shouldRetrieve(intent: QueryIntent): boolean {
    return intent !== 'general_knowledge';
  }

  private resolveAnswerMode(intent: QueryIntent, useContext: boolean): AnswerMode {
    if (intent === 'general_knowledge') return 'general';
    if (!useContext) return 'general';
    return intent === 'comparison' ? 'mixed' : 'rag';
  }

  private async retrieveRelevantChunks(query: string): Promise<RetrievedChunk[]> {
    const candidates = await retrieveChunks(query, RERANK_TOP_K);

    if (!candidates.length) {
      return [];
    }

    try {
      const reranked = await rerankChunks(query, candidates, RERANK_TOP_K);
      return reranked.length > 0 ? reranked : candidates;
    } catch (err) {
      logger.warn(`Reranker failed, using retrieval order: ${String(err)}`);
      return candidates;
    }
  }

  private async runQuestion(question: string, sessionId: string): Promise<AskResult> {
    const history = this.memory.getHistory(sessionId);
    const textHistory = this.memory.getTextHistory(sessionId);
    const lastEntity = this.memory.getLastEntity(sessionId);
    const hasHistory = history.length > 0;
    const rewrittenQuery = await rewriteQuery({
      query: question,
      history: textHistory,
      lastEntity,
    });
    const followUpDetected = detectFollowUp(question, hasHistory);
    const rewrittenIntent = classifyIntent(
      rewrittenQuery,
      hasHistory,
      process.env.QDRANT_COLLECTION ?? 'countries',
    );
    const intent: QueryIntent =
      rewrittenIntent === 'comparison'
        ? 'comparison'
        : followUpDetected
          ? 'follow_up'
          : rewrittenIntent;

    let chunks: RetrievedChunk[] = [];

    if (this.shouldRetrieve(intent)) {
      chunks = await this.retrieveRelevantChunks(rewrittenQuery);
    }

    const retrieval = assessRetrieval(chunks);
    const useContext =
      this.shouldRetrieve(intent) &&
      retrieval.useContext &&
      hasRelevantContextSignal(rewrittenQuery, chunks);
    const context = useContext ? buildContext(chunks) : '';
    const answerMode = this.resolveAnswerMode(intent, useContext);
    const systemPrompt = loadPrompt('system', {
      collection: process.env.QDRANT_COLLECTION ?? 'countries',
      userName: sessionId,
    });

    let answer = await generateAnswer({
      query: rewrittenQuery,
      context,
      history,
      systemPrompt,
      mode: answerMode,
      requireComparisonSynthesis: intent === 'comparison',
    });

    if (
      answerMode !== 'general' &&
      CONTEXT_LIMITATION_PATTERNS.some((pattern) => pattern.test(answer))
    ) {
      answer = await generateAnswer({
        query: rewrittenQuery,
        context,
        history,
        systemPrompt,
        mode: 'mixed',
        requireComparisonSynthesis: intent === 'comparison',
      });
    }

    const citationsPayload = await generateCitations(answer, chunks, useContext);
    const nextEntity = extractBestEntity(rewrittenQuery, chunks, lastEntity);

    this.memory.addMessage(sessionId, {
      role: 'user',
      content: question,
    });

    this.memory.addMessage(sessionId, {
      role: 'assistant',
      content: answer,
    });

    if (nextEntity) {
      this.memory.setLastEntity(sessionId, nextEntity);
    }

    logger.info(
      `[${sessionId}] intent=${intent} rewritten="${rewrittenQuery}" useContext=${useContext} topScore=${retrieval.topScore.toFixed(
        2,
      )}`,
    );

    return {
      answer,
      citations: citationsPayload.citations,
      chunks,
      intent,
      usedContext: useContext,
      rewrittenQuery,
    };
  }

  async streamChat({ message, sessionId, reply }: StreamChatOptions): Promise<void> {
    try {
      const result = await this.runQuestion(message, sessionId);

      return reply
        .header('Content-Type', 'application/json')
        .header('X-Session-Id', sessionId)
        .send({
          answer: result.answer,
          citations: result.citations,
          intent: result.intent,
          usedContext: result.usedContext,
          rewrittenQuery: result.rewrittenQuery,
        });
    } catch (err) {
      logger.error('Answer generation failed:', err);
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error';
      return reply
        .status(500)
        .header('Content-Type', 'application/json')
        .send({
          answer: 'Sorry, something went wrong.',
          citations: [],
          ...(process.env.NODE_ENV !== 'production'
            ? { error: errorMessage }
            : {}),
        });
    }
  }

  async ask(question: string, sessionId = 'eval'): Promise<AskResult> {
    return this.runQuestion(question, sessionId);
  }

  clearSession(sessionId: string): void {
    this.memory.clearSession(sessionId);
  }
}
