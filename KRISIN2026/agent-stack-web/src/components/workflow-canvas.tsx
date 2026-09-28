'use client';
import {
    Background,
    Controls,
    Handle,
    Position,
    ReactFlow,
    type NodeProps,
    type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeInfo, type NodeId, type RunEvent } from '@/lib/contracts';
type StepNode = Node<{ title: string; owner: string; status: string }, 'step'>;
function Step({ data }: NodeProps<StepNode>) {
    return (
        <div className={`flow-step ${data.status}`}>
            <Handle type="target" position={Position.Top} />
            <small>{data.owner}</small>
            <strong>{data.title}</strong>
            <span>
                {data.status === 'done'
                    ? '✓ 已完成'
                    : data.status === 'running'
                      ? '● 执行中'
                      : data.status === 'error'
                        ? '! 失败'
                        : '等待执行'}
            </span>
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
}
const nodeTypes = { step: Step };
const positions: Record<NodeId, { x: number; y: number }> = {
    receive: { x: 180, y: 0 },
    route: { x: 180, y: 130 },
    comfort: { x: 45, y: 265 },
    daily: { x: 315, y: 265 },
    memory: { x: 180, y: 400 },
    prompt: { x: 180, y: 535 },
    model: { x: 180, y: 670 },
    reply: { x: 180, y: 805 },
};
const links: [NodeId, NodeId][] = [
    ['receive', 'route'],
    ['route', 'comfort'],
    ['route', 'daily'],
    ['comfort', 'memory'],
    ['daily', 'memory'],
    ['memory', 'prompt'],
    ['prompt', 'model'],
    ['model', 'reply'],
];
export function WorkflowCanvas({
    events,
    onSelect,
}: {
    events: RunEvent[];
    onSelect: (id: NodeId) => void;
}) {
    const status = (id: NodeId) => {
        const event = events
            .filter(e => e.type === 'node' && e.node === id)
            .at(-1);
        return event?.type === 'node' ? event.status : 'idle';
    };
    const nodes: StepNode[] = (Object.keys(nodeInfo) as NodeId[]).map(id => ({
        id,
        type: 'step',
        position: positions[id],
        data: { ...nodeInfo[id], status: status(id) },
    }));
    const edges = links.map(([source, target]) => ({
        id: `${source}-${target}`,
        source,
        target,
        animated: status(target) === 'running',
        style: {
            stroke:
                status(source) === 'done' && status(target) !== 'idle'
                    ? '#f59bb1'
                    : '#515369',
            strokeWidth: 2,
        },
    }));
    return (
        <div className="canvas">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                onNodeClick={(_, node) => onSelect(node.id as NodeId)}
                minZoom={0.35}
                maxZoom={1.4}
            >
                <Background gap={22} color="#34364b" />
                <Controls />
            </ReactFlow>
        </div>
    );
}
