import type { KVStore, UsageRecord } from '../types';

export async function recordUsage(
    kv: KVStore,
    apiKeyId: string,
    promptTokens: number,
    completionTokens: number,
) {
    const key = `usage:${apiKeyId}`;
    const existing = await kv.get<UsageRecord>(key, 'json');

    const record: UsageRecord = {
        totalRequests: (existing?.totalRequests || 0) + 1,
        totalPromptTokens: (existing?.totalPromptTokens || 0) + promptTokens,
        totalCompletionTokens:
            (existing?.totalCompletionTokens || 0) + completionTokens,
        lastUsedAt: Date.now(),
    };

    await kv.put(key, JSON.stringify(record));
}

// 按天记录，方便查看趋势
export async function recordDailyUsage(
    kv: KVStore,
    apiKeyId: string,
    promptTokens: number,
    completionTokens: number,
) {
    const today = new Date().toISOString().slice(0, 10); // "2024-12-01"
    const key = `usage:${apiKeyId}:${today}`;
    const existing = await kv.get<UsageRecord>(key, 'json');

    const record: UsageRecord = {
        totalRequests: (existing?.totalRequests || 0) + 1,
        totalPromptTokens: (existing?.totalPromptTokens || 0) + promptTokens,
        totalCompletionTokens:
            (existing?.totalCompletionTokens || 0) + completionTokens,
        lastUsedAt: Date.now(),
    };

    // 每日记录保留 90 天
    await kv.put(key, JSON.stringify(record), { expirationTtl: 86400 * 90 });
}
