import test from 'node:test';
import assert from 'node:assert/strict';
import { createEventParser, projectEvents } from '../web/events.js';

test('SSE 跨网络块保留中文事件、忽略注释且解析多个帧', () => {
    const frames: { event: string; data: unknown }[] = [];
    const parse = createEventParser((event: string, data: unknown) =>
        frames.push({ event, data }),
    );
    const text =
        ': heartbeat\r\n\r\nevent: progress\r\ndata: {"node":"整理查询"}\r\n\r\nevent: result\ndata: {"status":"passed"}\n\n';
    for (const char of text) parse(char);
    assert.deepEqual(frames, [
        { event: 'progress', data: { node: '整理查询' } },
        { event: 'result', data: { status: 'passed' } },
    ]);
});
test('事件回看还原运行中状态，分支未执行及取消不会被标记完成', () => {
    const start = { type: 'run_start' };
    const entered = { type: 'node_start', node: 'prepare_query' };
    const ended = {
        type: 'node_end',
        node: 'prepare_query',
        outcome: 'completed',
    };
    const fallback = { type: 'node_start', node: 'fallback' };
    const stopped = {
        type: 'node_end',
        node: 'fallback',
        outcome: 'completed',
    };
    const finish = { type: 'run_end' };
    assert.equal(
        projectEvents([start, entered]).phases.prepare_query,
        'running',
    );
    const final = projectEvents([
        start,
        entered,
        ended,
        fallback,
        stopped,
        finish,
    ]);
    assert.equal(final.phases.generate, 'skipped');
    assert.equal(final.phases.validate_answer, 'skipped');
    assert.equal(final.phases.end, 'completed');
    assert.ok(final.travelled.has('prepare_query->fallback'));
    assert.equal(
        projectEvents([start, entered], 'cancelled').phases.prepare_query,
        'cancelled',
    );
    assert.equal(
        projectEvents([start, entered, ended]).phases.generate,
        'waiting',
    );
});
