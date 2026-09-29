import '/flow.js';
import { queryStream } from '/events.js';
const $ = selector => document.querySelector(selector);
const history = [];
let currentDocuments = [];
let controller;
const el = (tag, value, className) => {
  const node = document.createElement(tag);
  // 模型输出与上传文档一律作为文本显示，避免把不可信内容变成 HTML。
  if (value !== undefined) node.textContent = String(value);
  if (className) node.className = className;
  return node;
};
function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').classList.toggle('error', error);
}
async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`/api/${path}`, { method, signal,
    ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
async function action(button, work) {
  button.disabled = true;
  try { await work(); } catch (error) { notice(error.message, true); }
  finally { button.disabled = false; }
}
function tab(id) {
  document.querySelectorAll('.tab-panel').forEach(node => { node.hidden = node.id !== id; });
  document.querySelectorAll('[data-tab]').forEach(node => node.classList.toggle('active', node.dataset.tab === id));
}
document.querySelectorAll('[data-tab]').forEach(node => node.addEventListener('click', () => tab(node.dataset.tab)));
async function refresh() {
  const status = await api('status');
  $('#mode').textContent = status.mode === 'demo' ? '本地演示 · 无模型调用' : '真实模型模式';
  $('#configuration').textContent = `Chunk ${status.chunkSize} 字符 · Recall ${status.recallK} · Context ${status.contextK}`;
  $('#samples').replaceChildren(...status.samples.slice(0, 6).concat(status.samples.at(-1)).map(question => {
    const button = el('button', question); button.type = 'button';
    button.addEventListener('click', () => { $('#question').value = question; $('#question').focus(); });
    return button;
  }));
  if (!status.databaseReady) {
    notice('数据库尚未就绪。在 rag-system 目录启动 PostgreSQL，配置 .env.local 并执行 pnpm db:init。', true);
    return;
  }
  const data = await api('documents'); currentDocuments = data.documents;
  $('#documents').replaceChildren(...data.documents.map(doc => {
    const card = el('article', undefined, 'document');
    card.append(el('h4', doc.title), el('p', `${doc.id} · v${doc.revision} · ${doc.chunk_count} 个片段${doc.embedding_profile !== status.profile ? ' · 模型配置已变化，需要重新索引' : ''}`));
    const controls = el('div', undefined, 'actions');
    const edit = el('button', '查看 / 编辑');
    edit.addEventListener('click', () => {
      $('#doc-id').value = doc.id; $('#doc-title').value = doc.title; $('#doc-body').value = doc.body;
      $('#editor-title').textContent = `编辑文档 · v${doc.revision}`; $('#doc-title').focus();
    });
    const remove = el('button', '删除', 'danger');
    remove.addEventListener('click', () => action(remove, async () => {
      if (!window.confirm(`删除“${doc.title}”及其向量片段？可通过重新保存或恢复示例导入。`)) return;
      await api(`documents/${encodeURIComponent(doc.id)}`, { method: 'DELETE' });
      notice('文档与向量已删除。'); await refresh();
    }));
    controls.append(edit, remove); card.append(controls); return card;
  }));
  $('#jobs').replaceChildren(...data.jobs.map(job => el('div', `${job.source_id} · ${job.status}${job.error_code ? ` · ${job.error_code}` : ''}`, 'job')));
  notice(data.documents.length ? `${data.documents.length} 份文档已就绪。${status.mode === 'demo' ? '本地模式使用特征哈希向量和原文摘录，不代表真实语义模型效果。' : '查询与文档将发往 .env.local 配置的模型服务。'}${status.tracing ? ' LangSmith 远程轨迹已启用。' : ''}` : '知识库为空。打开“知识库”，导入合成示例或写入自己的文档。');
}
function renderResult(result) {
  $('#answer').textContent = result.answer;
  const labels = { passed: '证据通过', insufficient: '资料不足', unavailable: '检索不可用', generation_failed: '生成未通过' };
  $('#result-state').textContent = labels[result.status] || result.status;
  $('#run-meta').textContent = `${result.strategyVersion}\nTrace ${result.traceId}\n查询：${result.query}\n生成 Token：输入 ${result.usage.inputTokens} / 输出 ${result.usage.outputTokens}`;
  $('#sources').replaceChildren(...result.sources.map(source => {
    const card = el('article', undefined, 'source'); const heading = el('h4');
    heading.append(el('span', `[${source.citationId}]`), el('b', `${source.title} · v${source.revision}`));
    card.append(heading, el('p', source.content), el('small', `${source.cited ? '答案引用' : '参考候选'} · ${source.id}`));
    return card;
  }));
  $('#trace').replaceChildren(...result.trace.map((step, index) => {
    const row = el('li'); const text = el('div');
    text.append(el('b', step.node), el('p', step.detail));
    row.append(el('span', index + 1, 'step-number'), text, el('small', `${step.durationMs} ms`)); return row;
  }));
  $('#candidates').replaceChildren(...result.candidates.map(item => {
    const row = el('tr');
    for (const text of [`${item.title} v${item.revision}`, item.vectorScore.toFixed(3), item.keywordScore.toFixed(3),
      `${item.vectorRank ?? '—'} / ${item.keywordRank ?? '—'}`, item.rrfScore.toFixed(4)]) row.append(el('td', text));
    return row;
  }));
}
$('#query-form').addEventListener('submit', event => {
  event.preventDefault();
  action($('#ask-button'), async () => {
    controller = new AbortController(); $('#cancel').hidden = false;
    window.dispatchEvent(new Event('rag:reset'));
    $('#flow-root').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#answer').textContent = '正在执行；答案将在生成与引用校验通过后展示。';
    $('#sources').replaceChildren(); $('#trace').replaceChildren(); $('#candidates').replaceChildren(); $('#run-meta').textContent = '';
    const question = $('#question').value.trim();
    $('#result-state').textContent = '正在运行'; notice('正在执行检索与证据判断…');
    try {
      const result = await queryStream({ question, retrieval: $('#retrieval').value,
        history: $('#use-history').checked ? history.slice(-6) : [] }, controller.signal,
        event => window.dispatchEvent(new CustomEvent('rag:event', { detail: event })));
      renderResult(result); history.push({ role: 'user', content: question }, { role: 'assistant', content: result.answer.slice(0, 2000) });
      notice(result.mode === 'demo' ? '本地流程执行完成：数据库与工作流是真实执行，模型部分为演示。' : '模型请求完成。引用 ID 已校验，事实支持度仍需核对来源。');
    } catch (error) {
      window.dispatchEvent(new CustomEvent('rag:stop', { detail: error.name === 'AbortError' ? 'cancelled' : 'failed' }));
      $('#answer').textContent = error.name === 'AbortError' ? '本次执行已取消，未发布答案。' : '本次执行失败，未发布答案。';
      $('#result-state').textContent = error.name === 'AbortError' ? '已取消' : '请求失败';
      throw new Error(error.name === 'AbortError' ? '已取消本次查询。' : error.message);
    } finally { $('#cancel').hidden = true; controller = undefined; }
  });
});
$('#cancel').addEventListener('click', () => controller?.abort());
window.addEventListener('rag:cancel', () => controller?.abort());
$('#clear-history').addEventListener('click', () => { history.length = 0; notice('本页对话已清空。'); });
$('#seed').addEventListener('click', () => action($('#seed'), async () => {
  if (currentDocuments.some(d => ['rag-basics', 'index-pipeline', 'chunking', 'embedding', 'hybrid', 'pgvector', 'security', 'evaluation'].includes(d.id)) &&
      !window.confirm('恢复示例会覆盖同 ID 的编辑内容，其他文档保留。继续？')) return;
  notice('正在索引示例资料…'); await api('seed', { method: 'POST' }); await refresh();
}));
$('#new-document').addEventListener('click', () => { $('#document-form').reset(); $('#editor-title').textContent = '新增文档'; });
$('#document-form').addEventListener('submit', event => {
  event.preventDefault(); action($('#document-form button[type=submit]'), async () => {
    notice('正在切块和生成向量，索引完成后才发布新版本…');
    const result = await api('documents', { method: 'POST', body: { id: $('#doc-id').value.trim(),
      title: $('#doc-title').value.trim(), body: $('#doc-body').value.trim() } });
    await refresh(); notice(result.unchanged ? '内容和索引配置未变化，无需重复计算向量。' : `版本 v${result.revision} 已发布，共 ${result.chunkCount} 个片段。`);
  });
});
$('#evaluate').addEventListener('click', () => action($('#evaluate'), async () => {
  notice('正在运行固定问题集；真实模式会产生查询 Embedding 用量。');
  const result = await api('eval', { method: 'POST' });
  $('#eval-summary').replaceChildren(...[[`${(result.hitRateAt5 * 100).toFixed(1)}%`, 'Hit Rate@5'],
    [result.mrrAt5.toFixed(3), 'MRR@5'], [`${result.passed}/${result.total}`, '检索与门禁通过']].map(([value, label]) => {
    const node = el('div', undefined, 'metric'); node.append(el('b', value), el('span', label)); return node;
  }));
  $('#eval-rows').replaceChildren(...result.rows.map(item => {
    const row = el('tr');
    for (const text of [item.question, item.expected ?? '应拒答', item.expected ? (item.hit ? '命中' : '未命中') : '不适用',
      item.reciprocalRank.toFixed(2), item.passed ? '通过' : '需检查']) row.append(el('td', text));
    return row;
  }));
  notice(result.note);
}));
refresh().catch(error => notice(error.message, true));
