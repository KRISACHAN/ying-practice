import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readConfig } from './config.js';

// 可选的原生 PostgreSQL 启动入口；只管理本项目 .data，绝不停止系统中的其他实例。
const config = readConfig();
const url = new URL(config.DATABASE_URL);
if (
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !url.port ||
    !url.username ||
    !url.password
)
    throw new Error('db:local 需要带端口与用户名密码的本机 DATABASE_URL');
const data = fileURLToPath(new URL('../.data/postgres', import.meta.url));
const parent = fileURLToPath(new URL('../.data/', import.meta.url));
const log = fileURLToPath(new URL('../.data/postgres.log', import.meta.url));
const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, { stdio: 'inherit' });
if (process.argv[2] === 'stop') {
    run('pg_ctl', ['-D', data, 'stop', '-m', 'fast']);
} else {
    await mkdir(parent, { recursive: true });
    let initialized = true;
    try {
        await readFile(`${data}/PG_VERSION`);
    } catch {
        initialized = false;
    }
    if (!initialized) {
        const passwordFile = `${parent}/.init-password`;
        await writeFile(passwordFile, decodeURIComponent(url.password), {
            mode: 0o600,
        });
        try {
            run('initdb', [
                '-D',
                data,
                '-U',
                decodeURIComponent(url.username),
                '-A',
                'scram-sha-256',
                '--pwfile',
                passwordFile,
                '--encoding=UTF8',
                '--no-locale',
            ]);
        } finally {
            await unlink(passwordFile);
        }
    }
    let running = false;
    try {
        execFileSync('pg_ctl', ['-D', data, 'status'], { stdio: 'ignore' });
        running = true;
    } catch {
        /* 未启动。 */
    }
    // 使用 TCP，避免深层项目路径超过 Unix socket 路径长度限制。
    if (!running)
        run('pg_ctl', [
            '-D',
            data,
            '-l',
            log,
            '-o',
            `-h 127.0.0.1 -p ${Number(url.port)} -k ''`,
            'start',
        ]);
    const db = decodeURIComponent(url.pathname.slice(1));
    if (!/^[a-zA-Z0-9_]+$/.test(db))
        throw new Error('db:local 仅支持字母、数字、下划线数据库名');
    const adminUrl = new URL(url);
    adminUrl.pathname = '/postgres';
    const pool = new pg.Pool({ connectionString: adminUrl.toString() });
    try {
        const exists = await pool.query(
            'SELECT 1 FROM pg_database WHERE datname=$1',
            [db],
        );
        if (!exists.rowCount) await pool.query(`CREATE DATABASE "${db}"`);
        console.log(
            `本项目 PostgreSQL 已就绪，端口 ${url.port}；数据保存在 .data/postgres。`,
        );
    } finally {
        await pool.end();
    }
}
