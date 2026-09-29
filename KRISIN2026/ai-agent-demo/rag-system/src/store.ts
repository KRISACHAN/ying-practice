import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { Document } from '@langchain/core/documents';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embeddingProfile, hash, type Config } from './config.js';
import { terms, vectorLiteral, fuse, type Candidate } from './retrieval.js';
import type { Models } from './models.js';

export class ConflictError extends Error {}
export class Store {
  readonly pool: pg.Pool;
  readonly profile: string;
  constructor(readonly config: Config, readonly models: Models) {
    this.profile = embeddingProfile(config);
    this.pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 5,
      connectionTimeoutMillis: 3000, statement_timeout: 5000, idleTimeoutMillis: 10000 });
    this.pool.on('error', () => console.error('PG_POOL_ERROR'));
  }
  async init() { await this.pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); }
  async close() { await this.pool.end(); }
  async list(tenant: string) {
    const { rows } = await this.pool.query(`SELECT s.id, s.title, s.body, s.revision, s.updated_at,
      s.embedding_profile, count(c.id)::int AS chunk_count FROM rag_sources s
      LEFT JOIN rag_chunks c ON c.tenant_id=s.tenant_id AND c.source_id=s.id AND c.source_revision=s.revision
      WHERE s.tenant_id=$1 GROUP BY s.tenant_id,s.id ORDER BY s.id`, [tenant]);
    return rows;
  }
  async jobs(tenant: string) {
    return (await this.pool.query(`SELECT id, source_id, status, error_code, created_at FROM rag_index_jobs
      WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tenant])).rows;
  }
  async ingest(tenant: string, input: { id: string; title: string; body: string }, signal?: AbortSignal) {
    const pipeline = `recursive-char-v1:${this.config.CHUNK_SIZE}:${this.config.CHUNK_OVERLAP}`;
    const contentHash = hash(`${input.title}\n${input.body}`);
    const current = (await this.pool.query(`SELECT revision, content_hash, embedding_profile, pipeline_version
      FROM rag_sources WHERE tenant_id=$1 AND id=$2`, [tenant, input.id])).rows[0];
    if (current?.content_hash === contentHash && current.embedding_profile === this.profile && current.pipeline_version === pipeline)
      return { id: input.id, revision: current.revision, unchanged: true };
    const expectedRevision: number = current?.revision ?? 0;
    const revision = expectedRevision + 1;
    const jobId = crypto.randomUUID();
    await this.pool.query(`INSERT INTO rag_index_jobs(id,tenant_id,source_id,expected_revision,status)
      VALUES($1,$2,$3,$4,'embedding')`, [jobId, tenant, input.id, expectedRevision]);
    try {
      const cleaned = input.body.replace(/\r\n/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      const splitter = new RecursiveCharacterTextSplitter({ chunkSize: this.config.CHUNK_SIZE,
        chunkOverlap: this.config.CHUNK_OVERLAP, separators: ['\n## ', '\n\n', '\n', '。', '；', ' ', ''] });
      const docs = await splitter.splitDocuments([new Document({ pageContent: cleaned,
        metadata: { sourceId: input.id, tenantId: tenant, revision } })]);
      const texts = docs.map(d => `文档：${input.title}\n${d.pageContent}`);
      if (!texts.length || texts.length > 100) throw new Error('CHUNK_LIMIT');
      // Embedding 在事务外完成，避免模型网络延迟占住数据库锁。失败时旧版本继续可读。
      const vectors = await this.models.documents(texts, signal);
      if (vectors.length !== texts.length) throw new Error('INVALID_EMBEDDING');
      const literals = vectors.map(v => vectorLiteral(v, this.models.dimensions));
      signal?.throwIfAborted();
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        // 同一来源的首次写入也需串行化；FOR UPDATE 无法锁住尚不存在的行。
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenant}:${input.id}`]);
        const fresh = (await client.query(`SELECT revision FROM rag_sources WHERE tenant_id=$1 AND id=$2 FOR UPDATE`, [tenant, input.id])).rows[0];
        if ((fresh?.revision ?? 0) !== expectedRevision) throw new ConflictError('REVISION_CONFLICT');
        await client.query(`INSERT INTO rag_sources(tenant_id,id,title,body,content_hash,revision,embedding_profile,pipeline_version)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(tenant_id,id) DO UPDATE SET title=excluded.title,
          body=excluded.body,content_hash=excluded.content_hash,revision=excluded.revision,
          embedding_profile=excluded.embedding_profile,pipeline_version=excluded.pipeline_version,updated_at=now()`,
        [tenant, input.id, input.title, cleaned, contentHash, revision, this.profile, pipeline]);
        for (const [index, content] of texts.entries()) {
          const id = `${input.id}:r${revision}:${index}:${hash(content).slice(0, 12)}`;
          await client.query(`INSERT INTO rag_chunks(tenant_id,id,source_id,source_revision,chunk_index,content,terms,embedding,embedding_profile)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8::vector,$9)`,
          [tenant, id, input.id, revision, index, content, terms(content), literals[index], this.profile]);
        }
        // 正文、当前版本和向量处于同一 PG 事务，一次查询不会看到半成品。
        await client.query('DELETE FROM rag_chunks WHERE tenant_id=$1 AND source_id=$2 AND source_revision<>$3', [tenant, input.id, revision]);
        await client.query(`UPDATE rag_index_jobs SET status='ready',completed_at=now() WHERE id=$1`, [jobId]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      return { id: input.id, revision, chunkCount: texts.length, unchanged: false };
    } catch (error) {
      await this.pool.query(`UPDATE rag_index_jobs SET status='failed',error_code=$2,completed_at=now() WHERE id=$1`,
        [jobId, error instanceof ConflictError ? 'REVISION_CONFLICT' : 'INDEX_FAILED']);
      throw error;
    }
  }
  async remove(tenant: string, id: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tenant}:${id}`]);
      const result = await client.query('DELETE FROM rag_sources WHERE tenant_id=$1 AND id=$2', [tenant, id]);
      await client.query('COMMIT'); return !!result.rowCount;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async retrieve(tenant: string, query: string, vector: number[] | null, kind: 'vector' | 'keyword' | 'hybrid') {
    const queryTerms = terms(query);
    const literal = vectorLiteral(vector ?? Array.from({ length: this.models.dimensions }, (_, i) => i === 0 ? 1 : 0), this.models.dimensions);
    const base = `WITH eligible AS MATERIALIZED (
      SELECT c.id,c.source_id AS "sourceId",s.title,s.revision,c.content,c.terms,c.embedding
      FROM rag_chunks c JOIN rag_sources s ON s.tenant_id=c.tenant_id AND s.id=c.source_id
        AND s.revision=c.source_revision AND s.embedding_profile=c.embedding_profile
      WHERE c.tenant_id=$1 AND c.embedding_profile=$2
    ), scored AS (
      SELECT id,"sourceId",title,revision,content,
        CASE WHEN $6='keyword' THEN 0 ELSE 1-(embedding <=> $3::vector) END AS "vectorScore",
        (SELECT count(*)::float FROM unnest(terms) term WHERE term=ANY($4::text[])) /
          GREATEST(cardinality($4::text[]),1) AS "keywordScore",0::float AS "rrfScore"
      FROM eligible
    )`;
    const params = [tenant, this.profile, literal, queryTerms, this.config.RECALL_K, kind];
    // 一条 SQL 返回两路排名，同一 MVCC 快照避免并行查询跨越版本切换。
    const { rows } = await this.pool.query(`${base}
      SELECT 'vector' AS lane,q.* FROM (SELECT * FROM scored ORDER BY "vectorScore" DESC,id LIMIT $5) q
      UNION ALL SELECT 'keyword' AS lane,q.* FROM
        (SELECT * FROM scored WHERE "keywordScore">0 ORDER BY "keywordScore" DESC,id LIMIT $5) q`, params);
    const vectorRows: Candidate[] = rows.filter(r => r.lane === 'vector');
    const keywordRows: Candidate[] = rows.filter(r => r.lane === 'keyword');
    return fuse(kind === 'keyword' ? [] : vectorRows, kind === 'vector' ? [] : keywordRows);
  }
  async revalidate(tenant: string, candidates: Candidate[]) {
    if (!candidates.length) return [];
    const { rows } = await this.pool.query(`SELECT c.id FROM rag_chunks c JOIN rag_sources s
      ON s.tenant_id=c.tenant_id AND s.id=c.source_id AND s.revision=c.source_revision
      WHERE c.tenant_id=$1 AND c.embedding_profile=$2 AND s.embedding_profile=$2 AND c.id=ANY($3::text[])`,
      [tenant, this.profile, candidates.map(c => c.id)]);
    const active = new Set(rows.map(r => r.id));
    return candidates.filter(c => active.has(c.id));
  }
}
