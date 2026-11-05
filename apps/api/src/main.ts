import { createApplication } from './application';
import { AppConfig } from './config';

async function bootstrap() {
  const app = await createApplication();
  // Deployment hardening and LAN access are a later acceptance gate.
  await app.listen(app.get(AppConfig).port, '127.0.0.1');
  console.log(`Pullet Studio API listening at ${await app.getUrl()}`);
}
bootstrap().catch((err: unknown) => {
  console.error('API bootstrap failed', err);
  process.exitCode = 1;
});
