import { createApp } from './bootstrap';

async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '127.0.0.1');
  console.info(`LabCopilot development API: http://127.0.0.1:${port}/api/v1/health`);
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'API startup failed.');
  process.exitCode = 1;
});
