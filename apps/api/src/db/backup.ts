import Database from 'better-sqlite3';
import { mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppConfig, repositoryRoot } from '../config';

// Online backup includes committed WAL contents; copying a live .sqlite file does not.
export async function backupDatabase(source: string, directory: string) {
  await mkdir(directory, { recursive: true });
  const target = resolve(
    directory,
    `studio-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.sqlite`,
  );
  const handle = await open(target, 'wx', 0o600);
  await handle.close();
  let database: Database.Database | undefined;
  try {
    database = new Database(source, { readonly: true, fileMustExist: true });
    await database.backup(target);
    const check = new Database(target, { readonly: true, fileMustExist: true });
    try {
      const foreignKeyErrors = check.pragma('foreign_key_check');
      if (
        check.pragma('integrity_check', { simple: true }) !== 'ok' ||
        !Array.isArray(foreignKeyErrors) ||
        foreignKeyErrors.length
      )
        throw new Error('Backup integrity check failed');
    } finally {
      check.close();
    }
    return target;
  } catch (error) {
    await unlink(target);
    throw error;
  } finally {
    database?.close();
  }
}

if (require.main === module) {
  backupDatabase(new AppConfig().databasePath, resolve(repositoryRoot, 'data/backups'))
    .then((target) => console.log(`Verified SQLite backup: ${target}`))
    .catch(() => {
      console.error('Backup failed; verify source database and destination permissions.');
      process.exitCode = 1;
    });
}
