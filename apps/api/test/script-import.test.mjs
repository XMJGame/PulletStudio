import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

test('script import, original evidence, source offsets and explicit locks', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-script-import-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.SETUP_TOKEN = 'script-import-local-test-setup-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  let app, base, workspace, project, imported;
  async function start() { app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); }
  function client() {
    let cookies = '', csrf = '';
    return { async request(method, path, body, raw = false) {
      const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', 'X-CSRF-Token': csrf, Cookie: cookies }, body: body === undefined ? undefined : JSON.stringify(body) });
      const incoming = response.headers.getSetCookie(); if (incoming.length) cookies = incoming.map(value => value.split(';')[0]).join('; ');
      const data = raw ? Buffer.from(await response.arrayBuffer()) : await response.json(); if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data, headers: response.headers };
    } };
  }
  const owner = client(), editor = client(), viewer = client(), outsider = client();
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const text = '# Rainy platform\r\nMira: "The train is late." 🚆\r\n\r\nNoah closes the blue umbrella.\n';
  const bytes = Buffer.from('\uFEFF' + text, 'utf8');
  const payload = { expectedVersion: 0, title: 'Rainy platform', kind: 'script', source: { type: 'file', fileName: 'Platform.md', base64: bytes.toString('base64') } };
  const path = suffix => `/projects/${project.id}/script${suffix}`;
  async function add(target, email, workspaceId) {
    const invite = await owner.request('POST', `/workspaces/${workspaceId}/invitations`, { email });
    const accepted = await target.request('POST', '/invitations/accept', { token: invite.data.token, name: email, password: 'Studio8!' });
    assert.equal(accepted.status, 201); return accepted.data.user.id;
  }
  try {
    await start();
    const setup = await owner.request('POST', '/setup/initialize', { setupToken: process.env.SETUP_TOKEN, email: 'owner@import.test', password: 'Studio8!', name: 'Owner', workspaceName: 'Script imports' });
    workspace = setup.data.workspace;
    project = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Generic film' })).data;
    for (const [target, email, role] of [[editor, 'editor@import.test', 'EDITOR'], [viewer, 'viewer@import.test', 'VIEWER']]) {
      const id = await add(target, email, workspace.id);
      assert.equal((await owner.request('POST', `/projects/${project.id}/members`, { userId: id, role })).status, 201);
    }
    const other = (await owner.request('POST', '/workspaces', { name: 'Unrelated' })).data;
    await add(outsider, 'outside@import.test', other.id);
    await t.test('invalid encodings, names, file types, blank and oversized sources do not create revisions', async () => {
      const badSources = [
        { ...payload.source, fileName: '../escape.md' },
        { ...payload.source, fileName: 'fake.pdf' },
        { ...payload.source, base64: 'not base64' },
        { ...payload.source, base64: Buffer.from([0xff, 0xfe, 0x61]).toString('base64') },
        { type: 'paste', text: '   ' },
        { type: 'paste', text: 'x'.repeat(60001) },
        { ...payload.source, base64: Buffer.from('x'.repeat(180001)).toString('base64') },
        { type: 'paste', text: 'null\u0000byte' },
        { type: 'paste', text: 'invalid\ud800' },
      ];
      for (const source of badSources) assert.equal((await editor.request('POST', path('/import'), { ...payload, source })).status, 400);
      assert.equal((await owner.request('GET', path(''))).data.version, 0);
    });
    await t.test('import commits an immutable version and returns exact original bytes and both hashes', async () => {
      const result = await editor.request('POST', path('/import'), payload);
      assert.equal(result.status, 201); imported = result.data;
      assert.equal(imported.version, 1); assert.equal(imported.content, text);
      assert.equal(imported.checksum, hash(text)); assert.equal(imported.source.sha256, hash(bytes));
      assert.equal(imported.source.kind, 'script'); assert.equal(imported.source.byteLength, bytes.length);
      const download = await viewer.request('GET', path('/versions/1/source'), undefined, true);
      assert.equal(download.status, 200); assert.deepEqual(download.data, bytes);
      assert.match(download.headers.get('content-disposition'), /attachment/);
      assert.equal(download.headers.get('cache-control'), 'no-store');
      const sqlite = app.get(DatabaseService).sqlite;
      assert.throws(() => sqlite.prepare('UPDATE script_sources SET file_name = ?').run('tampered'), /immutable/);
      assert.throws(() => sqlite.prepare('DELETE FROM script_sources').run(), /immutable/);
      assert.equal((await editor.request('POST', path('/import'), payload)).status, 409);
      assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM script_sources').get().count, 1);
    });
    await t.test('source spans preserve all newlines and UTF-16 offsets including emoji, with stable pagination', async () => {
      const spans = (await viewer.request('GET', path('/versions/1/spans'))).data;
      assert.equal(spans.offsetUnit, 'utf16'); assert.equal(spans.revisionId, imported.id);
      assert.equal(spans.items.map(item => item.text).join(''), text);
      for (const item of spans.items) { assert.equal(text.slice(item.startOffset, item.endOffset), item.text); assert.equal(item.textHash, hash(item.text)); assert.equal(item.revisionId, imported.id); }
      const pages = [];
      let after = 0;
      do {
        const page = (await viewer.request('GET', path(`/versions/1/spans?after=${after}&limit=2`))).data;
        pages.push(...page.items); after = page.nextCursor;
      } while (after !== null);
      assert.deepEqual(pages, spans.items);
      assert.equal((await owner.request('GET', path('/versions/1/spans?after=2'))).status, 400);
    });
    await t.test('management-only locks prevent import, save and restore until explicit versioned unlock', async () => {
      assert.equal((await editor.request('POST', path('/lock'), { expectedVersion: 1, expectedLockVersion: 0 })).status, 403);
      const locked = await owner.request('POST', path('/lock'), { expectedVersion: 1, expectedLockVersion: 0 });
      assert.equal(locked.status, 201); assert.equal(locked.data.locked, true); assert.equal(locked.data.lockVersion, 1);
      for (const [suffix, body] of [
        ['/import', { ...payload, expectedVersion: 1 }],
        ['', { expectedVersion: 1, title: 'Overwrite', content: 'Must not save' }],
        ['/versions/1/restore', { expectedVersion: 1 }],
      ]) assert.equal((await owner.request('POST', path(suffix), body)).status, 423);
      assert.equal((await viewer.request('POST', path('/unlock'), { expectedVersion: 1, expectedLockVersion: 1 })).status, 403);
      assert.equal((await owner.request('POST', path('/unlock'), { expectedVersion: 1, expectedLockVersion: 0 })).status, 409);
      assert.equal((await owner.request('POST', path('/unlock'), { expectedVersion: 1, expectedLockVersion: 1 })).data.lockVersion, 2);
      const ad = await editor.request('POST', path('/import'), { title: 'Umbrella launch', kind: 'brief', expectedVersion: 1, source: { type: 'paste', text: '30-second advert. Show a compact umbrella on a white background.' } });
      assert.equal(ad.status, 201); assert.equal(ad.data.version, 2); assert.equal(ad.data.source.kind, 'brief');
      assert.equal((await owner.request('POST', path('/lock'), { expectedVersion: 1, expectedLockVersion: 2 })).status, 409);
      assert.equal((await owner.request('POST', path('/lock'), { expectedVersion: 2, expectedLockVersion: 2 })).data.locked, true);
    });
    await t.test('read-only and cross-workspace users cannot mutate or discover source evidence', async () => {
      assert.equal((await viewer.request('POST', path('/import'), { ...payload, expectedVersion: 2 })).status, 403);
      for (const suffix of ['/versions/1/source', '/versions/1/spans']) assert.equal((await outsider.request('GET', path(suffix), undefined, suffix.endsWith('source'))).status, 404);
      assert.equal((await outsider.request('POST', path('/unlock'), { expectedVersion: 2, expectedLockVersion: 3 })).status, 404);
      assert.equal((await owner.request('GET', path('/versions/99/source'), undefined, true)).status, 404);
    });
    await t.test('locks and evidence survive restart, source APIs respect project trash, and old history stays intact', async () => {
      await app.close(); await start();
      assert.equal((await owner.request('GET', path(''))).data.locked, true);
      assert.deepEqual((await owner.request('GET', path('/versions/1/source'), undefined, true)).data, bytes);
      assert.equal((await owner.request('GET', path('/versions/1'))).data.content, text);
      assert.equal((await owner.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 1 })).status, 201);
      for (const suffix of ['/versions/1/source', '/versions/1/spans']) assert.equal((await owner.request('GET', path(suffix), undefined, suffix.endsWith('source'))).status, 404);
      assert.equal((await owner.request('POST', path('/unlock'), { expectedVersion: 2, expectedLockVersion: 3 })).status, 404);
      await owner.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 2 });
      assert.equal((await owner.request('GET', path(''))).data.locked, true);
      const sqlite = app.get(DatabaseService).sqlite;
      assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    });
    await t.test('upgrade from the previous six migrations preserves legacy revisions and defaults them to unlocked', async () => {
      const sqlite = app.get(DatabaseService).sqlite;
      const tables = ['users', 'system_state', 'workspaces', 'workspace_members', 'projects', 'project_members', 'scripts', 'script_revisions'];
      const records = Object.fromEntries(tables.map(table => [table, sqlite.prepare('SELECT * FROM ' + table).all()]));
      const oldHead = (await owner.request('GET', path(''))).data;
      await app.close(); app = undefined;
      const { repositoryRoot } = await import('../dist/config.js');
      const originalFolder = join(repositoryRoot, 'apps/api/drizzle');
      const oldFolder = join(directory, 'previous-migrations');
      await mkdir(join(oldFolder, 'meta'), { recursive: true });
      const journal = JSON.parse(await readFile(join(originalFolder, 'meta/_journal.json'), 'utf8'));
      journal.entries = journal.entries.slice(0, 6);
      await writeFile(join(oldFolder, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries) await writeFile(join(oldFolder, entry.tag + '.sql'), await readFile(join(originalFolder, entry.tag + '.sql')));
      const Database = (await import('better-sqlite3')).default;
      const { drizzle } = await import('drizzle-orm/better-sqlite3');
      const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
      process.env.DATABASE_PATH = join(directory, 'legacy.sqlite');
      const legacy = new Database(process.env.DATABASE_PATH);
      try {
        legacy.pragma('foreign_keys = ON');
        migrate(drizzle(legacy), { migrationsFolder: oldFolder });
        for (const table of tables) {
          const columns = legacy.pragma(`table_info(${table})`).map(column => column.name);
          const insert = legacy.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
          for (const record of records[table]) insert.run(...columns.map(column => record[column]));
        }
        assert.equal(legacy.prepare('SELECT COUNT(*) count FROM __drizzle_migrations').get().count, 6);
      } finally { legacy.close(); }
      await start();
      assert.equal((await owner.request('POST', '/auth/login', { email: 'owner@import.test', password: 'Studio8!' })).status, 200);
      const upgraded = (await owner.request('GET', path(''))).data;
      assert.equal(upgraded.content, oldHead.content); assert.equal(upgraded.id, oldHead.id);
      assert.equal(upgraded.version, oldHead.version); assert.equal(upgraded.locked, false); assert.equal(upgraded.lockVersion, 0);
      assert.equal((await owner.request('GET', path('/versions/1'))).data.content, text);
      assert.equal((await owner.request('POST', path(''), { title: 'Legacy continuation', content: oldHead.content + '\nContinued.', expectedVersion: oldHead.version })).status, 201);
      const migrated = app.get(DatabaseService).sqlite;
      const fullJournal = JSON.parse(await readFile(join(originalFolder, 'meta/_journal.json'), 'utf8'));
      assert.equal(migrated.prepare('SELECT COUNT(*) count FROM __drizzle_migrations').get().count, fullJournal.entries.length);
      assert.throws(() => migrated.prepare('UPDATE script_revisions SET title = ?').run('overwrite'), /immutable/);
      assert.equal(migrated.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(migrated.pragma('foreign_key_check'), []);
    });
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});
