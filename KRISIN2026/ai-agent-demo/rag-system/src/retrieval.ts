export type Candidate = {
    id: string;
    sourceId: string;
    title: string;
    revision: number;
    content: string;
    vectorScore: number;
    keywordScore: number;
    vectorRank?: number;
    keywordRank?: number;
    rrfScore: number;
};
const STOP = new Set([
    '怎么',
    '如何',
    '什么',
    '需要',
    '可以',
    '是否',
    '我的',
    '一个',
    '哪些',
    '这个',
    '那个',
    '我们',
    '时候',
]);
export function terms(text: string): string[] {
    // simple FTS 不会自动完成中文分词。演示使用中文二元组 + 完整英文标识；不是 BM25。
    const result = new Set<string>();
    for (const token of text
        .normalize('NFKC')
        .toLowerCase()
        .match(/[a-z0-9_./-]+|[\p{Script=Han}]+/gu) ?? []) {
        if (/^[\p{Script=Han}]+$/u.test(token)) {
            const chars = [...token];
            for (let i = 0; i < chars.length - 1; i++) {
                const word = chars[i] + chars[i + 1];
                if (!STOP.has(word)) result.add(word);
            }
        } else if (token.length > 1) result.add(token);
    }
    return [...result].slice(0, 2000);
}
export function demoVector(text: string): number[] {
    // 可复现的特征哈希用于离线讲解数据流，不具备真实语义 Embedding 的同义词能力。
    const vector = Array<number>(256).fill(0);
    for (const word of terms(text)) {
        let code = 2166136261;
        for (const ch of word)
            code = Math.imul(code ^ ch.codePointAt(0)!, 16777619);
        vector[(code >>> 0) & 255] += 1;
    }
    const norm = Math.hypot(...vector);
    return vector.map(value => value / (norm || 1));
}
export function vectorLiteral(vector: number[], dimensions: number) {
    if (
        vector.length !== dimensions ||
        vector.some(v => !Number.isFinite(v)) ||
        !vector.some(v => v !== 0)
    )
        throw new Error('INVALID_EMBEDDING');
    return `[${vector.join(',')}]`;
}
export function fuse(vector: Candidate[], keyword: Candidate[]): Candidate[] {
    const merged = new Map<string, Candidate>();
    // 两路分数不同尺度；按排名融合，不把余弦值与关键词得分直接相加。
    for (const [kind, list] of [
        ['vector', vector],
        ['keyword', keyword],
    ] as const) {
        list.forEach((item, index) => {
            const current = merged.get(item.id) ?? { ...item, rrfScore: 0 };
            current.rrfScore += 1 / (60 + index + 1);
            if (kind === 'vector') current.vectorRank = index + 1;
            else current.keywordRank = index + 1;
            merged.set(item.id, current);
        });
    }
    return [...merged.values()].sort(
        (a, b) => b.rrfScore - a.rrfScore || a.id.localeCompare(b.id),
    );
}
export function selectEvidence(
    candidates: Candidate[],
    options: {
        contextK: number;
        budget: number;
        minVector: number;
        minKeyword: number;
    },
) {
    const selected: Candidate[] = [];
    const seen = new Set<string>();
    let length = 0;
    for (const item of candidates) {
        if (
            item.vectorScore < options.minVector &&
            item.keywordScore < options.minKeyword
        )
            continue;
        const identity = `${item.sourceId}:${item.content}`;
        if (seen.has(identity) || length + item.content.length > options.budget)
            continue;
        selected.push(item);
        seen.add(identity);
        length += item.content.length;
        if (selected.length >= options.contextK) break;
    }
    return selected;
}
export function validateCitations(
    answer: string,
    citedIds: string[],
    evidence: Candidate[],
) {
    const allowed = new Set(evidence.map((_, i) => `S${i + 1}`));
    const inline = [...answer.matchAll(/\[(S\d+)\]/g)].map(m => m[1]);
    const citations = [...new Set(citedIds)];
    if (
        !answer.trim() ||
        !citations.length ||
        !inline.length ||
        citations.some(id => !allowed.has(id) || !inline.includes(id)) ||
        inline.some(id => !allowed.has(id) || !citations.includes(id))
    )
        throw new Error('INVALID_CITATIONS');
    // ID 合法只证明引用来自给定上下文；事实是否受支持仍需 groundedness 评测。
    return citations;
}
