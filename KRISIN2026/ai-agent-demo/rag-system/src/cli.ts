import { readConfig } from './config.js';
import { createModels } from './models.js';
import { Store } from './store.js';
import { fixtures } from './fixtures.js';
import { evaluate } from './evaluation.js';

const config = readConfig();
const models = createModels(config);
const store = new Store(config, models);
try {
    switch (process.argv[2]) {
        case 'init':
            await store.init();
            console.log('数据库结构已初始化');
            break;
        case 'seed':
            for (const doc of fixtures)
                console.log(await store.ingest(config.RAG_TENANT_ID, doc));
            break;
        case 'eval': {
            const result = await evaluate(
                config,
                store,
                models,
                config.RAG_TENANT_ID,
            );
            console.log(JSON.stringify(result, null, 2));
            if (result.passed !== result.total) process.exitCode = 1;
            break;
        }
        default:
            throw new Error('USAGE: init | seed | eval');
    }
} catch (error) {
    // 配置校验只含字段名；数据库和模型错误不输出可能含密钥的原始对象。
    console.error(
        error instanceof Error && /USAGE:/.test(error.message)
            ? error.message
            : '命令失败：检查 .env.local、PostgreSQL/pgvector 和模型配置。',
    );
    process.exitCode = 1;
} finally {
    await store.close();
}
