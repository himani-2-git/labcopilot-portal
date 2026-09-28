import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {cwd:root, encoding:'utf8'}).split('\0').filter(Boolean);
const findings = [];
const patterns = [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/, /postgres(?:ql)?:\/\/[^\s:]+:[^\s@$<]+@/];
for (const file of files) {
  if (file.endsWith('.pdf') || file.endsWith('pnpm-lock.yaml') || file.endsWith('check-secrets.mjs')) continue;
  if (/(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example')) { findings.push(file + ': private environment file is visible to Git'); continue; }
  const text = readFileSync(path.join(root,file),'utf8');
  if (patterns.some(pattern => pattern.test(text))) findings.push(file + ': possible embedded credential');
}
if (findings.length) { console.error(findings.join('\n')); process.exitCode=1; }
else console.log('No private environment files or recognized credential patterns in Git-visible files. This focused scan is not a complete security audit.');

