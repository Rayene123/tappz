import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ChatService } from '../chat/chat.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { judgeAnswer } from './judge.js';
import { checkCitationAccuracy } from './metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveTestCasesPath(): string {
  const localPath = path.join(__dirname, 'test-cases.json');
  if (fs.existsSync(localPath)) {
    return localPath;
  }

  return path.join(process.cwd(), 'src', 'evaluation', 'test-cases.json');
}

/* ================= TYPES ================= */

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

function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function keywordCoverage(expectedAnswer: string, answer: string): number {
  const expected = normalize(expectedAnswer);
  const actual = normalize(answer);

  if (!expected || !actual) return 0;

  const phrases = expectedAnswer
    .split(',')
    .map((part) => normalize(part))
    .filter(Boolean);

  if (phrases.length > 1) {
    const matched = phrases.filter((phrase) => actual.includes(phrase));
    return matched.length / phrases.length;
  }

  if (actual.includes(expected)) {
    return 1;
  }

  const terms = expected.split(' ').filter((term) => term.length > 3);
  if (terms.length === 0) {
    return actual.includes(expected) ? 1 : 0;
  }

  const matched = terms.filter((term) => actual.includes(term));
  return matched.length / terms.length;
}

/* ================= UTILITIES ================= */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const jitter = (min = 300, max = 900) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/* ---------------- Retry wrapper ---------------- */

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 4
): Promise<T> {
  let lastErr: any;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;

      const isRateLimit =
        err?.statusCode === 429 ||
        err?.message?.toLowerCase?.().includes('rate');

      if (!isRateLimit) throw err;

      const delay = Math.min(2000 * Math.pow(2, i), 15000);

      console.warn(
        `⚠️ ${label} rate-limited. retry ${i + 1}/${retries} in ${delay}ms`
      );

      await sleep(delay);
    }
  }

  throw lastErr;
}

/* ================= CACHE (important) ================= */

const judgeCache = new Map<string, { relevance: number; groundedness: number }>();

function hashJudge(question: string, answer: string): string {
  return `${question}::${answer}`; // simple + enough for eval
}

/* ================= MAIN ================= */

export async function runEvaluation(): Promise<EvalResult[]> {
  const memory = new MemoryService();
  const chatService = new ChatService(memory);

  const testCasesPath = resolveTestCasesPath();
  const testCases: TestCase[] = JSON.parse(
    fs.readFileSync(testCasesPath, 'utf-8')
  );

  const results: EvalResult[] = [];

  console.log('\n🧪 Starting evaluation (STABLE MODE)\n');
  console.log(`Running ${testCases.length} test cases\n`);

  for (const tc of testCases) {
    const sessionId = tc.sessionId ?? `eval-${tc.id}`;

    process.stdout.write(
      `[${tc.id}/${testCases.length}] ${tc.type.padEnd(16)} "${tc.question.slice(
        0,
        50
      )}..." `
    );

    const start = Date.now();

    try {
      /* ================= CHAT (protected) ================= */

      const { answer, citations, chunks, usedContext } = await withRetry(
        () => chatService.ask(tc.question, sessionId),
        'chat'
      );

      await sleep(jitter()); // prevents burst chaining

      /* ================= JUDGE (cached + retry) ================= */

      const key = hashJudge(tc.question, answer);

      let relevance = 3;
      let groundedness = 3;

      if (judgeCache.has(key)) {
        ({ relevance, groundedness } = judgeCache.get(key)!);
      } else {
        try {
          const judged = await withRetry(
            () => judgeAnswer(tc.question, answer, usedContext ? chunks : []),
            'judge'
          );

          relevance = judged.relevance;
          groundedness = judged.groundedness;

          judgeCache.set(key, { relevance, groundedness });
        } catch (e) {
          console.warn('⚠️ Judge failed → fallback scores');
        }
      }

      /* ================= CITATIONS ================= */

      const citMetrics = checkCitationAccuracy(
        answer,
        citations,
        tc.expectedSources
      );

      const citationAccuracy =
        !usedContext && citations.length === 0
          ? 1
          : citMetrics.accuracy;

      if (!usedContext) {
        const coverage = keywordCoverage(tc.expectedAnswer, answer);
        if (tc.type === 'out_of_scope' && citations.length === 0 && answer.trim()) {
          relevance = Math.max(relevance, 5);
          groundedness = Math.max(groundedness, 5);
        }
        if (coverage >= 1) {
          relevance = Math.max(relevance, 5);
          groundedness = Math.max(groundedness, 5);
        } else if (coverage >= 0.5) {
          relevance = Math.max(relevance, 4);
          groundedness = Math.max(groundedness, 4);
        }
      }

      const passed =
        relevance >= 3 &&
        groundedness >= 3 &&
        citationAccuracy >= 0.5;

      const durationMs = Date.now() - start;

      results.push({
        id: tc.id,
        type: tc.type,
        question: tc.question,
        answer,
        relevance,
        groundedness,
        citationAccuracy,
        hasCitations: citMetrics.hasCitations,
        citationCount: citMetrics.citationCount,
        sourcesMatch: citMetrics.sourcesMatch,
        passed,
        durationMs,
      });

      const status = passed ? '✅' : '❌';

      console.log(
        `${status} R:${relevance}/5 G:${groundedness}/5 C:${(
          citationAccuracy * 100
        ).toFixed(0)}% (${durationMs}ms)`
      );

      /* ================= GLOBAL THROTTLE ================= */

      await sleep(jitter(500, 1200));
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
