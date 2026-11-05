import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

test('project recovery and membership revocation', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-lifecycle-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.SETUP_TOKEN = 'lifecycle-local-test-setup-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  let app, base, workspace, other, project, episode, shot, managerId, adminId, editorId;
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
  const owner = client(), manager = client(), editor = client(), admin = client(), outsider = client();
  async function add(target, email, workspaceId, role = 'MEMBER') {
    const invite = await owner.request('POST', `/workspaces/${workspaceId}/invitations`, { email, role });
    assert.equal(invite.status, 201);
    const result = await target.request('POST', '/invitations/accept', { token: invite.data.token, name: email, password: 'Studio8!' });
    assert.equal(result.status, 201); return result.data.user.id;
  }
  const membersPath = () => `/projects/${project.id}/members`;
  const trashPath = () => `/workspaces/${workspace.id}/trash/projects`;
  try {
    await start();
    const setup = await owner.request('POST', '/setup/initialize', { setupToken: process.env.SETUP_TOKEN, email: 'owner@lifecycle.test', password: 'Studio8!', name: 'Owner', workspaceName: 'Lifecycle' });
    assert.equal(setup.status, 201); workspace = setup.data.workspace;
    other = (await owner.request('POST', '/workspaces', { name: 'Other' })).data;
    managerId = await add(manager, 'manager@lifecycle.test', workspace.id);
    editorId = await add(editor, 'editor@lifecycle.test', workspace.id);
    adminId = await add(admin, 'admin@lifecycle.test', workspace.id, 'WORKSPACE_ADMIN');
    await add(outsider, 'outside@lifecycle.test', other.id);
    project = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Recover me', stylePreset: 'ink_wash' })).data;
    assert.equal((await owner.request('POST', membersPath(), { userId: managerId, role: 'PROJECT_MANAGER' })).status, 201);
    assert.equal((await owner.request('POST', membersPath(), { userId: editorId, role: 'EDITOR' })).status, 201);
    episode = (await editor.request('POST', `/projects/${project.id}/episodes`, { title: 'Episode' })).data;
    shot = (await editor.request('POST', `/episodes/${episode.id}/shots`, { description: '五色石' })).data;
    assert.equal((await editor.request('POST', `/projects/${project.id}/script`, { title: '补天', content: '保留历史署名', expectedVersion: 0 })).status, 201);

    await t.test('role updates use expected roles and removals revoke existing sessions immediately', async () => {
      assert.equal((await manager.request('GET', `/projects/${project.id}/member-candidates`)).status, 200);
      assert.equal((await manager.request('GET', `/workspaces/${workspace.id}/members`)).status, 403);
      assert.equal((await editor.request('DELETE', membersPath() + '/' + managerId, { expectedRole: 'PROJECT_MANAGER' })).status, 403);
      assert.equal((await manager.request('POST', membersPath(), { userId: editorId, role: 'VIEWER' })).status, 409);
      assert.equal((await manager.request('POST', membersPath(), { userId: editorId, role: 'VIEWER', expectedRole: 'EDITOR' })).status, 201);
      assert.equal((await editor.request('PATCH', `/shots/${shot.id}`, { description: 'blocked', expectedVersion: 1 })).status, 403);
      assert.equal((await manager.request('DELETE', membersPath() + '/' + editorId, { expectedRole: 'EDITOR' })).status, 409);
      assert.equal((await manager.request('DELETE', membersPath() + '/' + editorId, { expectedRole: 'VIEWER' })).status, 200);
      assert.equal((await editor.request('GET', `/projects/${project.id}/script`)).status, 404);
      assert.equal((await editor.request('GET', '/auth/me')).status, 200);
      assert.equal((await owner.request('POST', membersPath(), { userId: editorId, role: 'EDITOR' })).status, 201);
      assert.equal((await owner.request('POST', membersPath(), { userId: adminId, role: 'VIEWER' })).status, 400);
    });
    await t.test('workspace owners and admins cannot be removed or escalated by ordinary admins', async () => {
      const ownerId = setup.data.user.id;
      assert.equal((await owner.request('DELETE', `/workspaces/${workspace.id}/members/${ownerId}`, { expectedRole: 'WORKSPACE_OWNER' })).status, 400);
      assert.equal((await owner.request('PATCH', `/workspaces/${workspace.id}/members/${ownerId}`, { expectedRole: 'WORKSPACE_OWNER', role: 'MEMBER' })).status, 400);
      assert.equal((await admin.request('POST', `/workspaces/${workspace.id}/invitations`, { email: 'escalate@test.example', role: 'WORKSPACE_ADMIN' })).status, 403);
      assert.equal((await admin.request('PATCH', `/workspaces/${workspace.id}/members/${editorId}`, { expectedRole: 'MEMBER', role: 'WORKSPACE_ADMIN' })).status, 403);
      assert.equal((await admin.request('DELETE', `/workspaces/${workspace.id}/members/${adminId}`, { expectedRole: 'WORKSPACE_ADMIN' })).status, 403);
      assert.equal((await outsider.request('GET', trashPath())).status, 404);
      assert.equal((await owner.request('PATCH', `/workspaces/${workspace.id}/members/${editorId}`, { expectedRole: 'WORKSPACE_ADMIN', role: 'MEMBER' })).status, 409);
    });
    await t.test('trash hides all ordinary reads and writes; managers see only their own trash', async () => {
      assert.equal((await editor.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 1 })).status, 403);
      assert.equal((await outsider.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 1 })).status, 404);
      assert.equal((await manager.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 99 })).status, 409);
      const result = await manager.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 1 });
      assert.equal(result.status, 201); assert.equal(result.data.deletedBy, managerId); assert.equal(result.data.version, 2);
      for (const path of [`/projects/${project.id}`, `/projects/${project.id}/episodes`, `/projects/${project.id}/access`, membersPath(), `/projects/${project.id}/script`, `/projects/${project.id}/script/versions`, `/projects/${project.id}/script/versions/1`, `/episodes/${episode.id}`, `/episodes/${episode.id}/shots`, `/shots/${shot.id}`]) assert.equal((await owner.request('GET', path)).status, 404, path);
      for (const [method, path, body] of [
        ['PATCH', `/projects/${project.id}`, { title: 'blocked', expectedVersion: 2 }],
        ['POST', `/projects/${project.id}/episodes`, { title: 'blocked' }],
        ['PATCH', `/episodes/${episode.id}`, { title: 'blocked', expectedVersion: 1 }],
        ['POST', `/episodes/${episode.id}/shots`, {}],
        ['PATCH', `/shots/${shot.id}`, { description: 'blocked', expectedVersion: 1 }],
        ['POST', `/projects/${project.id}/script`, { title: 'blocked', content: 'blocked', expectedVersion: 1 }],
        ['POST', membersPath(), { userId: editorId, role: 'EDITOR' }],
      ]) assert.equal((await owner.request(method, path, body)).status, 404, path);
      assert.deepEqual((await owner.request('GET', `/projects?workspaceId=${workspace.id}`)).data, []);
      const hidden = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Admin only' })).data;
      assert.equal(hidden.code, 'P0002');
      await owner.request('POST', `/projects/${hidden.id}/trash`, { expectedVersion: 1 });
      assert.deepEqual((await manager.request('GET', trashPath())).data.map(item => item.id), [project.id]);
      assert.deepEqual((await editor.request('GET', trashPath())).data, []);
      assert.equal((await owner.request('GET', trashPath())).data.length, 2);
      assert.equal((await editor.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 2 })).status, 403);
    });
    await t.test('restart and restore preserve identifiers, script revisions, style and nested records', async () => {
      await app.close(); await start();
      assert.equal((await owner.request('GET', trashPath())).data.length, 2);
      assert.equal((await owner.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 1 })).status, 409);
      const restored = await manager.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 2 });
      assert.equal(restored.status, 201); assert.equal(restored.data.id, project.id); assert.equal(restored.data.code, project.code); assert.equal(restored.data.stylePreset, 'ink_wash'); assert.equal(restored.data.deletedAt, null); assert.equal(restored.data.version, 3);
      assert.equal((await owner.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 3 })).status, 409);
      assert.equal((await editor.request('GET', `/episodes/${episode.id}`)).data.code, 'EP01');
      assert.equal((await editor.request('GET', `/shots/${shot.id}`)).data.description, '五色石');
      assert.equal((await editor.request('GET', `/projects/${project.id}/script/versions/1`)).data.createdBy, editorId);
      assert.equal((await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'After recovery' })).data.code, 'P0003');
    });
    await t.test('workspace removal cleans active and trashed access and pending invitations without deleting authors', async () => {
      const otherInvite = await owner.request('POST', `/workspaces/${other.id}/invitations`, { email: 'manager@lifecycle.test' });
      assert.equal((await manager.request('POST', '/invitations/accept', { token: otherInvite.data.token })).status, 201);
      assert.equal((await owner.request('PATCH', `/workspaces/${workspace.id}/members/${managerId}`, { expectedRole: 'MEMBER', role: 'WORKSPACE_ADMIN' })).status, 200);
      const obsolete = await manager.request('POST', `/workspaces/${workspace.id}/invitations`, { email: 'obsolete@lifecycle.test' });
      await owner.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 3 });
      const active = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Active membership' })).data;
      await owner.request('POST', `/projects/${active.id}/members`, { userId: editorId, role: 'EDITOR' });
      assert.equal((await owner.request('PATCH', `/workspaces/${workspace.id}/members/${managerId}`, { expectedRole: 'WORKSPACE_ADMIN', role: 'MEMBER' })).status, 200);
      assert.equal((await client().request('POST', '/invitations/accept', { token: obsolete.data.token, name: 'Obsolete', password: 'Studio8!' })).status, 400);
      assert.equal((await owner.request('DELETE', `/workspaces/${workspace.id}/members/${managerId}`, { expectedRole: 'MEMBER' })).status, 200);
      assert.equal((await manager.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 4 })).status, 404);
      assert.deepEqual((await manager.request('GET', '/workspaces')).data.map(item => item.id), [other.id]);
      assert.equal((await owner.request('DELETE', `/workspaces/${workspace.id}/members/${editorId}`, { expectedRole: 'MEMBER' })).status, 200);
      assert.equal((await editor.request('GET', `/projects/${active.id}`)).status, 404);
      assert.equal((await editor.request('GET', '/auth/me')).status, 200);
      const sqlite = app.get(DatabaseService).sqlite;
      assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM project_members WHERE user_id IN (?, ?)').get(managerId, editorId).count, 0);
      assert.equal((await owner.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 4 })).status, 201);
      assert.equal((await owner.request('GET', `/projects/${project.id}/script/versions/1`)).data.createdBy, editorId);
      const actions = sqlite.prepare('SELECT DISTINCT action FROM audit_events').all().map(row => row.action);
      for (const action of ['project.trash', 'project.restore', 'project.member.remove', 'workspace.member.role', 'workspace.member.remove']) assert.ok(actions.includes(action));
      assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    });
  } finally { if (app) await app.close(); await rm(directory, { recursive: true, force: true }); }
});
