import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, embeddingProfile } from '../src/config.js';
import { terms, vectorLiteral, demoVector, fuse, selectEvidence, validateCitations, type Candidate } from '../src/retrieval.js';
import { QuerySchema } from '../src/workflow.js';

const candidate = (id: string, content = '规则正文'): Candidate => ({ id, sourceId: id, title: id, revision: 1,
  content, vectorScore: 0.8, keywordScore: 0.5, rrfScore: 0 });
test('中文二元组与完整错误码；无效向量不能写入 pgvector', () => {
  assert.ok(terms('排查 ERR_AUTH_1042 与 pgvector').includes('err_auth_1042'));
  assert.ok(terms('文档切块').includes('切块'));
  assert.throws(() => vectorLiteral([NaN], 1));
  assert.throws(() => vectorLiteral([0, 0], 2));
  assert.throws(() => vectorLiteral([1], 2));
  assert.deepEqual(demoVector('RRF 排名'), demoVector('RRF 排名'));
});
test('RRF 按排名融合并去重，不因关键词原始分数大而失衡', () => {
  const a = candidate('a'); const b = candidate('b');
  b.keywordScore = 100;
  const results = fuse([a, b], [b, a]);
  assert.equal(results.length, 2);
  assert.equal(results[0].rrfScore, results[1].rrfScore);
  assert.equal(results[0].vectorRank, 1);
  assert.equal(results[0].keywordRank, 2);
});
test('上下文预算与证据门禁阻止低相关候选和过大块', () => {
  const low = { ...candidate('low'), vectorScore: 0.01, keywordScore: 0 };
  const results = selectEvidence([low, candidate('big', 'x'.repeat(600)), candidate('good', '可用规则')],
    { contextK: 3, budget: 500, minVector: 0.3, minKeyword: 0.12 });
  assert.deepEqual(results.map(r => r.id), ['good']);
});
test('引用必须来自最终上下文，正文与结构化字段一致', () => {
  assert.deepEqual(validateCitations('规则 [S1]', ['S1'], [candidate('a')]), ['S1']);
  assert.throws(() => validateCitations('编造 [S9]', ['S9'], [candidate('a')]));
  assert.throws(() => validateCitations('没有来源', ['S1'], [candidate('a')]));
  assert.throws(() => validateCitations('正文 [S1]', [], [candidate('a')]));
});
test('配置严格验证，模型 profile 变化必须重新索引；客户端不能传租户', () => {
  assert.throws(() => readConfig({ DATABASE_URL: 'unused', RAG_MODE: 'live' }));
  assert.throws(() => readConfig({ DATABASE_URL: 'unused', CHUNK_SIZE: '100', CHUNK_OVERLAP: '100' }));
  const demo = readConfig({ DATABASE_URL: 'unused' });
  const live = readConfig({ DATABASE_URL: 'unused', RAG_MODE: 'live', OPENAI_API_KEY: 'test', AI_MODEL: 'test' });
  assert.notEqual(embeddingProfile(demo), embeddingProfile(live));
  assert.throws(() => QuerySchema.parse({ question: '一个问题', tenantId: 'another-tenant' }));
});
