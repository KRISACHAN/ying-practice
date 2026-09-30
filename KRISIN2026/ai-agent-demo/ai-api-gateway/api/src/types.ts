export interface KVStore {
    get<T = unknown>(key: string, type: 'json'): Promise<T | null>;
    get(key: string, type?: 'text'): Promise<string | null>;
    put(
        key: string,
        value: string,
        options?: {
            expirationTtl?: number;
        },
    ): Promise<void>;
}

export type Bindings = {
    // 服务端大模型 API Key
    OPENAI_API_KEY: string;
    // 上游兼容 OpenAI 的 base url（如 https://api.openai.com/v1）
    OPENAI_BASE_URL: string;
    // 默认模型名
    OPENAI_MODEL: string;
    // 限流用的 KV
    RATE_LIMIT_KV: KVStore;
    // 用量统计用的 KV
    USAGE_KV: KVStore;
    // API Key 信息存储
    API_KEYS_KV: KVStore;
};

// 存在 KV 里的 API Key 信息
export interface ApiKeyInfo {
    id: string;
    name: string;
    rateLimit: number; // 每分钟最大请求数
    createdAt: number;
}

// 中间件往 context 里塞的变量
export type Variables = {
    apiKeyId: string;
    apiKeyInfo: ApiKeyInfo;
};

// Hono app 的完整类型
export type AppEnv = {
    Bindings: Bindings;
    Variables: Variables;
};

// 聊天请求体
export interface ChatRequest {
    model?: string;
    messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>;
    stream?: boolean;
    temperature?: number;
    max_tokens?: number;
}

// 用量记录
export interface UsageRecord {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    lastUsedAt: number;
}
