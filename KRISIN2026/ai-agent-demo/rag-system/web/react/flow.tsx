import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
    ReactFlow,
    Background,
    Controls,
    Handle,
    Position,
    MarkerType,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './flow.css';
import { projectEvents } from '../events.js';
import type { RunEvent } from '../../src/workflow.js';

const labels: Record<string, [string, string]> = {
    start: ['开始', '接收本次问题'],
    prepare_query: ['整理查询', '原问题 / 历史指代'],
    retrieve: ['召回资料', 'Embedding · PG · RRF'],
    grade_evidence: ['证据门禁', '版本 / 阈值 / 预算'],
    generate: ['生成答案', '原文摘录或模型'],
    validate_answer: ['校验引用', '引用 ID / 当前版本'],
    fallback: ['明确降级', '资料不足或服务故障'],
    end: ['结束', '发布结果或停止'],
};
const statusLabels: Record<string, string> = {
    waiting: '等待',
    running: '执行中',
    completed: '完成',
    failed: '失败',
    cancelled: '已取消',
    skipped: '未执行',
};
type TaskNode = Node<
    { title: string; subtitle: string; phase: string; duration?: number },
    'task'
>;
function Task({ data }: NodeProps<TaskNode>) {
    return (
        <div className={`task-node ${data.phase}`}>
            <Handle type="target" position={Position.Left} />
            <div className="task-top">
                <b>{data.title}</b>
                <span>{statusLabels[data.phase]}</span>
            </div>
            <small>{data.subtitle}</small>
            <div className="task-duration">
                {data.duration !== undefined ? `${data.duration} ms` : '—'}
            </div>
            <Handle type="source" position={Position.Right} />
        </div>
    );
}
const nodeTypes = { task: Task };
const links = [
    ['start', 'prepare_query'],
    ['prepare_query', 'retrieve'],
    ['retrieve', 'grade_evidence'],
    ['grade_evidence', 'generate'],
    ['grade_evidence', 'fallback', '不足 / 故障'],
    ['generate', 'validate_answer'],
    ['generate', 'fallback', '拒答 / 失败'],
    ['validate_answer', 'end'],
    ['validate_answer', 'fallback', '校验未通过'],
    ['fallback', 'end'],
];
function Flow() {
    const [events, setEvents] = useState<RunEvent[]>([]);
    const [terminal, setTerminal] = useState<string>();
    const [cursor, setCursor] = useState(-1);
    const [playing, setPlaying] = useState(false);
    const [selected, setSelected] = useState('prepare_query');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const reset = () => {
            setEvents([]);
            setTerminal(undefined);
            setCursor(-1);
            setPlaying(false);
            setSelected('prepare_query');
            setBusy(true);
        };
        const progress = (e: Event) => {
            const event = (e as CustomEvent<RunEvent>).detail;
            setEvents(previous => [...previous, event]);
            if (event.type === 'run_end' || event.type === 'run_error')
                setBusy(false);
        };
        const stop = (e: Event) => {
            setTerminal((e as CustomEvent<string>).detail);
            setBusy(false);
        };
        window.addEventListener('rag:reset', reset);
        window.addEventListener('rag:event', progress);
        window.addEventListener('rag:stop', stop);
        return () => {
            window.removeEventListener('rag:reset', reset);
            window.removeEventListener('rag:event', progress);
            window.removeEventListener('rag:stop', stop);
        };
    }, []);
    // 仅播放已经发生的事件；500ms 是回看速度，不影响后端执行或真实耗时。
    useEffect(() => {
        if (!playing) return;
        if (cursor >= events.length - 1) {
            setPlaying(false);
            return;
        }
        const timer = window.setTimeout(() => {
            const next = cursor + 1;
            setCursor(next);
            const e = events[next];
            setSelected(e?.node || (e?.type === 'run_start' ? 'start' : 'end'));
        }, 500);
        return () => window.clearTimeout(timer);
    }, [playing, cursor, events]);
    const visible = cursor < 0 ? events : events.slice(0, cursor + 1);
    const model = projectEvents(visible, cursor < 0 ? terminal : undefined);
    const latest = visible.at(-1);
    const active = cursor < 0 && latest?.node ? latest.node : selected;
    const detail = model.details[selected] as RunEvent | undefined;
    const nodes: TaskNode[] = Object.keys(labels).map((id, index) => ({
        id,
        type: 'task',
        // SSE 高频更新时保留稳定布局尺寸，不依赖每次重新测量节点。
        width: 170,
        height: 88,
        position:
            id === 'fallback'
                ? { x: 760, y: 220 }
                : { x: (id === 'end' ? 6 : index) * 190, y: 50 },
        selected: selected === id,
        data: {
            title: labels[id][0],
            subtitle: labels[id][1],
            phase: model.phases[id],
            duration: model.details[id]?.durationMs,
        },
    }));
    const edges = links.map(([source, target, label]) => {
        const traversed = model.travelled.has(`${source}->${target}`);
        return {
            id: `${source}->${target}`,
            source,
            target,
            label,
            type: 'smoothstep',
            animated: traversed && model.phases[target] === 'running',
            markerEnd: {
                type: MarkerType.ArrowClosed,
                color: traversed ? '#5850bd' : '#c6cad4',
            },
            style: {
                stroke: traversed ? '#5850bd' : '#c6cad4',
                strokeWidth: traversed ? 2.5 : 1,
                strokeDasharray: traversed ? undefined : '4 5',
                opacity: traversed ? 1 : 0.65,
            },
            labelStyle: { fontSize: 10, fill: '#657185' },
            labelBgStyle: { fill: '#fafbfe' },
        };
    });
    const move = (index: number) => {
        setPlaying(false);
        const next = Math.min(events.length - 1, Math.max(0, index));
        setCursor(next);
        const e = events[next];
        setSelected(e?.node || (e?.type === 'run_start' ? 'start' : 'end'));
    };
    return (
        <section className="flow-section" aria-label="RAG 实时执行图">
            <div className="flow-heading">
                <div>
                    <div className="eyebrow">LIVE WORKFLOW</div>
                    <h2>看看任务如何流转</h2>
                    <p>
                        连线高亮实际走过的分支。点击节点查看状态；运行太快时，可以逐步回看。
                    </p>
                </div>
                <div className="flow-run-controls">
                    {busy && (
                        <button
                            onClick={() =>
                                window.dispatchEvent(new Event('rag:cancel'))
                            }
                        >
                            取消本次执行
                        </button>
                    )}
                    <span
                        className={`badge ${busy ? '' : 'neutral'}`}
                        role="status"
                    >
                        {cursor >= 0
                            ? `回看 ${cursor + 1} / ${events.length}`
                            : busy
                              ? `执行中 · ${labels[active]?.[0] || '连接中'}`
                              : events.length
                                ? '本次执行已结束'
                                : '等待提问'}
                    </span>
                </div>
            </div>
            <div className="flow-legend">
                <span className="running">● 执行中</span>
                <span className="completed">● 完成</span>
                <span className="failed">● 失败</span>
                <span>○ 灰色为等待或未执行</span>
            </div>
            <div className="flow-canvas">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.1 }}
                    minZoom={0.25}
                    maxZoom={1.8}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    deleteKeyCode={null}
                    onNodeClick={(_, node) => setSelected(node.id)}
                >
                    <Background gap={18} color="#e0e4ed" />
                    <Controls showInteractive={false} />
                </ReactFlow>
            </div>
            <div className="flow-playback">
                <button
                    disabled={!events.length || cursor === 0}
                    onClick={() =>
                        move((cursor < 0 ? events.length - 1 : cursor) - 1)
                    }
                >
                    上一步
                </button>
                <button
                    disabled={!events.length || busy}
                    onClick={() => {
                        if (playing) {
                            setPlaying(false);
                            return;
                        }
                        if (cursor < 0 || cursor >= events.length - 1) {
                            setCursor(0);
                            setSelected('start');
                        }
                        setPlaying(true);
                    }}
                >
                    {playing ? '暂停回看' : '播放回看'}
                </button>
                <input
                    type="range"
                    aria-label="逐步回看执行事件"
                    min="0"
                    max={Math.max(0, events.length - 1)}
                    value={cursor < 0 ? Math.max(0, events.length - 1) : cursor}
                    disabled={!events.length}
                    onChange={e => move(Number(e.target.value))}
                />
                <button
                    disabled={
                        !events.length ||
                        cursor < 0 ||
                        cursor === events.length - 1
                    }
                    onClick={() => move(cursor + 1)}
                >
                    下一步
                </button>
                <button
                    className={cursor < 0 ? 'active' : ''}
                    onClick={() => {
                        setPlaying(false);
                        setCursor(-1);
                    }}
                >
                    跟随实时
                </button>
            </div>
            <div className="flow-events" aria-label="执行事件时间线">
                {events.map((event, index) => (
                    <button
                        key={event.seq}
                        className={cursor === index ? 'active' : ''}
                        onClick={() => move(index)}
                    >
                        <small>+{event.elapsedMs}ms</small>
                        {event.node
                            ? labels[event.node]?.[0]
                            : event.type === 'run_start'
                              ? '开始'
                              : '结束'}
                        <span>
                            {event.type === 'node_start'
                                ? '进入'
                                : event.type === 'node_end'
                                  ? statusLabels[event.outcome || 'completed']
                                  : event.type === 'run_error'
                                    ? '中断'
                                    : '记录'}
                        </span>
                    </button>
                ))}
            </div>
            <div className="flow-detail">
                <div className="flow-detail-heading">
                    <h3>
                        {labels[selected][0]} <code>{selected}</code>
                    </h3>
                    <span>
                        {statusLabels[model.phases[selected]]}
                        {detail?.durationMs !== undefined
                            ? ` · ${detail.durationMs} ms`
                            : ''}
                    </span>
                </div>
                <p>
                    {detail?.detail ||
                        (model.phases[selected] === 'skipped'
                            ? '本次路径没有执行该节点。'
                            : '提问后可查看该节点的实际输入与输出。')}
                </p>
                {detail && (
                    <div className="flow-snapshots">
                        {detail.inputState && (
                            <div>
                                <h4>进入前状态</h4>
                                <pre>
                                    {JSON.stringify(detail.inputState, null, 2)}
                                </pre>
                            </div>
                        )}
                        <div>
                            <h4>
                                {detail.type === 'node_start'
                                    ? '进入时状态'
                                    : '完成后状态'}
                            </h4>
                            <pre>
                                {JSON.stringify(
                                    detail.state || { outcome: detail.outcome },
                                    null,
                                    2,
                                )}
                            </pre>
                        </div>
                        <div>
                            <h4>本节点更新</h4>
                            <pre>
                                {JSON.stringify(detail.update || {}, null, 2)}
                            </pre>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
createRoot(document.getElementById('flow-root')!).render(<Flow />);
