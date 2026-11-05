import type Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';

// Drizzle's sync migrator reads the journal before BEGIN. Use its migration reader
// and journal format, but acquire a write lock before reading for multi-process startup.
export function applyMigrations(database: Database.Database, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  database
    .transaction(() => {
      database.exec(
        'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)',
      );
      const last = database
        .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
        .get() as { created_at: number } | undefined;
      const insert = database.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)');
      for (const migration of migrations) {
        if (last && Number(last.created_at) >= migration.folderMillis) continue;
        for (const statement of migration.sql) database.exec(statement);
        insert.run(migration.hash, migration.folderMillis);
      }
    })
    .immediate();
}
