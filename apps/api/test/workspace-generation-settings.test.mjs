import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

test('workspace instances configure independently of projects and retain existing security boundaries', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-workspace-settings-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  Object.assign(process.env, {
    DATABASE_PATH: join(directory, 'studio.sqlite'),
    MEDIA_ROOT: join(directory, 'media'),
    SETUP_TOKEN: 'workspace-settings-isolated-setup-2026',
    PROVIDER_MASTER_KEY: '4'.repeat(64),
    COOKIE_SECURE: 'false',
  });
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const app = await createApplication();
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  function client() {
    let cookie = '',
      csrf = '';
    return async (method, path, data) => {
      const r = await fetch(base + '/api/v1' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Request': '1',
          'X-CSRF-Token': csrf,
          Cookie: cookie,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      if (r.headers.getSetCookie().length)
        cookie = r.headers
          .getSetCookie()
          .map((x) => x.split(';')[0])
          .join('; ');
      const body = await r.json();
      if (body.csrfToken) csrf = body.csrfToken;
      return { status: r.status, data: body };
    };
  }
  const owner = client(),
    member = client(),
    foreign = client();
  let workspaceId, connectionId;
  try {
    const setup = await owner('POST', '/setup/initialize', {
      setupToken: process.env.SETUP_TOKEN,
      email: 'owner@settings.test',
      password: 'Studio8!',
      name: 'Owner',
      workspaceName: 'Settings workspace',
    });
    workspaceId = setup.data.workspace.id;
    const input = {
      name: 'Workspace GPU',
      baseUrl: 'http://127.0.0.1:49999',
      trustedPrivate: true,
      token: 'fake-workspace-private-token',
    };
    await t.test(
      'an empty workspace can create and list an instance without creating a project',
      async () => {
        const created = await owner('POST', `/workspaces/${workspaceId}/generation-connections`, input);
        assert.equal(created.status, 201);
        connectionId = created.data.id;
        const config = await owner('GET', `/workspaces/${workspaceId}/generation-connections`);
        assert.equal(config.status, 200);
        assert.equal(config.data.canConfigure, true);
        assert.equal(config.data.connections.length, 1);
        assert.equal(config.data.connections[0].baseUrl, input.baseUrl);
        assert(!JSON.stringify(config.data).includes(input.token));
        assert.equal(app.get(DatabaseService).sqlite.prepare('SELECT count(*) n FROM projects').get().n, 0);
      },
    );
    await t.test(
      'ordinary workspace membership reveals no endpoint and cannot configure instances',
      async () => {
        const invite = await owner('POST', `/workspaces/${workspaceId}/invitations`, {
          email: 'member@settings.test',
        });
        assert.equal(
          (
            await member('POST', '/invitations/accept', {
              token: invite.data.token,
              name: 'Member',
              password: 'Studio8!',
            })
          ).status,
          201,
        );
        const config = await member('GET', `/workspaces/${workspaceId}/generation-connections`);
        assert.equal(config.status, 200);
        assert.equal(config.data.canConfigure, false);
        assert.deepEqual(config.data.connections, []);
        assert.equal(
          (await member('POST', `/workspaces/${workspaceId}/generation-connections`, input)).status,
          403,
        );
        assert.equal(
          (
            await member('PATCH', `/generation-connections/${connectionId}`, {
              enabled: false,
              expectedVersion: 1,
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      'foreign workspaces cannot read or change connections and invalid URLs remain rejected',
      async () => {
        const other = await owner('POST', '/workspaces', { name: 'Other workspace' });
        const invite = await owner('POST', `/workspaces/${other.data.id}/invitations`, {
          email: 'foreign@settings.test',
        });
        await foreign('POST', '/invitations/accept', {
          token: invite.data.token,
          name: 'Foreign',
          password: 'Studio8!',
        });
        assert.equal((await foreign('GET', `/workspaces/${workspaceId}/generation-connections`)).status, 404);
        assert.equal(
          (await foreign('POST', `/workspaces/${workspaceId}/generation-connections`, input)).status,
          403,
        );
        assert.equal(
          (
            await owner('POST', `/workspaces/${workspaceId}/generation-connections`, {
              ...input,
              baseUrl: 'https://user:password@example.com',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await owner('POST', `/workspaces/${workspaceId}/generation-connections`, {
              ...input,
              trustedPrivate: false,
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      'existing project creation and generation configuration use the same workspace instances',
      async () => {
        const project = (await owner('POST', '/projects', { workspaceId, title: 'Existing project path' }))
          .data;
        const config = await owner('GET', `/projects/${project.id}/generation-config`);
        assert(config.data.connections.some((item) => item.id === connectionId));
        const second = await owner('POST', `/projects/${project.id}/generation-connections`, {
          ...input,
          name: 'Compatible old path',
        });
        assert.equal(second.status, 201);
        const workspace = (await owner('GET', `/workspaces/${workspaceId}/generation-connections`)).data;
        assert(workspace.connections.some((item) => item.id === second.data.id));
        assert.equal(app.get(DatabaseService).sqlite.pragma('foreign_key_check').length, 0);
      },
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
