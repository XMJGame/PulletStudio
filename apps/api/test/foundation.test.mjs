import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('SQLite identity, isolation, collaboration and recovery', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-api-'));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.SETUP_TOKEN = 'integration-setup-token-'.repeat(3);
  process.env.APP_ORIGINS = 'http://127.0.0.1:5173';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { backupDatabase } = await import('../dist/db/backup.js');
  const Database = (await import('better-sqlite3')).default;
  let app; let base;
  async function start() { app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); }
  function client() {
    const cookies = new Map();
    const instance = { csrf: '', cookies, async request(method, path, body, headers = {}) {
      const response = await fetch(base + path, {
        method, headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', 'X-CSRF-Token': instance.csrf,
          Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const cookie of response.headers.getSetCookie()) { const [key, value] = cookie.split(';')[0].split('='); if (value) cookies.set(key, value); else cookies.delete(key); }
      const data = await response.json(); if (data.csrfToken) instance.csrf = data.csrfToken;
      return { status: response.status, data, headers: response.headers };
    } }; return instance;
  }
  const owner = client(), editor = client(), viewer = client(), outsider = client();
  const password = 'Studio8!';
  let workspace, project, episode, shot, secondShot, viewerId;
  try {
    await start();
    await t.test('live/ready and unauthorized access', async () => {
      assert.equal((await owner.request('GET', '/health/live')).status, 200);
      assert.equal((await owner.request('GET', '/health/ready')).data.database, 'sqlite');
      assert.equal((await owner.request('GET', '/api/v1/workspaces')).status, 401);
      assert.equal((await owner.request('GET', '/api/v1/setup/status')).data.initialized, false);
    });
    await t.test('one-time bootstrap is atomic, uses secure password storage and cookie flags', async () => {
      const input = { setupToken: process.env.SETUP_TOKEN, email: 'owner@example.test', name: '制片', password, workspaceName: '测试工作区' };
      assert.equal((await owner.request('POST', '/api/v1/setup/initialize', { ...input, setupToken: 'x'.repeat(64) })).status, 403);
      const results = await Promise.all([owner.request('POST', '/api/v1/setup/initialize', input), client().request('POST', '/api/v1/setup/initialize', { ...input, email: 'racer@example.test' })]);
      assert.deepEqual(results.map(x => x.status).sort(), [201, 409]);
      // Either concurrent request may win; log in to that account using its known test password.
      const winner = results.find(x => x.status === 201);
      workspace = winner.data.workspace;
      const login = await owner.request('POST', '/api/v1/auth/login', { email: winner.data.user.email, password });
      assert.equal(login.status, 200);
      assert.match(login.headers.getSetCookie().find(x => x.startsWith('studio_session=')), /HttpOnly/);
      assert.match(login.headers.getSetCookie()[0], /SameSite=Strict/);
      assert.equal((await owner.request('POST', '/api/v1/setup/initialize', input)).status, 409);
      const raw = app.get(DatabaseService).sqlite.prepare('SELECT * FROM users').get();
      assert.match(raw.password_hash, /^scrypt-v1\$/); assert.ok(!raw.password_hash.includes(password));
      assert.equal(app.get(DatabaseService).sqlite.pragma('journal_mode', { simple: true }), 'wal');
    });
    await t.test('CSRF, origin and input validation reject unsafe requests', async () => {
      const payload = { name: '拒绝' };
      assert.equal((await owner.request('POST', '/api/v1/workspaces', payload, { 'X-CSRF-Token': '' })).status, 403);
      assert.equal((await owner.request('POST', '/api/v1/workspaces', payload, { Origin: 'https://evil.example' })).status, 403);
      assert.equal((await owner.request('POST', '/api/v1/workspaces', payload, { 'X-Studio-Request': '' })).status, 403);
      const response = await owner.request('POST', '/api/v1/workspaces', { ...payload, instanceAdmin: true });
      assert.equal(response.status, 400); assert.ok(response.data.requestId); assert.ok(response.data.details);
      for (const [body, expected, code] of [['{invalid', 400, 'INVALID_JSON'], [JSON.stringify({ description: 'x'.repeat(270000) }), 413, 'PAYLOAD_TOO_LARGE']]) {
        const invalid = await fetch(base + '/api/v1/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        assert.equal(invalid.status, expected); assert.equal((await invalid.json()).code, code);
      }
    });
    async function invite(target, email, workspaceId = workspace.id) {
      const invitation = await owner.request('POST', `/api/v1/workspaces/${workspaceId}/invitations`, { email, role: 'MEMBER' });
      assert.equal(invitation.status, 201);
      const accepted = await target.request('POST', '/api/v1/invitations/accept', { token: invitation.data.token, name: email.split('@')[0], password });
      assert.equal(accepted.status, 201);
      assert.equal((await target.request('POST', '/api/v1/invitations/accept', { token: invitation.data.token, name: '重复', password })).status, 400);
      return accepted.data.user;
    }
    await t.test('invitation creates ordinary accounts and can only be used once', async () => {
      await invite(editor, 'editor@example.test');
      viewerId = (await invite(viewer, 'viewer@example.test')).id;
      assert.equal((await editor.request('GET', '/api/v1/auth/me')).data.user.instanceAdmin, false);
      assert.equal((await editor.request('POST', '/api/v1/workspaces', { name: '不可创建' })).status, 403);
      assert.equal((await editor.request('POST', `/api/v1/workspaces/${workspace.id}/invitations`, { email: 'other@example.test' })).status, 403);
    });
    await t.test('create persistent project, episode and shots; require explicit project membership', async () => {
      const response = await owner.request('POST', '/api/v1/projects', { workspaceId: workspace.id, title: '补天计划' });
      assert.equal(response.status, 201); project = response.data;
      assert.deepEqual((await editor.request('GET', `/api/v1/projects?workspaceId=${workspace.id}`)).data, []);
      assert.equal((await editor.request('GET', `/api/v1/projects/${project.id}`)).status, 404);
      const editorId = (await editor.request('GET', '/api/v1/auth/me')).data.user.id;
      assert.equal((await owner.request('POST', `/api/v1/projects/${project.id}/members`, { userId: editorId, role: 'EDITOR' })).status, 201);
      assert.equal((await owner.request('POST', `/api/v1/projects/${project.id}/members`, { userId: viewerId, role: 'VIEWER' })).status, 201);
      episode = (await editor.request('POST', `/api/v1/projects/${project.id}/episodes`, { title: '裂开的天空' })).data;
      shot = (await editor.request('POST', `/api/v1/episodes/${episode.id}/shots`, { description: '仰望天空', sequence: 1 })).data;
      secondShot = (await editor.request('POST', `/api/v1/episodes/${episode.id}/shots`, { sequence: 2 })).data;
      assert.ok(shot.id); assert.equal(shot.version, 1);
      assert.equal((await editor.request('PATCH', `/api/v1/projects/${project.id}`, { title: '越权', expectedVersion: 1 })).status, 403);
      assert.equal((await viewer.request('GET', `/api/v1/episodes/${episode.id}/shots`)).data.length, 2);
      assert.equal((await viewer.request('PATCH', `/api/v1/shots/${shot.id}`, { description: '越权', expectedVersion: 1 })).status, 403);
      assert.equal((await viewer.request('POST', `/api/v1/episodes/${episode.id}/shots`, {})).status, 403);
      assert.deepEqual((await viewer.request('GET', `/api/v1/projects/${project.id}/access`)).data, { canEdit: false, canManage: false, canReview: false });
      assert.deepEqual((await editor.request('GET', `/api/v1/projects/${project.id}/access`)).data, { canEdit: true, canManage: false, canReview: false });
    });
    await t.test('three sessions collaborate; stale edits return 409 with latest data', async () => {
      const updates = await Promise.all([
        owner.request('PATCH', `/api/v1/shots/${shot.id}`, { description: '导演修改', expectedVersion: 1 }),
        editor.request('PATCH', `/api/v1/shots/${secondShot.id}`, { camera: '缓慢推进', expectedVersion: 1 }),
        viewer.request('GET', `/api/v1/episodes/${episode.id}/shots`),
      ]);
      assert.deepEqual(updates.map(x => x.status), [200, 200, 200]);
      const stale = await editor.request('PATCH', `/api/v1/shots/${shot.id}`, { description: '陈旧内容', expectedVersion: 1 });
      assert.equal(stale.status, 409); assert.equal(stale.data.details.latest.description, '导演修改');
      assert.equal(stale.data.details.latest.version, 2);
      const ep = await owner.request('PATCH', `/api/v1/episodes/${episode.id}`, { title: '新标题', expectedVersion: 1 });
      assert.equal(ep.status, 200);
      assert.equal((await editor.request('PATCH', `/api/v1/episodes/${episode.id}`, { title: '旧标题', expectedVersion: 1 })).status, 409);
      assert.equal((await owner.request('PATCH', `/api/v1/projects/${project.id}`, { title: '新片名', expectedVersion: 1 })).status, 200);
      assert.equal((await owner.request('PATCH', `/api/v1/projects/${project.id}`, { title: '旧片名', expectedVersion: 1 })).status, 409);
    });
    await t.test('cross-workspace and forged parent references cannot read or write resources', async () => {
      const other = (await owner.request('POST', '/api/v1/workspaces', { name: '第二工作区' })).data;
      const outsideUser = await invite(outsider, 'outside@example.test', other.id);
      for (const path of [`/api/v1/projects/${project.id}`, `/api/v1/episodes/${episode.id}`, `/api/v1/shots/${shot.id}`, `/api/v1/projects?workspaceId=${workspace.id}`]) {
        assert.equal((await outsider.request('GET', path)).status, 404);
      }
      assert.equal((await outsider.request('PATCH', `/api/v1/shots/${shot.id}`, { expectedVersion: 2, description: '外部修改' })).status, 404);
      assert.equal((await owner.request('POST', `/api/v1/projects/${project.id}/members`, { userId: outsideUser.id, role: 'EDITOR' })).status, 404);
      assert.equal((await editor.request('POST', `/api/v1/episodes/${episode.id}/shots`, { workspaceId: other.id })).status, 400);
      const sqlite = app.get(DatabaseService).sqlite;
      assert.throws(() => sqlite.prepare('INSERT INTO episodes(id, workspace_id, project_id, code, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), other.id, project.id, 'BAD', 'BAD', 'now', 'now'), /FOREIGN KEY/);
      assert.equal((await owner.request('POST', '/api/v1/projects', { workspaceId: workspace.id, code: 'FILM', title: '人工编号被拒绝' })).status, 400);
    });
    await t.test('password failures are generic; logout revokes server session', async () => {
      const anonymous = client();
      for (const email of ['missing@example.test', 'editor@example.test']) {
        const wrong = await anonymous.request('POST', '/api/v1/auth/login', { email, password: 'wrong-password' });
        assert.equal(wrong.status, 401); assert.equal(wrong.data.code, 'INVALID_CREDENTIALS');
      }
      const oldCookies = [...viewer.cookies]; const oldCsrf = viewer.csrf;
      assert.equal((await viewer.request('POST', '/api/v1/auth/logout')).status, 200);
      for (const [key, value] of oldCookies) viewer.cookies.set(key, value); viewer.csrf = oldCsrf;
      assert.equal((await viewer.request('GET', '/api/v1/auth/me')).status, 401);
    });
    await t.test('API restart preserves data and active sessions; repeat migrations are safe', async () => {
      await app.close(); await start();
      assert.equal((await owner.request('GET', '/api/v1/auth/me')).status, 200);
      assert.equal((await editor.request('GET', `/api/v1/shots/${shot.id}`)).data.description, '导演修改');
      assert.equal((await owner.request('GET', '/api/v1/setup/status')).data.initialized, true);
      const sqlite = app.get(DatabaseService).sqlite;
      assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
      const auditCount = sqlite.prepare('SELECT COUNT(*) count FROM audit_events').get().count;
      assert.ok(auditCount >= 15);
    });
    await t.test('existing members can accept invitations without resetting passwords; reissue revokes old token', async () => {
      const other = (await owner.request('GET', '/api/v1/workspaces')).data.find(x => x.id !== workspace.id);
      const original = (await owner.request('POST', `/api/v1/workspaces/${other.id}/invitations`, { email: 'editor@example.test', role: 'MEMBER' })).data;
      const replacement = (await owner.request('POST', `/api/v1/workspaces/${other.id}/invitations`, { email: 'editor@example.test', role: 'MEMBER' })).data;
      assert.equal((await editor.request('POST', '/api/v1/invitations/accept', { token: original.token })).status, 400);
      assert.equal((await outsider.request('POST', '/api/v1/invitations/accept', { token: replacement.token })).status, 409);
      assert.equal((await editor.request('POST', '/api/v1/invitations/accept', { token: replacement.token })).status, 201);
      assert.equal((await editor.request('GET', '/api/v1/workspaces')).data.length, 2);
      const expiring = (await owner.request('POST', `/api/v1/workspaces/${other.id}/invitations`, { email: 'expired@example.test' })).data;
      app.get(DatabaseService).sqlite.prepare('UPDATE invitations SET expires_at = 0 WHERE id = ?').run(expiring.id);
      assert.equal((await client().request('POST', '/api/v1/invitations/accept', { token: expiring.token, name: 'Expired', password })).status, 400);
      assert.equal((await client().request('POST', '/api/v1/auth/login', { email: 'editor@example.test', password })).status, 200);
    });
    await t.test('online backup captures WAL contents and can be restored into a separate database', async () => {
      const target = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backups'));
      const restored = new Database(target, { readonly: true });
      try {
        assert.equal(restored.prepare('SELECT description FROM shots WHERE id = ?').get(shot.id).description, '导演修改');
        assert.equal(restored.prepare('SELECT COUNT(*) count FROM users').get().count, 4);
        assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
      } finally { restored.close(); }
    });
    await t.test('session expiry and login rate limit are enforced', async () => {
      app.get(DatabaseService).sqlite.prepare('UPDATE sessions SET expires_at = 0').run();
      assert.equal((await owner.request('GET', '/api/v1/auth/me')).status, 401);
      const statuses = [];
      for (let i = 0; i < 11; i++) statuses.push((await client().request('POST', '/api/v1/auth/login', { email: 'none@example.test', password: 'wrong' })).status);
      assert.equal(statuses.at(-1), 429);
    });
    await t.test('OpenAPI publishes the implemented contracts', async () => {
      const document = await (await fetch(base + '/openapi.json')).json();
      assert.ok(document.paths['/api/v1/auth/login']); assert.ok(document.paths['/api/v1/shots/{shotId}'].patch.requestBody);
    });
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});
