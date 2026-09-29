// 最小 Prompt Skill：声明能力、注册、选择、执行。没有多轮状态或工具权限。
const registry = [
    {
        manifest: {
            id: 'active-listening',
            version: '1.0.0',
            name: '主动倾听',
            priority: 10,
        },
        patterns: [/倾诉|听我说|不想听建议/, /难过|委屈|孤独/],
        instruction:
            '先接住用户的具体感受，不急于建议；最多问一个容易回答的问题，不做心理诊断。',
    },
    {
        manifest: {
            id: 'decision-clarifier',
            version: '1.0.0',
            name: '决策澄清',
            priority: 20,
        },
        patterns: [/纠结|怎么选|该不该/, /选择|利弊|两个.*机会/],
        instruction:
            '先明确选项、硬约束和最关键的取舍；信息不足时只追问一个关键问题，不替用户做最终决定。',
    },
    {
        manifest: {
            id: 'goal-breakdown',
            version: '1.0.0',
            name: '目标拆解',
            priority: 5,
        },
        patterns: [/无从下手|第一步|拆解/, /计划|目标|准备考试/],
        instruction:
            '把目标整理成 3 到 5 个有顺序的行动，并指出现在就能做的最小第一步。',
    },
];

const ids = new Set();
for (const skill of registry) {
    const { manifest } = skill;
    if (!/^[a-z][a-z0-9-]*$/.test(manifest.id) || ids.has(manifest.id)) {
        throw new Error(`无效或重复的 Skill ID: ${manifest.id}`);
    }
    if (!skill.patterns.length || !skill.instruction.trim()) {
        throw new Error(`Skill 定义不完整: ${manifest.id}`);
    }
    ids.add(manifest.id);
}

export function listSkills() {
    return registry.map(({ manifest }) => manifest);
}

export function selectSkill({ text }) {
    const input = text.trim();
    const explicitId = input.match(
        /^\/(?:skill\s+)?([a-z][a-z0-9-]*)(?:\s|$)/,
    )?.[1];
    if (explicitId) {
        const skill = registry.find(
            ({ manifest }) => manifest.id === explicitId,
        );
        // 显式命令也必须通过 Registry 检查；不能调用不存在的 Skill。
        return skill ? { skill, trigger: 'explicit', score: 100 } : null;
    }

    const matches = registry
        .map(skill => ({
            skill,
            trigger: 'rule',
            score:
                skill.patterns.filter(pattern => pattern.test(input)).length *
                6,
        }))
        .filter(({ score }) => score >= 6)
        .sort(
            (a, b) =>
                b.score - a.score ||
                b.skill.manifest.priority - a.skill.manifest.priority ||
                a.skill.manifest.id.localeCompare(b.skill.manifest.id),
        );
    return matches[0] ?? null; // 每轮最多一个 Skill，避免过程指令互相竞争。
}

export function runPromptSkill(selection) {
    if (!selection) return null;
    return {
        skillId: selection.skill.manifest.id,
        version: selection.skill.manifest.version,
        trigger: selection.trigger,
        systemInstruction: selection.skill.instruction,
    };
}

export function buildMessages({ text, selection }) {
    const result = runPromptSkill(selection);
    return [
        {
            role: 'system',
            content: [
                '你是帮助用户思考的 AI 助手。遵守安全边界，清楚说明不确定性。',
                result ? `本轮回复方法：${result.systemInstruction}` : '',
            ]
                .filter(Boolean)
                .join('\n'),
        },
        { role: 'user', content: text },
    ];
}
