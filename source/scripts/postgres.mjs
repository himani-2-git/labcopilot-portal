import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
if (process.platform !== 'win32') throw new Error('This convenience runtime is Windows-only. Use Docker Compose or a PostgreSQL 18 server and set DATABASE_URL/TEST_DATABASE_URL.');
if (!process.env.POSTGRES_PASSWORD) throw new Error('Run pnpm setup:local first.');
const packageRoot = path.join(root, 'node_modules', '@embedded-postgres', 'windows-x64');
function locate(directory, name) {
  if (!existsSync(directory)) return undefined;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.name === name && entry.isFile()) return candidate;
    if (entry.isDirectory()) { const found = locate(candidate, name); if (found) return found; }
  }
}
const control = locate(packageRoot, 'pg_ctl.exe');
const init = locate(packageRoot, 'initdb.exe');
if (!control || !init) throw new Error('PostgreSQL binary package is missing. Run pnpm install with optional dependencies enabled or use an existing PostgreSQL server.');
const runtime = path.join(root, '.runtime');
const data = path.join(runtime, 'postgres');
mkdirSync(runtime, { recursive: true });
function run(file, args, silent = false) {
  const result = spawnSync(file, args, { windowsHide: true, encoding: 'utf8', stdio: silent ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
async function databaseReady() {
  const client = new pg.Client({ host: '127.0.0.1', port: 55432, user: 'labcopilot', password: process.env.POSTGRES_PASSWORD, database: 'postgres', connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}
const command = process.argv[2] ?? 'status';
if (command === 'start') {
  if (!existsSync(path.join(data, 'PG_VERSION'))) {
    const passwordFile = path.join(runtime, 'init-password.txt');
    writeFileSync(passwordFile, process.env.POSTGRES_PASSWORD, { mode: 0o600 });
    try {
      const status = run(init, ['-D', data, '-U', 'labcopilot', '--pwfile=' + passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
      if (status) throw new Error('PostgreSQL initialization failed: ' + status);
    } finally { unlinkSync(passwordFile); }
  }
  if (!(await databaseReady())) {
    const status = run(control, ['-D', data, '-l', path.join(runtime, 'postgres.log'), '-o', '-h 127.0.0.1 -p 55432', '-w', 'start']);
    if (status) throw new Error('PostgreSQL startup failed: ' + status);
  }
  const client = new pg.Client({host:'127.0.0.1', port:55432, user:'labcopilot', password:process.env.POSTGRES_PASSWORD, database:'postgres'});
  await client.connect();
  try {
    for (const name of ['labcopilot', 'labcopilot_test']) {
      const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (!found.rowCount) await client.query('CREATE DATABASE "' + name + '"');
    }
    const result = await client.query('SELECT version()');
    console.log(result.rows[0].version);
    console.log('Local PostgreSQL is ready on 127.0.0.1:55432; development and isolated test databases exist.');
  } finally { await client.end(); }
} else if (command === 'stop') {
  process.exitCode = run(control, ['-D', data, '-m', 'fast', '-w', 'stop']);
} else if (command === 'status') {
  if (await databaseReady()) {
    console.log('PostgreSQL is ready on 127.0.0.1:55432.');
  } else {
    console.error('PostgreSQL is not accepting connections on 127.0.0.1:55432.');
    process.exitCode = 3;
  }
} else throw new Error('Use start, stop or status. This command never deletes a database.');


