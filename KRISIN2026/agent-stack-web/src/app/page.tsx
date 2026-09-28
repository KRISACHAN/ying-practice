'use client';

import { useState, type FormEvent } from 'react';

type Result = {
    answer: string;
    matchedTerms: string[];
    toolActivity: { name: string; term: string }[];
    path: string[];
    tracingEnabled: boolean;
};

const examples = [
    'LangChain、LangGraph 和 LangSmith 分别负责什么？',
    'Vercel AI SDK 和 LangChain 在这个示例中如何配合？',
    'LangGraph 遇到不相关问题会怎么处理？',
];

const components = [
    {
        number: '01',
        name: 'Vercel AI SDK',
        role: '模型与工具',
        detail: '调用模型，强制先查本地词条，限制工具循环的步数。',
        className: 'sdk',
    },
    {
        number: '02',
        name: 'LangChain',
        role: '提示词链',
        detail: '用模板组织问题，再将格式化结果交给模型函数。',
        className: 'chain',
    },
    {
        number: '03',
        name: 'LangGraph',
        role: '流程控制',
        detail: '在 inspect 节点判断问题范围，再走回答或兜底分支。',
        className: 'graph',
    },
    {
        number: '04',
        name: 'LangSmith',
        role: '执行轨迹',
        detail: '开启追踪后记录整次工作流及模型调用，便于调试。',
        className: 'smith',
    },
];

export default function Home() {
    const [question, setQuestion] = useState(examples[0]);
    const [result, setResult] = useState<Result | null>(null);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    async function ask(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (loading) return;
        setLoading(true);
        setError('');
        setResult(null);
        try {
            const response = await fetch('/api/ask', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question }),
            });
            const data: Result | { error: string } = await response.json();
            if (!response.ok)
                throw new Error('error' in data ? data.error : '请求失败');
            setResult(data as Result);
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : '请求失败，请稍后重试。',
            );
        } finally {
            setLoading(false);
        }
    }

    return (
        <main className="shell">
            <header className="topbar">
                <div className="brand">
                    <span className="brand-mark">
                        a<span>→</span>
                    </span>
                    <span>
                        AGENT STACK <b>LAB</b>
                    </span>
                </div>
                <span className="top-label">
                    <span className="live-dot" /> INTERACTIVE DEMO · 2026
                </span>
            </header>

            <section className="hero">
                <div className="eyebrow">
                    <span className="small-line" /> ANATOMY OF AN AGENT WORKFLOW
                </div>
                <h1>
                    一次提问，
                    <br />
                    <em>看懂四层能力。</em>
                </h1>
                <p>
                    把模型调用、提示词组合、流程编排和执行追踪放进同一个可观察的网页示例。提出问题，然后看它如何运作。
                </p>
                <div className="hero-index">
                    01 — 04 <span>↓</span>
                </div>
            </section>

            <section
                className="architecture"
                aria-labelledby="architecture-title"
            >
                <div className="section-heading">
                    <div>
                        <span className="section-kicker">
                            THE STACK / 技术分工
                        </span>
                        <h2 id="architecture-title">每一层都有明确职责</h2>
                    </div>
                    <span className="section-note">
                        4 COMPONENTS
                        <br />1 WORKFLOW
                    </span>
                </div>
                <div className="cards">
                    {components.map(item => (
                        <article
                            className={`component-card ${item.className}`}
                            key={item.name}
                        >
                            <div className="card-top">
                                <span>{item.number} / 04</span>
                                <span className="card-symbol">↗</span>
                            </div>
                            <div>
                                <span className="role">{item.role}</span>
                                <h3>{item.name}</h3>
                                <p>{item.detail}</p>
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className="workspace" aria-labelledby="workspace-title">
                <div className="section-heading">
                    <div>
                        <span className="section-kicker">
                            TRY IT / 交互实验
                        </span>
                        <h2 id="workspace-title">输入一个问题</h2>
                    </div>
                    <span className="section-note">
                        LIVE WORKFLOW
                        <br />↘
                    </span>
                </div>
                <div className="work-grid">
                    <form className="query-panel" onSubmit={ask}>
                        <label htmlFor="question">
                            YOUR QUESTION <span>001</span>
                        </label>
                        <textarea
                            id="question"
                            value={question}
                            onChange={event => setQuestion(event.target.value)}
                            minLength={2}
                            maxLength={500}
                            rows={5}
                            required
                            placeholder="问问这些工具如何协作…"
                        />
                        <div className="suggestions">
                            <span>试试这些问题</span>
                            {examples.map(example => (
                                <button
                                    key={example}
                                    type="button"
                                    onClick={() => setQuestion(example)}
                                >
                                    {example} <span>↗</span>
                                </button>
                            ))}
                        </div>
                        <button
                            className="submit"
                            type="submit"
                            disabled={loading}
                        >
                            {loading ? '正在运行…' : '运行工作流'}
                            <span>↗</span>
                        </button>
                    </form>

                    <div className="output-panel" aria-live="polite">
                        <div className="output-head">
                            <span>EXECUTION / 执行结果</span>
                            <span
                                className={`status ${result ? 'completed' : ''}`}
                            >
                                {loading
                                    ? '● RUNNING'
                                    : result
                                      ? '● COMPLETE'
                                      : '○ READY'}
                            </span>
                        </div>
                        {error ? (
                            <div className="error-box" role="alert">
                                {error}
                            </div>
                        ) : result ? (
                            <div className="output-body">
                                <div className="output-label">最终回答</div>
                                <p className="answer">{result.answer}</p>
                                <div className="output-meta">
                                    <div>
                                        <span>GRAPH PATH</span>
                                        <strong>
                                            {result.path.join(' → ')}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>TOOL CALLS</span>
                                        <strong>
                                            {result.toolActivity.length
                                                ? result.toolActivity
                                                      .map(
                                                          call =>
                                                              `${call.name}(${call.term})`,
                                                      )
                                                      .join(' · ')
                                                : '未调用模型工具'}
                                        </strong>
                                    </div>
                                    <div>
                                        <span>LANGSMITH</span>
                                        <strong>
                                            {result.tracingEnabled
                                                ? '已开启服务端追踪'
                                                : '未开启云端追踪'}
                                        </strong>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="empty-state">
                                <div className="empty-icon">↗</div>
                                <p>准备就绪。</p>
                                <span>
                                    提交问题后，这里会显示回答、节点路径与工具调用记录。
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </section>
            <footer>
                <span>AGENT STACK LAB</span>
                <span>Vercel AI SDK · LangChain · LangGraph · LangSmith</span>
                <span>BUILT FOR LEARNING ↗</span>
            </footer>
        </main>
    );
}
