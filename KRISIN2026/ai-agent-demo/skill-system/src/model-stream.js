// 把兼容 OpenAI Chat Completions 的 SSE 增量转成纯文本增量。
export async function streamChatCompletion({ apiKey, baseUrl, model, messages, signal, onDelta }) {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.4, stream: true }),
    signal,
  });
  if (!response.ok) throw new Error(`模型服务返回 HTTP ${response.status}`);
  if (!response.body) throw new Error('模型服务没有返回流式响应');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let dataLines = [];
  let text = '';
  let finished = false;

  async function acceptEvent() {
    if (!dataLines.length) return false;
    const data = dataLines.join('\n');
    dataLines = [];
    if (data === '[DONE]') return true;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      throw new Error('模型服务返回了无法解析的流式数据');
    }
    if (event.error) throw new Error(event.error.message || '模型服务返回错误');
    const delta = event.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      text += delta;
      await onDelta(delta);
    }
    return false;
  }

  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        if (!line) {
          if (await acceptEvent()) { finished = true; break; }
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    if (!finished) {
      if (pending.startsWith('data:')) dataLines.push(pending.slice(5).trimStart());
      await acceptEvent();
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!text.trim()) throw new Error('模型没有返回文本回复');
  return text;
}
