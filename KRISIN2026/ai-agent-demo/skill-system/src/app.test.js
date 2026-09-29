import assert from 'node:assert/strict';
import test from 'node:test';
import { app } from './app.js';

test('Hono 页面和 API 跑通 Skill 选择与 Prompt 组装', async () => {
  const page = await app.request('http://localhost/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Skill Lab/);

  const run = async (text) => {
    const response = await app.request('http://localhost/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const decision = await run('两个工作机会让我很纠结，怎么选？');
  assert.equal(decision.execution.skillId, 'decision-clarifier');
  assert.match(decision.messages[0].content, /本轮回复方法/);
  assert.equal((await run('/unknown 做点事')).execution, null);
});

test('AI_MODEL 配置可用，并将模型增量转发给网页', async (t) => {
  const original = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
    alias: process.env.AI_MODEL,
    fetch: globalThis.fetch,
  };
  t.after(() => {
    for (const [name, value] of [
      ['OPENAI_API_KEY', original.key],
      ['OPENAI_MODEL', original.model],
      ['AI_MODEL', original.alias],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = original.fetch;
  });
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL;
  process.env.AI_MODEL = 'test-model';
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init.body).model, 'test-model');
    assert.equal(JSON.parse(init.body).stream, true);
    const chunks = [
      'data: {"choices":[{"delta":{"content":"这是"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"模型回复"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  const config = await (await app.request('http://localhost/api/skills')).json();
  assert.equal(config.liveAvailable, true);
  assert.equal(config.model, 'test-model');
  const response = await app.request('http://localhost/api/run/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '我很纠结，怎么选？' }),
  });
  assert.equal(response.status, 200);
  const events = await response.text();
  assert.match(events, /event: selection/);
  assert.match(events, /event: delta/);
  assert.match(events, /这是/);
  assert.match(events, /模型回复/);
  assert.match(events, /event: done/);
});
