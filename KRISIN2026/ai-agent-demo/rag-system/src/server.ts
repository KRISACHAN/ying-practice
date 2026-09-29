import { serve } from '@hono/node-server';
import { readConfig } from './config.js';
import { createModels } from './models.js';
import { Store } from './store.js';
import { createApp } from './app.js';

const config = readConfig();
const models = createModels(config);
const store = new Store(config, models);
const server = serve({
    fetch: createApp(config, store, models).fetch,
    hostname: '127.0.0.1',
    port: config.PORT,
});
console.log(`RAG Lab: http://127.0.0.1:${config.PORT} (${config.RAG_MODE})`);
for (const event of ['SIGINT', 'SIGTERM'])
    process.on(event, () => {
        server.close(() => {
            void store.close().then(() => process.exit(0));
        });
    });
