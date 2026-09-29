const form = document.querySelector('#run-form');
const message = document.querySelector('#message');
const live = document.querySelector('#live');
const status = document.querySelector('#status');
let catalog = [];
let liveAvailable = false;

function setText(selector, value) {
    document.querySelector(selector).textContent = value;
}

function showSelection(data) {
    const picked = data.execution;
    const manifest = catalog.find(skill => skill.id === picked?.skillId);
    setText('#selected-name', manifest?.name ?? '无 Skill');
    setText(
        '#selected-detail',
        picked
            ? `${picked.skillId} · v${picked.version} · ${picked.trigger}`
            : '普通聊天不会注入额外过程指令。',
    );
    setText('#instruction', picked?.systemInstruction ?? '无过程指令');
    setText('#messages', JSON.stringify(data.messages, null, 2));
    for (const card of document.querySelectorAll('.skill-card'))
        card.classList.toggle(
            'selected',
            card.dataset.skillId === picked?.skillId,
        );
    status.textContent = picked
        ? `已通过${picked.trigger === 'explicit' ? '显式命令' : '规则'}选中 Skill`
        : '没有命中 Skill，使用普通聊天';
}

async function consumeSSE(response, onEvent) {
    if (!response.body) throw new Error('服务没有返回流式响应');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let eventName = 'message';
    let dataLines = [];
    const dispatch = async () => {
        if (dataLines.length)
            await onEvent(eventName, JSON.parse(dataLines.join('\n')));
        eventName = 'message';
        dataLines = [];
    };
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            pending += decoder.decode(chunk.value, { stream: true });
            const lines = pending.split(/\r?\n/);
            pending = lines.pop();
            for (const line of lines) {
                if (!line) await dispatch();
                else if (line.startsWith('event:'))
                    eventName = line.slice(6).trim();
                else if (line.startsWith('data:'))
                    dataLines.push(line.slice(5).trimStart());
            }
        }
        if (pending.startsWith('data:'))
            dataLines.push(pending.slice(5).trimStart());
        await dispatch();
    } finally {
        await reader.cancel().catch(() => {});
    }
}

for (const button of document.querySelectorAll('[data-example]')) {
    button.addEventListener('click', () => {
        message.value = button.dataset.example;
        message.focus();
    });
}

try {
    const response = await fetch('/api/skills');
    if (!response.ok) throw new Error('加载失败');
    const data = await response.json();
    catalog = data.skills;
    liveAvailable = data.liveAvailable;
    live.disabled = !liveAvailable;
    live.checked = liveAvailable;
    setText(
        '#live-hint',
        liveAvailable
            ? `已配置模型：${data.model}`
            : '在 .env 中填写 OPENAI_API_KEY 和 AI_MODEL，重启服务',
    );
    const list = document.querySelector('#skill-list');
    for (const skill of catalog) {
        const card = document.createElement('article');
        card.className = 'skill-card';
        card.dataset.skillId = skill.id;
        const id = document.createElement('span');
        id.className = 'skill-id';
        id.textContent = skill.id;
        const name = document.createElement('h3');
        name.textContent = skill.name;
        const meta = document.createElement('p');
        meta.textContent = `${skill.version} · 单聊`;
        card.append(id, name, meta);
        list.append(card);
    }
} catch {
    setText('#live-hint', '无法连接本地服务');
    status.textContent = '无法加载 Skill 列表，请确认服务已启动。';
}

form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = message.value.trim();
    if (!text) {
        status.textContent = '请先输入消息。';
        return;
    }
    const button = document.querySelector('#run-button');
    button.disabled = true;
    status.textContent = '正在执行选择器…';
    setText(
        '#reply',
        live.checked
            ? '正在连接模型，收到内容后会逐步显示…'
            : '本轮只演示 Skill 选择与提示词，没有调用模型。',
    );
    let partialReply = '';
    try {
        const response = await fetch(
            live.checked ? '/api/run/stream' : '/api/run',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            },
        );
        if (!response.ok)
            throw new Error((await response.json()).error ?? '请求失败');
        if (live.checked) {
            let completed = false;
            await consumeSSE(response, async (kind, data) => {
                if (kind === 'selection') {
                    showSelection(data);
                    status.textContent += ' · 模型生成中';
                } else if (kind === 'delta') {
                    partialReply += data.text;
                    setText('#reply', partialReply);
                } else if (kind === 'done') {
                    completed = true;
                } else if (kind === 'error') {
                    throw new Error(data.message);
                }
            });
            if (!completed) throw new Error('连接已结束，但模型没有报告完成');
            status.textContent = '模型回复已完成';
        } else {
            showSelection(await response.json());
            setText(
                '#reply',
                liveAvailable
                    ? '本轮只展示选择与提示词；勾选“调用模型并显示回复”即可生成。'
                    : '尚未配置模型。请在 .env 中填写 OPENAI_API_KEY 和 AI_MODEL，重启服务。',
            );
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : '执行失败';
        status.textContent = reason;
        setText(
            '#reply',
            partialReply
                ? `${partialReply}\n\n生成中断：${reason}`
                : `模型未返回结果：${reason}`,
        );
    } finally {
        button.disabled = false;
    }
});
