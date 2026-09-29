import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT ?? 4173);
serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
    console.log(
        `Skill Demo: http://127.0.0.1:${port} or http://localhost:${port}`,
    );
});
