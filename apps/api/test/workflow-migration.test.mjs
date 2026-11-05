import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from '../dist/db/apply-migrations.js';
import { DatabaseService } from '../dist/db/database.service.js';
import { fixtureWorkflow } from '../../../tests/fixtures/comfy-mock.mjs';
test('0035 adopts legacy immutable workflows without modifying any pre-existing rows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-workflow-upgrade-')),
    source = fileURLToPath(new URL('../drizzle', import.meta.url));
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
  const folder = join(directory, 'old');
  await mkdir(join(folder, 'meta'), { recursive: true });
  const old = { ...journal, entries: journal.entries.filter((entry) => entry.idx < 35) };
  await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(old));
  for (const entry of old.entries)
    await copyFile(join(source, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  let legacy, next;
  try {
    const path = join(directory, 'studio.sqlite');
    legacy = new Database(path);
    legacy.pragma('foreign_keys=ON');
    applyMigrations(legacy, folder);
    const owner = randomUUID(),
      workspace = randomUUID(),
      project = randomUUID(),
      connection = randomUUID(),
      workflow = randomUUID(),
      now = new Date().toISOString(),
      definition = JSON.stringify(fixtureWorkflow(connection));
    legacy
      .prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)')
      .run(owner, 'old@test.local', 'Old owner', 'fixture', now);
    legacy
      .prepare('INSERT INTO workspaces (id,name,slug,created_by,created_at) VALUES (?,?,?,?,?)')
      .run(workspace, 'Old workspace', 'old', owner, now);
    legacy
      .prepare('INSERT INTO projects (id,workspace_id,code,title,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .run(project, workspace, 'FILM01', 'Old project', now, now);
    legacy
      .prepare(
        'INSERT INTO generation_connections (id,workspace_id,name,base_url,trusted_private,created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(connection, workspace, 'Old connection', 'http://127.0.0.1:1', 1, now);
    legacy
      .prepare(
        'INSERT INTO generation_workflows (id,workspace_id,project_id,connection_id,name,capability,definition_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .run(
        workflow,
        workspace,
        project,
        connection,
        'Old immutable definition',
        'image.text_to_image',
        definition,
        owner,
        now,
      );
    const names = legacy
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations'",
      )
      .all()
      .map((row) => row.name);
    const rows = Object.fromEntries(
      names.map((name) => [name, legacy.prepare(`SELECT * FROM "${name}"`).all()]),
    );
    const hashes = legacy
      .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
      .all();
    legacy.close();
    legacy = undefined;
    next = new DatabaseService({ databasePath: path });
    for (const name of names)
      assert.deepEqual(next.sqlite.prepare(`SELECT * FROM "${name}"`).all(), rows[name], name);
    assert.deepEqual(
      next.sqlite
        .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at LIMIT 35')
        .all(),
      hashes,
    );
    const adopted = next.sqlite.prepare('SELECT * FROM workflow_catalogs WHERE id=?').get(workflow);
    assert.equal(adopted.head_workflow_id, workflow);
    assert.equal(adopted.version, 1);
    assert.equal(adopted.revision, 1);
    assert.equal(adopted.archived, 0);
    assert.equal(
      next.sqlite
        .prepare('SELECT family_id FROM workflow_catalog_revisions WHERE workflow_id=?')
        .get(workflow).family_id,
      workflow,
    );
    assert.equal(next.sqlite.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(next.sqlite.pragma('foreign_key_check'), []);
  } finally {
    if (legacy?.open) legacy.close();
    next?.onModuleDestroy();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
