import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TextAnalysisWorker } from './analysis/text-analysis-worker';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const worker = app.get(TextAnalysisWorker);
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  worker.announce();
  console.log('Text analysis worker ready');
  try {
    do {
      try {
        await worker.tick();
      } catch {
        console.error('Text worker persistence unavailable; pending leases will recover');
      }
      if (process.argv.includes('--once')) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } while (!stopped);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await app.close();
  }
}
main().catch(() => {
  console.error('Text worker failed to start; check database and configuration');
  process.exitCode = 1;
});
