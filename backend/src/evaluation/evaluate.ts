import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ChatService } from '../chat/chat.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { judgeAnswer } from './judge.js';
import { checkCitationAccuracy } from './metrics.js';

// ✅ ESM-safe __dirname replacement
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TestCase {
  id: number;
  type: 'simple_factual' | 'multi_document' | 'follow_up' | 'out_of_scope';
  question: string;
  sessionId?: string;
  expectedAnswer: string;
  expectedSources: string[];
  followUp: boolean;
  dependsOn?: number;
}

interface EvalResult {
  id: number;
  type: string;
  question: string;
  answer: string;
  relevance: number;
  groundedness: number;
  citationAccuracy: number;
  hasCitations: boolean;
  citationCount: number;
  sourcesMatch: boolean;
  passed: boolean;
  durationMs: number;
}

export async function runEvaluation(): Promise<EvalResult[]> {
  const memory = new MemoryService();
  const chatService = new ChatService(memory);

  const testCasesPath = path.join(__dirname, 'test-cases.json');
  const testCases: TestCase[] = JSON.parse(
    fs.readFileSync(testCasesPath, 'utf-8')
  );

  const results: EvalResult[] = [];

  console.log('\n🧪 Starting evaluation...\n');
  console.log(`Running ${testCases.length} test cases\n`);

  for (const tc of testCases) {
    const sessionId = tc.sessionId ?? `eval-${tc.id}`;
    process.stdout.write(
      `[${tc.id}/${testCases.length}] ${tc.type.padEnd(16)} "${tc.question.slice(0, 50)}..."  `
    );

    const start = Date.now();

    try {
      const { answer, citations, chunks } = await chatService.ask(
        tc.question,
        sessionId
      );

      const durationMs = Date.now() - start;

      const { relevance, groundedness } = await judgeAnswer(
        tc.question,
        answer,
        chunks
      );

      const citMetrics = checkCitationAccuracy(
        answer,
        citations,
        tc.expectedSources
      );

      const passed =
        relevance >= 3 &&
        groundedness >= 3 &&
        citMetrics.accuracy >= 0.5;

      const result: EvalResult = {
        id: tc.id,
        type: tc.type,
        question: tc.question,
        answer,
        relevance,
        groundedness,
        citationAccuracy: citMetrics.accuracy,
        hasCitations: citMetrics.hasCitations,
        citationCount: citMetrics.citationCount,
        sourcesMatch: citMetrics.sourcesMatch,
        passed,
        durationMs,
      };

      results.push(result);

      const status = passed ? '✅' : '❌';
      console.log(
        `${status} R:${relevance}/5 G:${groundedness}/5 C:${(
          citMetrics.accuracy * 100
        ).toFixed(0)}% (${durationMs}ms)`
      );
    } catch (err) {
      console.log(`💥 ERROR: ${(err as Error).message}`);

      results.push({
        id: tc.id,
        type: tc.type,
        question: tc.question,
        answer: 'ERROR',
        relevance: 0,
        groundedness: 0,
        citationAccuracy: 0,
        hasCitations: false,
        citationCount: 0,
        sourcesMatch: false,
        passed: false,
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}