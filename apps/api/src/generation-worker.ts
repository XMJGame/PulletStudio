import 'reflect-metadata';
import { setTimeout } from 'node:timers/promises';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { GenerationWorker } from './generation/generation-worker';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const worker = app.get(GenerationWorker);
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('Media generation worker ready');
  try {
    do {
      try {
        await worker.tick();
      } catch {
        console.error('Media generation worker could not update task state');
      }
      if (process.argv.includes('--once') || stopped) break;
      await setTimeout(1000);
    } while (!stopped);
  } finally {
    await app.close();
  }
}
main().catch(() => {
  console.error('Media generation worker failed to start');
  process.exitCode = 1;
});
