import { Hono } from 'hono';
import type { AppEnv, UsageRecord } from '../types';

const usage: any = new Hono<AppEnv>();

// 查询总用量
usage.get('/usage', async (c: any) => {
    const apiKeyId = c.get('apiKeyId');
    const record = (await c.env.USAGE_KV.get(
        `usage:${apiKeyId}`,
        'json',
    )) as UsageRecord | null;

    if (!record) {
        return c.json({
            totalRequests: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
            lastUsedAt: null,
        });
    }

    return c.json(record);
});

// 查询某天的用量
usage.get('/usage/:date', async (c: any) => {
    const apiKeyId = c.get('apiKeyId');
    const date = c.req.param('date'); // "2024-12-01"

    const record = (await c.env.USAGE_KV.get(
        `usage:${apiKeyId}:${date}`,
        'json',
    )) as UsageRecord | null;

    if (!record) {
        return c.json({
            date,
            totalRequests: 0,
            totalPromptTokens: 0,
            totalCompletionTokens: 0,
        });
    }

    return c.json({ date, ...record });
});

// 查询最近 N 天的用量趋势
usage.get('/usage/trend/:days', async (c: any) => {
    const apiKeyId = c.get('apiKeyId');
    const days = parseInt(c.req.param('days')) || 7;

    const trend = [];
    for (let i = 0; i < days; i++) {
        const date = new Date(Date.now() - i * 86400000)
            .toISOString()
            .slice(0, 10);
        const record = (await c.env.USAGE_KV.get(
            `usage:${apiKeyId}:${date}`,
            'json',
        )) as UsageRecord | null;
        trend.push({
            date,
            requests: record?.totalRequests || 0,
            promptTokens: record?.totalPromptTokens || 0,
            completionTokens: record?.totalCompletionTokens || 0,
        });
    }

    return c.json({ trend: trend.reverse() });
});

export default usage;
