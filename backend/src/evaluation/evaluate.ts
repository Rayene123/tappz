// src/evaluation/evaluate.ts

import testCases from './test-cases.json';
import { ask } from '../chat/chat.service';
import { judgeRelevance, judgeGroundedness } from './judge';
import { checkCitations } from './metrics';

export async function evaluate() {
  const results = [];
  for (const test of testCases) {
    const answer = await ask(test.question, test.context);
    const relevance = await judgeRelevance(answer, test);
    const groundedness = await judgeGroundedness(answer, test);
    const citationAcc = checkCitations(answer, test);
    results.push({
      question: test.question,
      relevance,
      groundedness,
      citationAcc,
    });
  }
  // Save results to JSON, print table, etc.
}