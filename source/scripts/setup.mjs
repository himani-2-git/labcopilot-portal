import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, '.env');
if (existsSync(target)) {
  console.log('Existing source/.env preserved. No credentials changed.');
} else {
  const databasePassword = randomBytes(24).toString('hex');
  const demoPassword = randomBytes(16).toString('base64url');
  writeFileSync(target, [
    'NODE_ENV=development', 'AUTH_MODE=development', 'PORT=3001',
    'WEB_ORIGIN=http://localhost:5173',
    'DATABASE_URL=postgresql://labcopilot:' + databasePassword + '@127.0.0.1:55432/labcopilot?schema=public',
    'TEST_DATABASE_URL=postgresql://labcopilot:' + databasePassword + '@127.0.0.1:55432/labcopilot_test?schema=public',
    'POSTGRES_PASSWORD=' + databasePassword, 'DEMO_PASSWORD=' + demoPassword, ''
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  console.log('Created source/.env with generated private development credentials.');
}
mkdirSync(path.join(root, '.runtime'), { recursive: true });
console.log('Next: pnpm db:start, pnpm db:generate, pnpm db:migrate, pnpm db:seed.');

