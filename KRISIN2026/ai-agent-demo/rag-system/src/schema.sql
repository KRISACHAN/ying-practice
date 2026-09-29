CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_sources (
  tenant_id text NOT NULL,
  id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  content_hash text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  embedding_profile text NOT NULL,
  pipeline_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE IF NOT EXISTS rag_chunks (
  tenant_id text NOT NULL,
  id text NOT NULL,
  source_id text NOT NULL,
  source_revision integer NOT NULL,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  terms text[] NOT NULL,
  embedding vector NOT NULL,
  embedding_profile text NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, source_id) REFERENCES rag_sources(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rag_chunks_scope ON rag_chunks(tenant_id, embedding_profile, source_id, source_revision);
CREATE INDEX IF NOT EXISTS rag_chunks_terms ON rag_chunks USING gin(terms);
-- 小规模教学采用精确扫描。生产按固定维度/profile 分区后再设计 HNSW 与过滤策略。
CREATE TABLE IF NOT EXISTS rag_index_jobs (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  source_id text NOT NULL,
  expected_revision integer NOT NULL,
  status text NOT NULL CHECK (status IN ('embedding', 'ready', 'failed')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
