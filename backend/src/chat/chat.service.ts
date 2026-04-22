import { Injectable } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { generateCitations, streamAnswer } from '../rag/generator';
import { retrieveChunks } from '../rag/retriever';
import { rerankChunks } from '../rag/reranker';
import { rewriteQuery } from '../rag/query-rewriter';
import { buildContext } from '../rag/context-builder';
import { MemoryService } from '../memory/memory.service';
import { CitationSchema } from '../schemas/citation.schema';
import { loadPrompt } from '../utils/prompts';
import { logger } from '../utils/logger';
import { ChunkPayload } from '../ingest/vector-store';
import { z } from 'zod';

export interface StreamChatOptions {
  message: string;
  sessionId: string;
  reply: FastifyReply;
}

const RERANK_TOP_K = 5;

@Injectable()
export class ChatService {
  constructor(private readonly memory: MemoryService) {}

  /**
   * Main RAG pipeline:
   * 1. Rewrite query using conversation history
   * 2. Retrieve candidate chunks
   * 3. Re-rank to top-K
   * 4. Build context with citation IDs
   * 5. Stream LLM answer
   * 6. Generate structured citations
   * 7. Update memory
   */
  async streamChat({ message, sessionId, reply }: StreamChatOptions): Promise<void> {
    const history = this.memory.getHistory(sessionId);
    const textHistory = this.memory.getTextHistory(sessionId);

    // Step 1: Query rewriting for follow-up questions
    const rewrittenQuery = await rewriteQuery(message, textHistory);
    logger.info(`[${sessionId}] Query: "${message}" → Rewritten: "${rewrittenQuery}"`);

    // Step 2: Retrieve broad candidate set
    const candidates = await retrieveChunks(rewrittenQuery, RERANK_TOP_K);
    logger.debug(`[${sessionId}] Retrieved ${candidates.length} candidates`);

    // Step 3: Re-rank to best top-K
    const topChunks: ChunkPayload[] = candidates.length > RERANK_TOP_K
      ? await rerankChunks(rewrittenQuery, candidates, RERANK_TOP_K)
      : candidates;

    // Step 4: Build numbered context for LLM
    const context = buildContext(topChunks);

    // Step 5: Load system prompt with dynamic params
    const systemPrompt = loadPrompt('system', {
      collection: process.env.QDRANT_COLLECTION ?? 'countries',
      userName: sessionId,
    });

    // Step 6: Stream the answer
    const stream = streamAnswer({
      query: rewrittenQuery,
      context,
      history,
      systemPrompt,
    });

    // Set up SSE headers for streaming
    reply.raw.setHeader('Content-Type', 'text/plain; charset=utf-8');
    reply.raw.setHeader('Transfer-Encoding', 'chunked');
    reply.raw.setHeader('X-Session-Id', sessionId);

    // Collect full answer while streaming
    let fullAnswer = '';

    const { textStream } = stream;

    for await (const chunk of textStream) {
      fullAnswer += chunk;
      reply.raw.write(chunk);
    }

    // Step 7: Generate structured citations (appended after stream)
    let citationsPayload: z.infer<typeof CitationSchema> = { citations: [] };
    try {
      citationsPayload = await generateCitations(fullAnswer, topChunks, rewrittenQuery);
    } catch (err) {
      logger.error('Citation generation failed:', err);
    }

    // Append citations as a JSON block after the streamed text
    const citationsJson = JSON.stringify({ __citations: citationsPayload.citations });
    reply.raw.write(`\n\n${citationsJson}`);
    reply.raw.end();

    // Step 8: Update conversation memory
    this.memory.addMessage(sessionId, { role: 'user', content: message });
    this.memory.addMessage(sessionId, { role: 'assistant', content: fullAnswer });

    logger.info(`[${sessionId}] Response complete. ${citationsPayload.citations.length} citations.`);
  }

  /**
   * Non-streaming version for evaluation harness.
   */
  async ask(question: string, sessionId = 'eval'): Promise<{
    answer: string;
    citations: z.infer<typeof CitationSchema>['citations'];
    chunks: ChunkPayload[];
  }> {
    const history = this.memory.getHistory(sessionId);
    const textHistory = this.memory.getTextHistory(sessionId);

    const rewrittenQuery = await rewriteQuery(question, textHistory);
    const candidates = await retrieveChunks(rewrittenQuery, RERANK_TOP_K);
    const topChunks = candidates.length > RERANK_TOP_K
      ? await rerankChunks(rewrittenQuery, candidates, RERANK_TOP_K)
      : candidates;

    const context = buildContext(topChunks);
    const systemPrompt = loadPrompt('system', {
      collection: process.env.QDRANT_COLLECTION ?? 'countries',
      userName: 'evaluator',
    });

    const { textStream } = streamAnswer({
      query: rewrittenQuery,
      context,
      history,
      systemPrompt,
    });

    let fullAnswer = '';
    for await (const chunk of textStream) {
      fullAnswer += chunk;
    }

    const citationsPayload = await generateCitations(fullAnswer, topChunks, rewrittenQuery);

    this.memory.addMessage(sessionId, { role: 'user', content: question });
    this.memory.addMessage(sessionId, { role: 'assistant', content: fullAnswer });

    return {
      answer: fullAnswer,
      citations: citationsPayload.citations,
      chunks: topChunks,
    };
  }

  clearSession(sessionId: string): void {
    this.memory.clearSession(sessionId);
  }
}