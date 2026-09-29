'use client';
import { useState, type FormEvent } from 'react';
import { WorkflowCanvas } from '@/components/workflow-canvas';
import {
    nodeInfo,
    type NodeId,
    type RunEvent,
    type ChatMessage,
} from '@/lib/contracts';
export default function Home() {
    const [question, setQuestion] = useState('今天工作好累，想和你聊聊。');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [events, setEvents] = useState<RunEvent[]>([]);
    const [mode, setMode] = useState<'demo' | 'live'>('demo');
    const [selected, setSelected] = useState<NodeId>('route');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [draft, setDraft] = useState('');
    const [replay, setReplay] = useState<number | null>(null);
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (busy || !question.trim()) return;
        const current = question.trim();
        setBusy(true);
        setError('');
        setEvents([]);
        setReplay(null);
        setDraft('');
        setQuestion('');
        let answer = '';
        let completed = false;
        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: current,
                    history: messages.slice(-12),
                    mode,
                }),
            });
            if (!response.ok || !response.body)
                throw new Error('请求无效，请缩短消息后重试。');
            setMessages(previous => [
                ...previous,
                { role: 'user', content: current },
            ]);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const consume = (line: string) => {
                if (!line.trim()) return;
                const item = JSON.parse(line) as RunEvent;
                setEvents(previous => [...previous, item]);
                if (item.type === 'token') {
                    answer += item.text;
                    setDraft(answer);
                }
                if (item.type === 'complete') completed = true;
                if (item.type === 'error') throw new Error(item.message);
            };
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) consume(line);
            }
            buffer += decoder.decode();
            consume(buffer);
            if (!completed) throw new Error('连接中断，请重试。');
            setMessages(previous => [
                ...previous,
                { role: 'assistant', content: answer },
            ]);
            setDraft('');
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : '执行失败');
        } finally {
            setBusy(false);
        }
    }
    const steps = events.filter(e => e.type === 'node');
    const visibleEvents = replay === null ? events : steps.slice(0, replay + 1);
    const details = events.filter(
        e => e.type === 'node' && e.node === selected,
    );
    const completion = events.find(e => e.type === 'complete');
    return (
        <main className="lab">
            <header>
                <div className="brand">
                    小满 <span>COMPANION LAB</span>
                </div>
                <span className="badge">AI 女友 · 工作流教学</span>
            </header>
            <section className="intro">
                <div>
                    <p className="eyebrow">从一句话，看见一次完整执行</p>
                    <h1>
                        她如何理解、组织，<em>再回应你。</em>
                    </h1>
                    <p>
                        左侧聊天，右侧观察真实执行路径。点击节点查看它的职责与本轮记录。
                    </p>
                </div>
                <label className="mode">
                    运行模式
                    <select
                        value={mode}
                        disabled={busy}
                        onChange={e =>
                            setMode(e.target.value as 'demo' | 'live')
                        }
                    >
                        <option value="demo">本地演示 · 无需 API Key</option>
                        <option value="live">真实模型 · 使用环境变量</option>
                    </select>
                </label>
            </section>
            <section className="legend">
                <div>
                    <b>LangGraph</b>
                    <span>决定下一步与分支</span>
                </div>
                <div>
                    <b>LangChain</b>
                    <span>组合角色与会话消息</span>
                </div>
                <div>
                    <b>LangSmith</b>
                    <span>旁路记录整个执行过程</span>
                </div>
                <div>
                    <b>Vercel AI SDK</b>
                    <span>调用模型并流式回复</span>
                </div>
            </section>
            <div className="workspace">
                <section className="chat panel">
                    <div className="panel-head">
                        <div>
                            <b>小满</b>
                            <small>虚构成年 AI 伴侣角色</small>
                        </div>
                        <span className="dot">
                            {mode === 'demo' ? '模拟回复' : '真实模型'}
                        </span>
                    </div>
                    <div className="conversation" aria-live="polite">
                        <div className="bubble assistant">
                            今天过得怎么样？想聊点轻松的，还是想说说心事？
                        </div>
                        {messages.map((m, i) => (
                            <div key={i} className={`bubble ${m.role}`}>
                                {m.content}
                            </div>
                        ))}
                        {draft && (
                            <div className="bubble assistant">{draft}</div>
                        )}
                        {busy && !draft && (
                            <div className="thinking">正在组织回应…</div>
                        )}
                    </div>
                    {error && (
                        <p className="error" role="alert">
                            {error}
                        </p>
                    )}
                    <div className="examples">
                        <button
                            disabled={busy}
                            onClick={() =>
                                setQuestion('今天工作好累，想和你聊聊。')
                            }
                        >
                            情绪陪伴分支
                        </button>
                        <button
                            disabled={busy}
                            onClick={() =>
                                setQuestion('周末想去喝咖啡，陪我想想安排吧。')
                            }
                        >
                            日常聊天分支
                        </button>
                    </div>
                    <form onSubmit={submit}>
                        <textarea
                            aria-label="对小满说的话"
                            maxLength={1000}
                            value={question}
                            onChange={e => setQuestion(e.target.value)}
                            placeholder="对小满说点什么…"
                        />
                        <button
                            className="send"
                            disabled={busy || !question.trim()}
                        >
                            {busy ? '执行中…' : '发送并观察 →'}
                        </button>
                    </form>
                    <p className="hint">
                        {mode === 'demo'
                            ? '演示模式执行真实图与提示词模板，仅模型回复为本地固定示例。'
                            : '真实模式调用服务端配置的模型。历史仅保存在当前页面，刷新后清空。'}
                    </p>
                </section>
                <section className="graph panel">
                    <div className="panel-head">
                        <div>
                            <b>执行流程</b>
                            <small>LANGGRAPH / 实际节点事件</small>
                        </div>
                        <span className="badge">可缩放 · 点击节点</span>
                    </div>
                    <WorkflowCanvas
                        events={visibleEvents}
                        onSelect={setSelected}
                    />
                    {steps.length > 0 && !busy && (
                        <div className="replay">
                            <label>
                                逐步回看 ·{' '}
                                {replay === null
                                    ? '完整执行'
                                    : `${replay + 1} / ${steps.length}`}
                                <input
                                    aria-label="回看执行步骤"
                                    type="range"
                                    min={0}
                                    max={steps.length - 1}
                                    value={replay ?? steps.length - 1}
                                    onChange={e => {
                                        const index = Number(e.target.value);
                                        setReplay(index);
                                        const step = steps[index];
                                        if (step?.type === 'node')
                                            setSelected(step.node);
                                    }}
                                />
                            </label>
                            <button onClick={() => setReplay(null)}>
                                显示完整路径
                            </button>
                        </div>
                    )}
                    <div className="trace-strip">
                        <b>LangSmith · 旁路追踪</b>
                        <span>
                            {completion?.type === 'complete' &&
                            completion.tracing
                                ? '已启用轨迹发送，请到 LangSmith 项目查看'
                                : '当前未启用云端追踪；下方是本地执行记录'}
                        </span>
                    </div>
                </section>
                <aside className="inspector panel">
                    <p className="eyebrow">NODE INSPECTOR</p>
                    <h2>{nodeInfo[selected].title}</h2>
                    <span className="badge">{nodeInfo[selected].owner}</span>
                    <p>{nodeInfo[selected].explanation}</p>
                    <h3>本轮节点记录</h3>
                    {details.length ? (
                        details.map(
                            (e, i) =>
                                e.type === 'node' && (
                                    <div className="event" key={i}>
                                        <b>{e.status}</b>
                                        <small>
                                            {new Date(
                                                e.at,
                                            ).toLocaleTimeString()}
                                        </small>
                                        <p>{e.detail}</p>
                                    </div>
                                ),
                        )
                    ) : (
                        <p className="muted">
                            该节点尚未执行。分支中未被选择的节点会保持等待状态。
                        </p>
                    )}
                    <h3>为什么 LangSmith 不在连线上？</h3>
                    <p className="muted">
                        它观察运行轨迹，不决定业务流向。启用环境变量后，服务端追踪根任务与模型调用。
                    </p>
                </aside>
            </div>
            <footer>
                教学范围：条件分支、会话上下文、提示词组合、流式生成、执行追踪。当前未实现长期记忆或跨设备会话。
            </footer>
        </main>
    );
}
