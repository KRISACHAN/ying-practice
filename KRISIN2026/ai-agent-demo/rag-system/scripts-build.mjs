import { build } from 'esbuild';
// 本地打包 React Flow，浏览器无需访问 CDN。dev 启动前自动重建。
await build({
    entryPoints: ['web/react/flow.tsx'],
    bundle: true,
    format: 'esm',
    outdir: 'web/dist',
    jsx: 'automatic',
    minify: true,
    target: ['es2022'],
    define: { 'process.env.NODE_ENV': '"production"' },
});
