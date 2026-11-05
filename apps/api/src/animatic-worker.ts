import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { setTimeout } from 'node:timers/promises';
import { AppModule } from './app.module';
import { AnimaticWorker } from './timeline/animatic-worker';
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  let stopped = false;
  process.on('SIGINT', () => {
    stopped = true;
  });
  process.on('SIGTERM', () => {
    stopped = true;
  });
  console.log('Animatic worker ready');
  try {
    do {
      try {
        await app.get(AnimaticWorker).tick();
      } catch {
        console.error('Animatic worker could not update task state');
      }
      if (stopped || process.argv.includes('--once')) break;
      await setTimeout(1000);
    } while (!stopped);
  } finally {
    await app.close();
  }
}
main().catch(() => {
  console.error('Animatic worker failed to start');
  process.exitCode = 1;
});
