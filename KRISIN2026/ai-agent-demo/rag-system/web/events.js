// SSE 按帧解析，不假定一个网络 chunk 恰好等于一个事件；TextDecoder 处理跨块中文。
export function createEventParser(receive) {
    let pending = '';
    return text => {
        pending = (pending + text).replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            let event = 'message';
            const data = [];
            for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) event = line.slice(6).trim();
                if (line.startsWith('data:'))
                    data.push(line.slice(5).trimStart());
            }
            if (data.length) receive(event, JSON.parse(data.join('\n')));
        }
    };
}
export async function queryStream(body, signal, progress) {
    const response = await fetch('/api/query/stream', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || `请求失败 (${response.status})`);
    }
    if (!response.body) throw new Error('浏览器未提供响应流');
    let result;
    let failure;
    const parse = createEventParser((event, data) => {
        if (event === 'progress') progress(data);
        if (event === 'result') result = data;
        if (event === 'error') failure = data.error;
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                parse(decoder.decode());
                break;
            }
            parse(decoder.decode(value, { stream: true }));
        }
    } finally {
        reader.releaseLock();
    }
    if (failure) throw new Error(failure);
    if (!result) throw new Error('执行流提前断开，未收到已验证答案');
    return result;
}

export const flowIds = [
    'start',
    'prepare_query',
    'retrieve',
    'grade_evidence',
    'generate',
    'validate_answer',
    'fallback',
    'end',
];
export function projectEvents(events, terminal) {
    const phases = Object.fromEntries(flowIds.map(id => [id, 'waiting']));
    /** @type {Record<string, import('../src/workflow.js').RunEvent>} */
    const details = {};
    const path = [];
    let last = 'start';
    const travelled = new Set();
    for (const event of events) {
        if (event.type === 'run_start') {
            phases.start = 'completed';
            details.start = event;
        }
        if (event.type === 'node_start') {
            travelled.add(`${last}->${event.node}`);
            last = event.node;
            path.push(event.node);
            phases[event.node] = 'running';
            details[event.node] = event;
        }
        if (event.type === 'node_end') {
            phases[event.node] = event.outcome || 'completed';
            details[event.node] = event;
        }
        if (event.type === 'run_end') {
            travelled.add(`${last}->end`);
            phases.end = 'completed';
            details.end = event;
        }
        if (event.type === 'run_error') {
            phases.end = event.outcome;
            details.end = event;
        }
    }
    const ended =
        events.some(e => e.type === 'run_end' || e.type === 'run_error') ||
        terminal;
    if (ended)
        for (const id of flowIds) {
            if (phases[id] === 'waiting')
                phases[id] = id === 'end' ? terminal || 'failed' : 'skipped';
            if (phases[id] === 'running') phases[id] = terminal || 'failed';
        }
    return { phases, details, path, travelled };
}
