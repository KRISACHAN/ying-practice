import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessages, selectSkill } from './skills.js';

test('普通聊天不误触发 Skill', () => {
    assert.equal(selectSkill({ text: '今天午饭吃了面' }), null);
});

test('显式选择优先，但不能绕过 Registry', () => {
    assert.equal(
        selectSkill({ text: '/goal-breakdown 帮我准备考试' }).skill.manifest.id,
        'goal-breakdown',
    );
    assert.equal(selectSkill({ text: '/unknown 做点事' }), null);
});

test('自动选择后只注入一个 Skill 指令', () => {
    const text = '两个工作机会让我很纠结，怎么选？';
    const selection = selectSkill({ text });
    assert.equal(selection.skill.manifest.id, 'decision-clarifier');
    const messages = buildMessages({ text, selection });
    assert.equal(messages.length, 2);
    assert.match(messages[0].content, /本轮回复方法：先明确选项/);
    assert.equal(messages[1].content, text);
});
