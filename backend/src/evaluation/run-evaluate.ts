import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runEvaluation } from './evaluate.js';

// ─── ESM-safe __dirname replacement ───────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const results = await runEvaluation();

  // ─── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter((r) => r.passed).length;
  const avgRelevance = avg(results.map((r) => r.relevance));
  const avgGroundedness = avg(results.map((r) => r.groundedness));
  const avgCitation = avg(results.map((r) => r.citationAccuracy));
  const avgDuration = avg(results.map((r) => r.durationMs));

  console.log('\n' + '═'.repeat(100));
  console.log('EVALUATION RESULTS');
  console.log('═'.repeat(100));

  console.log(
    padR('ID', 4) +
      padR('Type', 18) +
      padR('Question', 45) +
      padR('R', 4) +
      padR('G', 4) +
      padR('Cit%', 7) +
      padR('Pass', 6) +
      'ms',
  );

  console.log('─'.repeat(100));

  for (const r of results) {
    console.log(
      padR(String(r.id), 4) +
        padR(r.type, 18) +
        padR(r.question.slice(0, 43), 45) +
        padR(String(r.relevance), 4) +
        padR(String(r.groundedness), 4) +
        padR(`${(r.citationAccuracy * 100).toFixed(0)}%`, 7) +
        padR(r.passed ? '✅' : '❌', 6) +
        r.durationMs,
    );
  }

  console.log('─'.repeat(100));

  console.log(
    padR('AVG', 4) +
      padR('', 18) +
      padR('', 45) +
      padR(avgRelevance.toFixed(1), 4) +
      padR(avgGroundedness.toFixed(1), 4) +
      padR(`${(avgCitation * 100).toFixed(0)}%`, 7) +
      padR(`${passed}/${results.length}`, 6) +
      `${avgDuration.toFixed(0)}ms`,
  );

  console.log('═'.repeat(100));

  // ─── Breakdown ──────────────────────────────────────────────────────────────
  console.log('\n📊 Breakdown by test type:\n');

  const types = [...new Set(results.map((r) => r.type))];

  for (const type of types) {
    const group = results.filter((r) => r.type === type);
    const passedGroup = group.filter((r) => r.passed).length;

    console.log(
      `  ${type.padEnd(20)} Relevance: ${avg(group.map((r) => r.relevance)).toFixed(1)}/5  ` +
        `Groundedness: ${avg(group.map((r) => r.groundedness)).toFixed(1)}/5  ` +
        `Passed: ${passedGroup}/${group.length}`,
    );
  }

  // ─── Save results ───────────────────────────────────────────────────────────
  const outputPath = path.join(
    __dirname,
    '../../evaluation-results.json',
  );

  const output = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      passRate: `${((passed / results.length) * 100).toFixed(1)}%`,
      avgRelevance: parseFloat(avgRelevance.toFixed(2)),
      avgGroundedness: parseFloat(avgGroundedness.toFixed(2)),
      avgCitationAccuracy: parseFloat(avgCitation.toFixed(2)),
      avgDurationMs: parseFloat(avgDuration.toFixed(0)),
    },
    byType: Object.fromEntries(
      types.map((type) => {
        const group = results.filter((r) => r.type === type);
        return [
          type,
          {
            count: group.length,
            passed: group.filter((r) => r.passed).length,
            avgRelevance: parseFloat(
              avg(group.map((r) => r.relevance)).toFixed(2),
            ),
            avgGroundedness: parseFloat(
              avg(group.map((r) => r.groundedness)).toFixed(2),
            ),
          },
        ];
      }),
    ),
    results,
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n💾 Full results saved to: evaluation-results.json`);
  console.log(
    `\n🏁 Pass rate: ${passed}/${results.length} (${(
      (passed / results.length) *
      100
    ).toFixed(1)}%)\n`,
  );
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function padR(str: string, width: number): string {
  return str.slice(0, width).padEnd(width);
}

main().catch((err) => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});