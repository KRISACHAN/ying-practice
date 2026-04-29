import { Hono } from 'hono';
import type { Context } from 'hono';

const app: any = new Hono();

app.get('/', (c: Context) => {
    return c.html(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI API Gateway View</title>
  <link href="/src/style.css" rel="stylesheet" />
</head>
<body>
  <main class="container">
    <h1>AI API Gateway Demo</h1>
    <p class="muted">
      Compatible with <code>/api/v1/chat/completions</code> stream calls and <code>/api/usage</code>.
    </p>

    <section class="panel">
      <label>
        Gateway Base URL
        <input id="baseUrl" value="http://localhost:8787" placeholder="https://your-gateway.workers.dev" />
      </label>
      <label>
        API Key (Bearer)
        <input id="apiKey" value="gw-demo-key" />
      </label>
      <label>
        Model
        <input id="model" value="gpt-4o" />
      </label>
      <label>
        Message
        <textarea id="prompt" rows="5">Write a short hello in English.</textarea>
      </label>
      <label class="inline">
        <input id="stream" type="checkbox" checked />
        Stream mode
      </label>
      <div class="actions">
        <button id="sendBtn" type="button">Send Chat</button>
        <button id="usageBtn" type="button">Get Usage</button>
        <button id="clearBtn" type="button">Clear Output</button>
      </div>
    </section>

    <section class="panel">
      <h2>Output</h2>
      <pre id="output"></pre>
    </section>
  </main>

  <script>
      (() => {
const output = document.getElementById('output');
const sendBtn = document.getElementById('sendBtn');
const usageBtn = document.getElementById('usageBtn');
const clearBtn = document.getElementById('clearBtn');

const print = (text) => {
  output.textContent += text;
};

const println = (text = '') => {
  output.textContent += text + '\\n';
};

const getConfig = () => {
  const baseUrl = document.getElementById('baseUrl').value.trim().replace(/\\/$/, '');
  const apiKey = document.getElementById('apiKey').value.trim();
  const model = document.getElementById('model').value.trim() || 'gpt-4o';
  const prompt = document.getElementById('prompt').value.trim();
  const stream = document.getElementById('stream').checked;
  return { baseUrl, apiKey, model, prompt, stream };
};

const chat = async () => {
  const { baseUrl, apiKey, model, prompt, stream } = getConfig();
  output.textContent = '';
  println('[chat] sending request...');

  const response = await fetch(baseUrl + '/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || ('HTTP ' + response.status));
  }

  if (!stream) {
    const data = await response.json();
    println(JSON.stringify(data, null, 2));
    return;
  }

  if (!response.body) {
    throw new Error('Readable stream is empty.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  println('[stream] started:\\n');

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        println('\\n\\n[stream] done');
        return;
      }

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) print(content);
      } catch {
        // ignore invalid chunk
      }
    }
  }
};

const getUsage = async () => {
  const { baseUrl, apiKey } = getConfig();
  output.textContent = '';
  println('[usage] loading...');

  const res = await fetch(baseUrl + '/api/usage', {
    headers: { Authorization: 'Bearer ' + apiKey },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || ('HTTP ' + res.status));
  }
  try {
    println(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    println(text);
  }
};

sendBtn.addEventListener('click', async () => {
  try {
    await chat();
  } catch (error) {
    println('\\n[error] ' + (error instanceof Error ? error.message : String(error)));
  }
});

usageBtn.addEventListener('click', async () => {
  try {
    await getUsage();
  } catch (error) {
    println('\\n[error] ' + (error instanceof Error ? error.message : String(error)));
  }
});

clearBtn.addEventListener('click', () => {
  output.textContent = '';
});
      })();
  </script>
</body>
</html>`);
});

export default app;
