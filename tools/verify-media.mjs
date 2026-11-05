import { createRequire } from 'node:module';
import { lstat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
/** Read-only verification of a consistent DB + media copy. Never deletes or repairs files. */
export async function verifyMedia(databasePath, mediaRoot) {
  const Database = require('better-sqlite3');
  const { LocalStorage } = require('../apps/api/dist/storage/local-storage.js');
  const db = new Database(databasePath, { readonly: true, fileMustExist: true }),
    storage = new LocalStorage({ mediaRoot: resolve(mediaRoot) });
  const manifest = {
    schemaVersion: 'studio.media-manifest.v1',
    checkedAt: new Date().toISOString(),
    storageId: null,
    valid: true,
    pendingUploads: 0,
    files: [],
    errors: [],
  };
  try {
    db.exec('BEGIN');
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length)
      throw new Error('DATABASE_INTEGRITY');
    const count = db.prepare('SELECT COUNT(*) n FROM media_versions').get().n;
    manifest.pendingUploads = db
      .prepare("SELECT COUNT(*) n FROM media_uploads WHERE state IN ('uploading','needs_reconciliation')")
      .get().n;
    try {
      await lstat(resolve(mediaRoot, '.pullet-storage.json'));
      manifest.storageId = await storage.ready();
    } catch (error) {
      if (count || error.code !== 'ENOENT') throw error;
    }
    if (manifest.pendingUploads) {
      manifest.valid = false;
      manifest.errors.push({
        code: 'MEDIA_JOBS_PENDING',
        message: '请先完成或核对上传任务，再制作一致备份。',
      });
    }
    for (const row of db
      .prepare('SELECT id,storage_id,object_key,byte_length,sha256,poster_json FROM media_versions')
      .iterate()) {
      if (row.storage_id !== manifest.storageId) {
        manifest.valid = false;
        manifest.errors.push({ mediaVersionId: row.id, code: 'STORAGE_CONNECTION_UNAVAILABLE' });
        continue;
      }
      const files = [
        { key: row.object_key, bytes: row.byte_length, sha256: row.sha256, role: 'original' },
        ...(row.poster_json ? [{ ...JSON.parse(row.poster_json), role: 'poster' }] : []),
      ];
      for (const file of files) {
        try {
          const actual = await storage.digest(file.key);
          if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256)
            throw new Error('MEDIA_INTEGRITY_FAILED');
          manifest.files.push({
            mediaVersionId: row.id,
            role: file.role,
            key: file.key,
            bytes: file.bytes,
            sha256: file.sha256,
          });
        } catch {
          manifest.valid = false;
          manifest.errors.push({ mediaVersionId: row.id, role: file.role, code: 'MEDIA_INTEGRITY_FAILED' });
        }
      }
    }
    db.exec('ROLLBACK');
    return manifest;
  } finally {
    db.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { AppConfig } = require('../apps/api/dist/config.js'),
      config = new AppConfig();
    const args = process.argv.slice(2);
    const option = (name) => {
      const index = args.indexOf(name);
      return index >= 0 ? args[index + 1] : undefined;
    };
    const manifest = await verifyMedia(
      option('--database') ?? config.databasePath,
      option('--root') ?? config.mediaRoot,
    );
    const output = option('--out');
    if (output)
      await writeFile(resolve(output), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(
      JSON.stringify({
        valid: manifest.valid,
        files: manifest.files.length,
        pendingUploads: manifest.pendingUploads,
        errors: manifest.errors.length,
      }),
    );
    if (!manifest.valid) process.exitCode = 1;
  } catch {
    console.error(
      'Media verification failed. Check the database copy and media root; no repair was attempted.',
    );
    process.exitCode = 1;
  }
}
