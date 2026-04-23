import { Injectable, Inject } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  generateAnswer,
  generateCitations,
  streamAnswer,
  AnswerMode,
} from '../rag/generator.js';
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

export interface PreparedAnswer extends AskResult {
  systemPrompt: string;
  context: string;
  history: import('../memory/memory.service.js').Message[];
  answerMode: AnswerMode;
  requireComparisonSynthesis: boolean;
}

export interface PreparedQuestion {
  chunks: RetrievedChunk[];
  intent: QueryIntent;
  usedContext: boolean;
  rewrittenQuery: string;
  systemPrompt: string;
  context: string;
  history: import('../memory/memory.service.js').Message[];
  answerMode: AnswerMode;
  requireComparisonSynthesis: boolean;
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

  private async prepareQuestion(question: string, sessionId: string): Promise<PreparedQuestion> {
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

    logger.info(
      `[${sessionId}] intent=${intent} rewritten="${rewrittenQuery}" useContext=${useContext} topScore=${retrieval.topScore.toFixed(
        2,
      )}`,
    );

    return {
      chunks,
      intent,
      usedContext: useContext,
      rewrittenQuery,
      systemPrompt,
      context,
      history,
      answerMode,
      requireComparisonSynthesis: intent === 'comparison',
    };
  }

  async streamChat({ message, sessionId, reply }: StreamChatOptions): Promise<void> {
    try {
      const prepared = await this.prepareQuestion(message, sessionId);
      const stream = streamAnswer({
        query: prepared.rewrittenQuery,
        context: prepared.context,
        history: prepared.history,
        systemPrompt: prepared.systemPrompt,
        mode: prepared.answerMode,
        requireComparisonSynthesis: prepared.requireComparisonSynthesis,
      });

      reply.raw.statusCode = 200;
      reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
      reply.raw.setHeader('X-Session-Id', sessionId);
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
      reply.raw.setHeader('Access-Control-Expose-Headers', 'X-Session-Id');

      let answer = '';
      for await (const delta of stream.textStream) {
        answer += delta;
        reply.raw.write(delta);
      }

      const citationsPayload = await generateCitations(
        answer,
        prepared.chunks,
        prepared.usedContext,
      );

      this.memory.addMessage(sessionId, {
        role: 'user',
        content: message,
      });

      this.memory.addMessage(sessionId, {
        role: 'assistant',
        content: answer,
      });

      const nextEntity = extractBestEntity(
        prepared.rewrittenQuery,
        prepared.chunks,
        this.memory.getLastEntity(sessionId),
      );

      if (nextEntity) {
        this.memory.setLastEntity(sessionId, nextEntity);
      }

      reply.raw.write(
        `\n\n__CITATIONS__\n${JSON.stringify({
          __citations: citationsPayload.citations,
          intent: prepared.intent,
          usedContext: prepared.usedContext,
          rewrittenQuery: prepared.rewrittenQuery,
        })}`,
      );
      reply.raw.end();
      return;
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
    const prepared = await this.prepareQuestion(question, sessionId);

    let answer = await generateAnswer({
      query: prepared.rewrittenQuery,
      context: prepared.context,
      history: prepared.history,
      systemPrompt: prepared.systemPrompt,
      mode: prepared.answerMode,
      requireComparisonSynthesis: prepared.requireComparisonSynthesis,
    });

    if (
      prepared.answerMode !== 'general' &&
      CONTEXT_LIMITATION_PATTERNS.some((pattern) => pattern.test(answer))
    ) {
      answer = await generateAnswer({
        query: prepared.rewrittenQuery,
        context: prepared.context,
        history: prepared.history,
        systemPrompt: prepared.systemPrompt,
        mode: 'mixed',
        requireComparisonSynthesis: prepared.requireComparisonSynthesis,
      });
    }

    const citationsPayload = await generateCitations(
      answer,
      prepared.chunks,
      prepared.usedContext,
    );

    this.memory.addMessage(sessionId, {
      role: 'user',
      content: question,
    });

    this.memory.addMessage(sessionId, {
      role: 'assistant',
      content: answer,
    });

    const nextEntity = extractBestEntity(
      prepared.rewrittenQuery,
      prepared.chunks,
      this.memory.getLastEntity(sessionId),
    );

    if (nextEntity) {
      this.memory.setLastEntity(sessionId, nextEntity);
    }

    return {
      ...prepared,
      answer,
      citations: citationsPayload.citations,
    };
  }

  clearSession(sessionId: string): void {
    this.memory.clearSession(sessionId);
  }
}
