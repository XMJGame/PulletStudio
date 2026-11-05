import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from '../dist/db/apply-migrations.js';
import { DatabaseService } from '../dist/db/database.service.js';
test('G1 upgrades an existing 0031 database without changing any old rows or applied hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-board-upgrade-'));
  assert.equal(dirname(directory), tmpdir());
  const source = fileURLToPath(new URL('../drizzle', import.meta.url));
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
  const old = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 32) };
  const folder = join(directory, 'old-migrations');
  await mkdir(join(folder, 'meta'), { recursive: true });
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(old));
  for (const entry of old.entries)
    await copyFile(join(source, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  const path = join(directory, 'studio.sqlite');
  let legacy, upgraded;
  try {
    legacy = new Database(path);
    legacy.pragma('foreign_keys = ON');
    applyMigrations(legacy, folder);
    const user = randomUUID(),
      workspace = randomUUID(),
      project = randomUUID(),
      unit = randomUUID(),
      now = new Date().toISOString();
    legacy
      .prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)')
      .run(user, 'legacy@test.local', 'Old creator', 'fixture-only', now);
    legacy
      .prepare('INSERT INTO workspaces (id,name,slug,created_by,created_at) VALUES (?,?,?,?,?)')
      .run(workspace, 'Old workspace', 'legacy', user, now);
    legacy
      .prepare('INSERT INTO projects (id,workspace_id,code,title,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(project, workspace, 'LEGACY01', 'Existing project', now, now);
    legacy
      .prepare(
        'INSERT INTO episodes (id,workspace_id,project_id,code,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      )
      .run(unit, workspace, project, 'EP001', 'Existing unit', now, now);
    legacy
      .prepare(
        'INSERT INTO shots (id,workspace_id,project_id,episode_id,code,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(randomUUID(), workspace, project, unit, 'SH001', 'Existing shot', now, now);
    const tables = legacy
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    const snapshot = Object.fromEntries(
      tables.map((name) => [name, legacy.prepare(`SELECT * FROM "${name}"`).all()]),
    );
    const oldHashes = legacy
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
      .all();
    legacy.close();
    legacy = undefined;
    upgraded = new DatabaseService({ databasePath: path });
    for (const name of tables)
      assert.deepEqual(upgraded.sqlite.prepare(`SELECT * FROM "${name}"`).all(), snapshot[name], name);
    const applied = upgraded.sqlite
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
      .all();
    assert.equal(applied.length, 35);
    assert.deepEqual(applied.slice(0, 32), oldHashes);
    for (const [index, entry] of journal.entries.entries())
      assert.equal(
        applied[index].hash,
        createHash('sha256')
          .update(await readFile(join(source, `${entry.tag}.sql`)))
          .digest('hex'),
      );
    assert.equal(upgraded.sqlite.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(upgraded.sqlite.pragma('foreign_key_check'), []);
    assert.equal(upgraded.sqlite.prepare('SELECT COUNT(*) n FROM boards').get().n, 0);
    assert.equal(upgraded.sqlite.prepare('SELECT COUNT(*) n FROM board_revisions').get().n, 0);
  } finally {
    if (legacy?.open) legacy.close();
    upgraded?.onModuleDestroy();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
