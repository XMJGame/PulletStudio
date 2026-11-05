import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

test('generic project settings, production units and direct shots', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-units-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.SETUP_TOKEN = 'production-units-local-test-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  let app, base, workspace, project, otherProject, episode, act, scene, direct;
  async function start() { app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); }
  function client() {
    let cookies = '', csrf = '';
    return { async request(method, path, body) {
      const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', 'X-CSRF-Token': csrf, Cookie: cookies }, body: body === undefined ? undefined : JSON.stringify(body) });
      const incoming = response.headers.getSetCookie(); if (incoming.length) cookies = incoming.map(value => value.split(';')[0]).join('; ');
      const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    } };
  }
  const owner = client(), editor = client(), viewer = client();
  const units = () => `/projects/${project.id}/units`;
  const unit = id => `/units/${id}`;
  const projectShots = () => `/projects/${project.id}/shots`;
  try {
    await start();
    const setup = await owner.request('POST', '/setup/initialize', { setupToken: process.env.SETUP_TOKEN, email: 'owner@units.test', password: 'Studio8!', name: 'Owner', workspaceName: 'Units' });
    workspace = setup.data.workspace;
    project = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Flexible project' })).data;
    otherProject = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Isolated project' })).data;
    for (const [target, email, role] of [[editor, 'editor@units.test', 'EDITOR'], [viewer, 'viewer@units.test', 'VIEWER']]) {
      const invite = await owner.request('POST', `/workspaces/${workspace.id}/invitations`, { email });
      const accepted = await target.request('POST', '/invitations/accept', { token: invite.data.token, name: email, password: 'Studio8!' });
      await owner.request('POST', `/projects/${project.id}/members`, { userId: accepted.data.user.id, role });
    }
    await t.test('format and narrative axes remain independent and unknown values fail', async () => {
      assert.equal(project.workFormat, 'custom'); assert.equal(project.narrativeMode, 'none');
      assert.equal(project.targetDurationSeconds, null); assert.equal(project.directorNotes, '');
      for (const data of [{ workFormat: 'myth_only' }, { narrativeMode: 'unknown' }, { targetDurationSeconds: 0 }]) assert.equal((await owner.request('PATCH', `/projects/${project.id}`, { ...data, expectedVersion: 1 })).status, 400);
      const result = await owner.request('PATCH', `/projects/${project.id}`, { workFormat: 'ad', narrativeMode: 'dialogue', targetDurationSeconds: 30, directorNotes: 'Clear product silhouette', expectedVersion: 1 });
      assert.equal(result.status, 200); assert.equal(result.data.stylePreset, 'unspecified'); project = result.data;
      assert.equal((await editor.request('PATCH', `/projects/${project.id}`, { workFormat: 'film', expectedVersion: 2 })).status, 403);
    });
    await t.test('legacy episodes and generic units share one identity and automatic numbering', async () => {
      episode = (await editor.request('POST', `/projects/${project.id}/episodes`, { title: 'Legacy episode' })).data;
      assert.equal(episode.code, 'EP01');
      const same = await editor.request('GET', unit(episode.id));
      assert.equal(same.status, 200); assert.equal(same.data.kind, 'episode');
      act = (await editor.request('POST', units(), { kind: 'act', title: 'Arrival' })).data;
      scene = (await editor.request('POST', units(), { kind: 'scene', title: 'Station', parentId: act.id, targetDurationSeconds: 12 })).data;
      assert.equal(act.code, 'U0001'); assert.equal(scene.code, 'U0002');
      const second = await editor.request('POST', units(), { kind: 'episode', title: 'Second episode', parentId: act.id });
      assert.equal(second.status, 201); assert.equal(second.data.code, 'EP02');
      assert.equal((await owner.request('GET', `/projects/${project.id}/episodes`)).data.length, 2);
      assert.equal((await owner.request('GET', `/episodes/${scene.id}`)).status, 404);
      assert.equal((await editor.request('POST', units(), { kind: 'scene', title: 'Manual code', code: 'MANUAL' })).status, 400);
      const results = await Promise.all(Array.from({ length: 3 }, (_, i) => editor.request('POST', units(), { kind: 'section', title: `Beat ${i}` })));
      assert.ok(results.every(item => item.status === 201));
      assert.equal(new Set(results.map(item => item.data.code)).size, 3);
    });
    await t.test('hierarchy rejects cycles, cross-project parents, stale versions and forged root units', async () => {
      assert.equal((await editor.request('PATCH', unit(act.id), { parentId: scene.id, expectedVersion: 1 })).status, 400);
      assert.equal((await editor.request('PATCH', unit(scene.id), { parentId: scene.id, expectedVersion: 1 })).status, 400);
      const foreign = (await owner.request('POST', `/projects/${otherProject.id}/units`, { kind: 'scene', title: 'Outside' })).data;
      assert.equal((await editor.request('PATCH', unit(scene.id), { parentId: foreign.id, expectedVersion: 1 })).status, 404);
      assert.equal((await editor.request('POST', units(), { kind: 'scene', title: 'Outside child', parentId: foreign.id })).status, 404);
      assert.equal((await editor.request('POST', units(), { kind: 'project_root', title: 'Forged root' })).status, 400);
      const changed = await editor.request('PATCH', unit(scene.id), { title: 'Night station', parentId: null, orderIndex: 7, expectedVersion: 1 });
      assert.equal(changed.status, 200); assert.equal(changed.data.code, scene.code); assert.equal(changed.data.parentId, null); scene = changed.data;
      assert.equal((await editor.request('PATCH', unit(scene.id), { title: 'Stale', expectedVersion: 1 })).status, 409);
      const db = app.get(DatabaseService).sqlite;
      assert.throws(() => db.prepare('UPDATE episodes SET parent_id = ? WHERE id = ?').run(act.id, act.id), /cycle/);
      assert.throws(() => db.prepare('UPDATE episodes SET parent_id = ? WHERE id = ?').run(foreign.id, scene.id), /parent/);
      const first = (await viewer.request('GET', units() + '?limit=2')).data;
      const next = (await viewer.request('GET', units() + `?limit=2&cursor=${first.nextCursor}`)).data;
      assert.equal(first.items.length, 2); assert.ok(next.items.every(item => !first.items.some(old => old.id === item.id)));
    });
    await t.test('direct project shots need no visible episode and preserve legacy shot behavior', async () => {
      const result = await editor.request('POST', projectShots(), { description: 'Umbrella on a white surface', technique: 'external' });
      assert.equal(result.status, 201); direct = result.data;
      assert.equal(direct.unitId, null); assert.equal(direct.code, 'SH001'); assert.equal(direct.technique, 'external');
      const generic = await editor.request('POST', projectShots(), { unitId: scene.id, description: 'Train arriving', durationHint: 12, technique: 'image_to_video' });
      assert.equal(generic.status, 201); assert.equal(generic.data.unitId, scene.id);
      const oldShot = (await editor.request('POST', `/episodes/${episode.id}/shots`, { description: 'Old workflow' })).data;
      assert.equal(oldShot.code, 'SH001');
      assert.equal((await viewer.request('GET', projectShots())).data.items.length, 1);
      assert.equal((await viewer.request('GET', projectShots() + `?unitId=${scene.id}`)).data.items.length, 1);
      assert.equal((await viewer.request('GET', `/episodes/${episode.id}/shots`)).data[0].id, oldShot.id);
      assert.equal((await viewer.request('GET', units() + '?limit=100')).data.items.some(item => item.kind === 'project_root'), false);
      const root = app.get(DatabaseService).sqlite.prepare("SELECT id FROM episodes WHERE unit_type='project_root'").get();
      assert.equal((await owner.request('GET', unit(root.id))).status, 404);
      assert.equal((await owner.request('POST', projectShots(), { unitId: root.id })).status, 404);
      assert.equal((await editor.request('PATCH', `/shots/${direct.id}`, { technique: 'static', expectedVersion: 1 })).status, 200);
    });
    await t.test('settings impact requires explicit confirmation and never rewrites existing production content', async () => {
      const input = { workFormat: 'film', narrativeMode: 'hybrid', targetDurationSeconds: 4800, expectedVersion: 2 };
      const impact = await owner.request('POST', `/projects/${project.id}/settings-impact`, input);
      assert.equal(impact.status, 201); assert.equal(impact.data.requiresConfirmation, true); assert.equal(impact.data.shots, 3);
      assert.equal((await owner.request('PATCH', `/projects/${project.id}`, input)).status, 409);
      const saved = await owner.request('PATCH', `/projects/${project.id}`, { ...input, acknowledgeImpact: true });
      assert.equal(saved.status, 200); assert.equal(saved.data.code, project.code);
      assert.equal((await owner.request('GET', `/shots/${direct.id}`)).data.description, 'Umbrella on a white surface');
      assert.equal((await owner.request('GET', unit(scene.id))).data.targetDurationSeconds, 12);
      assert.equal((await owner.request('PATCH', `/projects/${project.id}`, { ...input, acknowledgeImpact: true })).status, 409);
    });
    await t.test('read-only, project isolation, trash and restart protect all structure endpoints', async () => {
      assert.equal((await viewer.request('POST', units(), { kind: 'scene', title: 'Forbidden' })).status, 403);
      assert.equal((await viewer.request('POST', projectShots(), {})).status, 403);
      assert.equal((await editor.request('GET', `/projects/${otherProject.id}/units`)).status, 404);
      await app.close(); await start();
      assert.equal((await viewer.request('GET', unit(scene.id))).data.parentId, null);
      assert.equal((await editor.request('POST', projectShots(), {})).data.code, 'SH002');
      const current = (await owner.request('GET', `/projects/${project.id}`)).data;
      await owner.request('POST', `/projects/${project.id}/trash`, { expectedVersion: current.version });
      for (const path of [units(), projectShots(), unit(scene.id)]) assert.equal((await owner.request('GET', path)).status, 404);
      assert.equal((await owner.request('POST', projectShots(), {})).status, 404);
      const db = app.get(DatabaseService).sqlite;
      assert.equal(db.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(db.pragma('foreign_key_check'), []);
    });
    await t.test('upgrading the previous schema keeps legacy episode and shot identities, content and counters', async () => {
      const live = app.get(DatabaseService).sqlite;
      const tables = ['users', 'system_state', 'workspaces', 'workspace_members', 'projects', 'project_members', 'episodes', 'shots'];
      const records = Object.fromEntries(tables.map(table => [table, live.prepare(table === 'episodes' ? "SELECT * FROM episodes WHERE unit_type='episode'" : table === 'shots' ? 'SELECT * FROM shots WHERE episode_id = ?' : 'SELECT * FROM ' + table).all(...(table === 'shots' ? [episode.id] : []))]));
      // Model a pre-feature project fixture, with no generic units or hidden scopes.
      for (const row of records.projects) { row.deleted_at = null; row.deleted_by = null; }
      const oldShot = records.shots[0];
      await app.close(); app = undefined;
      const { repositoryRoot } = await import('../dist/config.js');
      const originalFolder = join(repositoryRoot, 'apps/api/drizzle');
      const oldFolder = join(directory, 'previous-migrations');
      await mkdir(join(oldFolder, 'meta'), { recursive: true });
      const journal = JSON.parse(await readFile(join(originalFolder, 'meta/_journal.json'), 'utf8'));
      const previous = { ...journal, entries: journal.entries.slice(0, 8) };
      await writeFile(join(oldFolder, 'meta/_journal.json'), JSON.stringify(previous));
      for (const entry of previous.entries) await writeFile(join(oldFolder, entry.tag + '.sql'), await readFile(join(originalFolder, entry.tag + '.sql')));
      const Database = (await import('better-sqlite3')).default;
      const { drizzle } = await import('drizzle-orm/better-sqlite3');
      const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
      process.env.DATABASE_PATH = join(directory, 'legacy.sqlite');
      const legacy = new Database(process.env.DATABASE_PATH);
      try {
        legacy.pragma('foreign_keys = ON'); migrate(drizzle(legacy), { migrationsFolder: oldFolder });
        for (const table of tables) {
          const columns = legacy.pragma(`table_info(${table})`).map(column => column.name);
          const insert = legacy.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
          for (const record of records[table]) insert.run(...columns.map(column => record[column]));
        }
      } finally { legacy.close(); }
      await start();
      assert.equal((await editor.request('POST', '/auth/login', { email: 'editor@units.test', password: 'Studio8!' })).status, 200);
      const upgraded = (await editor.request('GET', unit(episode.id))).data;
      assert.equal(upgraded.id, episode.id); assert.equal(upgraded.code, episode.code); assert.equal(upgraded.kind, 'episode'); assert.equal(upgraded.parentId, null); assert.equal(upgraded.version, episode.version);
      const preserved = (await editor.request('GET', `/shots/${oldShot.id}`)).data;
      assert.equal(preserved.description, oldShot.description); assert.equal(preserved.code, oldShot.code); assert.equal(preserved.version, oldShot.version); assert.equal(preserved.unitId, episode.id); assert.equal(preserved.technique, 'unspecified');
      assert.equal((await editor.request('POST', `/projects/${project.id}/episodes`, { title: 'Continue legacy numbering' })).data.code, 'EP03');
      assert.equal((await editor.request('POST', `/episodes/${episode.id}/shots`, {})).data.code, 'SH002');
      assert.equal((await editor.request('POST', units(), { kind: 'scene', title: 'New generic structure' })).data.code, 'U0001');
      const upgradedDb = app.get(DatabaseService).sqlite;
      assert.equal(upgradedDb.prepare('SELECT COUNT(*) count FROM __drizzle_migrations').get().count, journal.entries.length);
      assert.equal(upgradedDb.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(upgradedDb.pragma('foreign_key_check'), []);
    });
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});
