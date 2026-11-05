import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('project numbering and immutable script authoring', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-authoring-'));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.SETUP_TOKEN = 'authoring-local-test-setup-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  let app, base, workspace, project, latest, otherProject;
  async function start() { app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); }
  function client() {
    let cookies = '', csrf = '';
    return { async request(method, path, body) {
      const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', 'X-CSRF-Token': csrf, Cookie: cookies }, body: body === undefined ? undefined : JSON.stringify(body) });
      const newCookies = response.headers.getSetCookie(); if (newCookies.length) cookies = newCookies.map(value => value.split(';')[0]).join('; ');
      const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    } };
  }
  const owner = client(), editor = client(), viewer = client(), outsider = client();
  async function add(target, email, workspaceId) {
    const invitation = await owner.request('POST', `/workspaces/${workspaceId}/invitations`, { email });
    const result = await target.request('POST', '/invitations/accept', { token: invitation.data.token, name: email, password: 'Studio8!' });
    assert.equal(result.status, 201); return result.data.user.id;
  }
  try {
    await start();
    const setup = await owner.request('POST', '/setup/initialize', { setupToken: process.env.SETUP_TOKEN, email: 'owner@test.example', password: 'Studio8!', name: 'Owner', workspaceName: 'Authoring' });
    assert.equal(setup.status, 201); workspace = setup.data.workspace;
    await t.test('server assigns unique sequential codes atomically and skips legacy codes', async () => {
      const legacy = await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Legacy project' });
      assert.equal(legacy.status, 201);
      app.get(DatabaseService).sqlite.prepare('UPDATE projects SET code = ? WHERE id = ?').run('P0002', legacy.data.id);
      const results = await Promise.all(Array.from({ length: 6 }, (_, index) => owner.request('POST', '/projects', { workspaceId: workspace.id, title: `Project ${index}` })));
      assert.ok(results.every(result => result.status === 201));
      assert.deepEqual(results.map(result => result.data.code).sort(), ['P0003', 'P0004', 'P0005', 'P0006', 'P0007', 'P0008']);
      project = results[0].data;
      const other = await owner.request('POST', '/workspaces', { name: 'Isolated' });
      otherProject = (await owner.request('POST', '/projects', { workspaceId: other.data.id, title: 'Other' })).data;
      assert.equal(otherProject.code, 'P0001');
      const editorId = await add(editor, 'editor@test.example', workspace.id);
      const viewerId = await add(viewer, 'viewer@test.example', workspace.id);
      await add(outsider, 'outside@test.example', other.data.id);
      assert.equal((await owner.request('POST', `/projects/${project.id}/members`, { userId: editorId, role: 'EDITOR' })).status, 201);
      assert.equal((await owner.request('POST', `/projects/${project.id}/members`, { userId: viewerId, role: 'VIEWER' })).status, 201);
    });
    await t.test('workspace slugs and project codes cannot be supplied or edited by clients', async () => {
      assert.match(workspace.slug, /^ws-[a-f0-9-]{36}$/);
      assert.equal((await owner.request('POST', '/workspaces', { name: 'Custom slug', slug: 'manual-slug' })).status, 400);
      assert.equal((await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Manual project', code: 'MANUAL' })).status, 400);
      assert.equal((await owner.request('PATCH', `/projects/${project.id}`, { code: 'MANUAL', expectedVersion: 1 })).status, 400);
    });
    await t.test('project style is optional, validated, protected by roles and preserves partial updates', async () => {
      assert.equal(project.stylePreset, 'unspecified'); assert.equal(project.styleDescription, '');
      assert.equal((await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Custom without description', stylePreset: 'custom' })).status, 400);
      assert.equal((await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Unknown', stylePreset: 'unknown' })).status, 400);
      assert.equal((await owner.request('PATCH', `/projects/${project.id}`, { styleDescription: 'x'.repeat(2001), expectedVersion: 1 })).status, 400);
      const styled = await owner.request('PATCH', `/projects/${project.id}`, { stylePreset: 'ink_wash', styleDescription: '  水墨留白、低饱和青绿  ', expectedVersion: 1 });
      assert.equal(styled.status, 200); assert.equal(styled.data.styleDescription, '水墨留白、低饱和青绿');
      const renamed = await owner.request('PATCH', `/projects/${project.id}`, { title: '改名保留风格', expectedVersion: 2 });
      assert.equal(renamed.status, 200); assert.equal(renamed.data.stylePreset, 'ink_wash');
      assert.equal(renamed.data.code, project.code);
      assert.equal((await owner.request('PATCH', `/projects/${project.id}`, { stylePreset: 'custom', styleDescription: ' ', expectedVersion: 3 })).status, 400);
      const custom = await owner.request('PATCH', `/projects/${project.id}`, { stylePreset: 'custom', styleDescription: '复古胶片与纸雕质感', expectedVersion: 3 });
      assert.equal(custom.status, 200);
      assert.equal((await owner.request('PATCH', `/projects/${project.id}`, { styleDescription: '', expectedVersion: 4 })).status, 400);
      for (const target of [editor, viewer]) assert.equal((await target.request('PATCH', `/projects/${project.id}`, { stylePreset: 'ink_wash', expectedVersion: 4 })).status, 403);
      assert.equal((await outsider.request('GET', `/projects/${project.id}`)).status, 404);
      assert.equal((await viewer.request('GET', `/projects/${project.id}`)).data.styleDescription, '复古胶片与纸雕质感');
      assert.equal((await owner.request('PATCH', `/projects/${project.id}`, { stylePreset: 'unspecified', expectedVersion: 3 })).status, 409);
    });
    await t.test('episode and shot numbers are concurrent-safe, skip legacy numbers and survive reordering', async () => {
      assert.equal((await editor.request('POST', `/projects/${project.id}/episodes`, { title: 'Rejected', code: 'MANUAL' })).status, 400);
      const legacy = (await editor.request('POST', `/projects/${project.id}/episodes`, { title: 'Existing episode' })).data;
      assert.equal(legacy.code, 'EP01');
      app.get(DatabaseService).sqlite.prepare('UPDATE episodes SET code = ? WHERE id = ?').run('EP02', legacy.id);
      const episodeResults = await Promise.all(Array.from({ length: 3 }, (_, index) => editor.request('POST', `/projects/${project.id}/episodes`, { title: `Episode ${index}` })));
      assert.ok(episodeResults.every(result => result.status === 201));
      assert.deepEqual(episodeResults.map(result => result.data.code).sort(), ['EP03', 'EP04', 'EP05']);
      const episode = episodeResults[0].data;
      assert.equal((await editor.request('PATCH', `/episodes/${episode.id}`, { code: 'MANUAL', expectedVersion: 1 })).status, 400);
      const reordered = await editor.request('PATCH', `/episodes/${episode.id}`, { title: 'Renamed', orderIndex: 100, expectedVersion: 1 });
      assert.equal(reordered.data.code, episode.code);
      const oldShot = (await editor.request('POST', `/episodes/${episode.id}/shots`, {})).data;
      assert.equal(oldShot.code, 'SH001');
      app.get(DatabaseService).sqlite.prepare('UPDATE shots SET code = ? WHERE id = ?').run('SH002', oldShot.id);
      const shotResults = await Promise.all(Array.from({ length: 3 }, () => editor.request('POST', `/episodes/${episode.id}/shots`, {})));
      assert.ok(shotResults.every(result => result.status === 201));
      assert.deepEqual(shotResults.map(result => result.data.code).sort(), ['SH003', 'SH004', 'SH005']);
      const shot = shotResults[0].data;
      assert.equal((await editor.request('PATCH', `/shots/${shot.id}`, { code: 'MANUAL', expectedVersion: 1 })).status, 400);
      assert.equal((await editor.request('PATCH', `/shots/${shot.id}`, { sequence: 100, expectedVersion: 1 })).data.code, shot.code);
    });
    await t.test('reading empty scripts does not mutate the database', async () => {
      assert.equal((await viewer.request('GET', `/projects/${project.id}/script`)).data.version, 0);
      assert.deepEqual((await editor.request('GET', `/projects/${project.id}/script/versions`)).data, { items: [], nextCursor: null });
      assert.equal(app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) count FROM scripts').get().count, 0);
    });
    await t.test('save records authorship and two editors cannot silently overwrite each other', async () => {
      const first = await editor.request('POST', `/projects/${project.id}/script`, { title: '补天', content: '第一幕：天空裂开。', summary: '初稿', expectedVersion: 0 });
      assert.equal(first.status, 201); assert.equal(first.data.version, 1); assert.equal(first.data.authorName, 'editor@test.example');
      const results = await Promise.all([
        owner.request('POST', `/projects/${project.id}/script`, { title: '补天', content: 'Owner revision', expectedVersion: 1 }),
        editor.request('POST', `/projects/${project.id}/script`, { title: '补天', content: 'Editor revision', expectedVersion: 1 }),
      ]);
      assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
      assert.equal(results.find(result => result.status === 409).data.details.latestVersion, 2);
      latest = results.find(result => result.status === 201).data;
      assert.equal((await viewer.request('GET', `/projects/${project.id}/script`)).data.content, latest.content);
    });
    await t.test('read-only and cross-workspace accounts cannot write or discover script content', async () => {
      assert.equal((await viewer.request('POST', `/projects/${project.id}/script`, { title: 'No', content: 'No', expectedVersion: 2 })).status, 403);
      assert.equal((await viewer.request('POST', `/projects/${project.id}/script/versions/1/restore`, { expectedVersion: 2 })).status, 403);
      for (const suffix of ['', '/versions', '/versions/1']) assert.equal((await outsider.request('GET', `/projects/${project.id}/script${suffix}`)).status, 404);
      assert.equal((await outsider.request('POST', `/projects/${project.id}/script`, { title: 'No', content: 'No', expectedVersion: 2 })).status, 404);
      assert.equal((await outsider.request('POST', `/projects/${project.id}/script/versions/1/restore`, { expectedVersion: 2 })).status, 404);
      assert.equal((await editor.request('POST', `/projects/${project.id}/script`, { title: 'Bad', content: 'x', expectedVersion: 2, workspaceId: otherProject.workspaceId })).status, 400);
      assert.equal((await editor.request('POST', `/projects/${project.id}/script`, { title: 'Too long', content: 'x'.repeat(60001), expectedVersion: 2 })).status, 400);
      assert.equal((await viewer.request('GET', `/projects/${project.id}/script/versions/999`)).status, 404);
    });
    await t.test('restore appends a new revision; historical rows cannot be updated or deleted', async () => {
      assert.equal((await editor.request('POST', `/projects/${project.id}/script/versions/999/restore`, { expectedVersion: 2 })).status, 404);
      assert.equal((await editor.request('GET', `/projects/${project.id}/script`)).data.version, 2);
      const restored = await editor.request('POST', `/projects/${project.id}/script/versions/1/restore`, { expectedVersion: 2 });
      assert.equal(restored.status, 201); assert.equal(restored.data.version, 3);
      assert.equal(restored.data.content, '第一幕：天空裂开。'); assert.equal(restored.data.restoredFromVersion, 1);
      assert.equal((await viewer.request('GET', `/projects/${project.id}/script/versions/2`)).data.content, latest.content);
      const sqlite = app.get(DatabaseService).sqlite;
      assert.throws(() => sqlite.prepare('UPDATE script_revisions SET content = ? WHERE project_id = ?').run('tampered', project.id), /immutable/);
      assert.throws(() => sqlite.prepare('DELETE FROM script_revisions WHERE project_id = ?').run(project.id), /immutable/);
      const document = sqlite.prepare('SELECT * FROM scripts WHERE project_id = ?').get(project.id);
      assert.throws(() => sqlite.prepare('INSERT INTO script_revisions(id,script_id,project_id,workspace_id,version,title,content,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), document.id, otherProject.id, otherProject.workspaceId, 99, 'bad', 'bad', restored.data.createdBy, 'now'), /FOREIGN KEY/);
    });
    await t.test('history is bounded and paginated; listing does not return full script bodies', async () => {
      for (let version = 3; version < 33; version++) assert.equal((await editor.request('POST', `/projects/${project.id}/script`, { title: '补天', content: `Revision ${version + 1}`, expectedVersion: version })).status, 201);
      const firstPage = (await viewer.request('GET', `/projects/${project.id}/script/versions`)).data;
      assert.equal(firstPage.items.length, 30); assert.equal(firstPage.items[0].version, 33); assert.equal(firstPage.nextCursor, 4);
      assert.ok(firstPage.items.every(item => !('content' in item)));
      const secondPage = (await viewer.request('GET', `/projects/${project.id}/script/versions?before=${firstPage.nextCursor}`)).data;
      assert.deepEqual(secondPage.items.map(item => item.version), [3, 2, 1]); assert.equal(secondPage.nextCursor, null);
    });
    await t.test('additive migrations, project counters, scripts and historical triggers survive restart', async () => {
      await app.close(); await start();
      assert.equal((await editor.request('GET', `/projects/${project.id}/script`)).data.version, 33);
      assert.equal((await owner.request('GET', `/projects/${project.id}`)).data.stylePreset, 'custom');
      assert.equal((await owner.request('POST', `/projects/${project.id}/episodes`, { title: 'After restart' })).data.code, 'EP06');
      assert.equal((await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'After restart' })).data.code, 'P0009');
      assert.equal(app.get(DatabaseService).sqlite.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(app.get(DatabaseService).sqlite.pragma('foreign_key_check'), []);
      assert.equal(app.get(DatabaseService).sqlite.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'script_revisions_%'").get().count, 2);
    });
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});
