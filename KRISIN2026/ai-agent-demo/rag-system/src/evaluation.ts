import type { Config } from './config.js';
import type { Models } from './models.js';
import type { Store } from './store.js';
import { evaluationCases } from './fixtures.js';
import { selectEvidence } from './retrieval.js';

export async function evaluate(c: Config, store: Store, models: Models, tenant: string, signal?: AbortSignal) {
  const rows = [];
  for (const item of evaluationCases) {
    signal?.throwIfAborted();
    const start = performance.now();
    const vector = await models.query(item.question, signal);
    const candidates = await store.retrieve(tenant, item.question, vector, 'hybrid');
    const rank = candidates.slice(0, 5).findIndex(row => row.sourceId === item.expected);
    const evidence = selectEvidence(candidates, { contextK: c.CONTEXT_K, budget: c.CONTEXT_CHAR_BUDGET,
      minVector: c.MIN_VECTOR_SCORE, minKeyword: c.MIN_KEYWORD_SCORE });
    const hit = rank >= 0;
    rows.push({ ...item, hit, reciprocalRank: hit ? 1 / (rank + 1) : 0,
      passed: item.expected ? hit && evidence.some(e => e.sourceId === item.expected) : evidence.length === 0,
      refused: evidence.length === 0, sources: candidates.slice(0, 5).map(row => row.sourceId),
      durationMs: Math.round(performance.now() - start) });
  }
  const answerable = rows.filter(r => r.expected !== null);
  return { mode: c.RAG_MODE, note: '仅评测检索和证据门禁，未评测 LLM 答案忠实度；不是独立保留集。',
    hitRateAt5: answerable.filter(r => r.hit).length / answerable.length,
    mrrAt5: answerable.reduce((sum, r) => sum + r.reciprocalRank, 0) / answerable.length,
    passed: rows.filter(r => r.passed).length, total: rows.length, rows };
}
