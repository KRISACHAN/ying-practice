import {
    buildMessages,
    listSkills,
    runPromptSkill,
    selectSkill,
} from './skills.js';

const args = process.argv.slice(2);
const live = args.includes('--live');
const text = args
    .filter(arg => arg !== '--live')
    .join(' ')
    .trim();

if (!text) {
    console.log('用法: npm run demo -- "我在两个工作机会之间很纠结" [--live]');
    console.log(
        '可用 Skill:',
        listSkills()
            .map(({ id }) => id)
            .join(', '),
    );
    process.exit(0);
}

const selection = selectSkill({ text });
const execution = runPromptSkill(selection);
const messages = buildMessages({ text, selection });

console.log('选择结果:', execution ?? '无 Skill，走普通聊天');
console.log('发送给模型的消息:\n', JSON.stringify(messages, null, 2));

if (!live) {
    console.log(
        '\n当前为演示模式：只展示真实的选择和提示词组装，没有调用模型。',
    );
    process.exit(0);
}

const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = (
    process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
).replace(/\/$/, '');
const model = process.env.OPENAI_MODEL || process.env.AI_MODEL;
if (!apiKey || !model) {
    console.error(
        '--live 需要 OPENAI_API_KEY 和 AI_MODEL（也支持 OPENAI_MODEL）。',
    );
    process.exit(1);
}

try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, temperature: 0.4 }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`模型请求失败：HTTP ${response.status}`);
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== 'string') throw new Error('模型未返回文本回复');
    console.log('\n模型回复:\n', answer);
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
