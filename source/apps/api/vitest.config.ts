import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], fileParallelism: false, hookTimeout: 60000, testTimeout: 15000 } });
