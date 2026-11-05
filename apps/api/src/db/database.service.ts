import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { applyMigrations } from './apply-migrations';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppConfig, repositoryRoot } from '../config';
import * as schema from './schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly sqlite: Database.Database;
  readonly db;
  constructor(config: AppConfig) {
    mkdirSync(dirname(config.databasePath), { recursive: true });
    this.sqlite = new Database(config.databasePath);
    try {
      this.sqlite.pragma('busy_timeout = 5000');
      // Two fresh API/Worker processes can race to change DELETE -> WAL. SQLite
      // may return BUSY immediately for that lock upgrade despite busy_timeout.
      const deadline = Date.now() + 5000;
      for (;;) {
        try {
          this.sqlite.pragma('journal_mode = WAL');
          break;
        } catch (error) {
          if ((error as { code?: string }).code !== 'SQLITE_BUSY' || Date.now() >= deadline) throw error;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        }
      }
      this.sqlite.pragma('synchronous = FULL');
      this.sqlite.pragma('foreign_keys = ON');
      this.db = drizzle(this.sqlite, { schema });
      applyMigrations(this.sqlite, resolve(repositoryRoot, 'apps/api/drizzle'));
    } catch (error) {
      this.sqlite.close();
      throw error;
    }
  }
  onModuleDestroy() {
    if (this.sqlite.open) this.sqlite.close();
  }
}
