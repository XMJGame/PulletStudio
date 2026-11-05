import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('new passwords accept 8 and 16 characters and reject 7 and 17', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-password-'));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.SETUP_TOKEN = 'password-policy-local-setup-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const app = await createApplication();
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    async function post(path, body, headers = {}) {
      const response = await fetch(base + '/api/v1' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', ...headers }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json(), cookies: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
    }
    const input = { setupToken: process.env.SETUP_TOKEN, name: 'Owner', email: 'policy@example.test', workspaceName: 'Password policy' };
    for (const length of [7, 17]) {
      const invalid = await post('/setup/initialize', { ...input, password: 'a'.repeat(length) });
      assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'VALIDATION_ERROR');
      assert.ok(invalid.data.details.some(issue => issue.path === 'password'));
    }
    const created = await post('/setup/initialize', { ...input, password: 'abcdefgh' });
    assert.equal(created.status, 201);
    const headers = { Cookie: created.cookies, 'X-CSRF-Token': created.data.csrfToken };
    const invitation = await post(`/workspaces/${created.data.workspace.id}/invitations`, { email: 'member-policy@example.test' }, headers);
    assert.equal(invitation.status, 201);
    for (const length of [7, 17]) {
      const invalid = await post('/invitations/accept', { token: invitation.data.token, name: 'Member', password: 'a'.repeat(length) });
      assert.equal(invalid.status, 400); assert.equal(invalid.data.code, 'VALIDATION_ERROR');
    }
    assert.equal((await post('/invitations/accept', { token: invitation.data.token, name: 'Member', password: 'abcdefghijklmnop' })).status, 201);
    for (const [email, password] of [['policy@example.test', 'abcdefgh'], ['member-policy@example.test', 'abcdefghijklmnop']]) {
      assert.equal((await post('/auth/login', { email, password })).status, 200);
    }
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
