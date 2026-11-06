import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import { verifyMedia } from '../../../tools/verify-media.mjs';

test('direct workspace media uploads preserve independent ownership and recoverable archives', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-workspace-upload-'));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'workspace-upload-isolated-setup-2026';
  process.env.COOKIE_SECURE = 'false';
  process.env.MEDIA_MAX_BYTES = String(2 * 1024 * 1024);
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { AppConfig } = await import('../dist/config.js');
  const { MediaProbe } = await import('../dist/assets/media-probe.js');
  let app, base, workspace, fixtures, memberUser;
  const db = () => app.get(DatabaseService).sqlite;
  const client = () => {
    let cookie = '',
      csrf = '';
    return async (method, path, body, headers = {}) => {
      const binary = Buffer.isBuffer(body);
      const response = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': binary ? 'application/octet-stream' : 'application/json',
          'X-Studio-Request': '1',
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          ...headers,
        },
        body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      });
      if (response.headers.getSetCookie().length)
        cookie = response.headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .join('; ');
      if (
        response.ok &&
        response.headers.get('content-type') &&
        !response.headers.get('content-type').includes('application/json')
      )
        return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  };
  const owner = client(),
    member = client(),
    reader = client();
  const path = () => `/workspaces/${workspace.id}/public-library`;
  const intent = async (name = 'image.png', extra = {}, actor = member, key = randomUUID()) =>
    actor(
      'POST',
      `${path()}/media-uploads`,
      { fileName: name, byteLength: fixtures[name].bytes.length, ...extra },
      { 'Idempotency-Key': key },
    );
  const upload = async (name = 'image.png', extra = {}, actor = member) => {
    const start = await intent(name, extra, actor);
    assert.equal(start.status, 201, JSON.stringify(start.data));
    const result = await actor(
      'PUT',
      `${path()}/media-uploads/${start.data.id}/content`,
      fixtures[name].bytes,
    );
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };
  try {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@workspace-upload.test',
        password: 'Studio8!',
        name: 'Owner',
        workspaceName: 'Direct uploads',
      })
    ).data;
    workspace = setup.workspace;
    for (const [actor, name] of [
      [member, 'Uploader'],
      [reader, 'Reader'],
    ]) {
      const invite = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, {
          email: `${name}@workspace-upload.test`,
        })
      ).data;
      const joined = await actor('POST', '/invitations/accept', {
        token: invite.token,
        name,
        password: 'Studio8!',
      });
      assert.equal(joined.status, 201, JSON.stringify(joined.data));
      if (actor === member) memberUser = joined.data.user;
    }
    fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    await t.test('members upload three media types into a project-free workspace', async () => {
      assert.equal((await member('GET', `${path()}/media-status`)).data.available, true);
      const folder = (
        await owner(
          'POST',
          `${path()}/library-folders`,
          { name: 'Shared sources' },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      const key = randomUUID(),
        start = await intent('image.png', { folderId: folder.id }, member, key);
      assert.equal((await intent('image.png', { folderId: folder.id }, member, key)).data.id, start.data.id);
      assert.equal((await intent('clip.mp4', {}, member, key)).status, 409);
      assert.equal((await reader('GET', `${path()}/media-uploads/${start.data.id}`)).status, 404);
      assert.equal((await owner('GET', `${path()}/media-uploads/${start.data.id}`)).status, 200);
      assert.equal((await member('GET', `${path()}/resources`)).data.items.length, 0);
      const image = await member(
        'PUT',
        `${path()}/media-uploads/${start.data.id}/content`,
        fixtures['image.png'].bytes,
      );
      assert.equal(image.status, 200, JSON.stringify(image.data));
      assert.equal(image.data.state, 'complete');
      assert.equal(
        (await intent('image.png', { folderId: folder.id }, member, key)).data.resourceId,
        image.data.resourceId,
      );
      assert.equal(
        (await member('PUT', `${path()}/media-uploads/${start.data.id}/content`, fixtures['image.png'].bytes))
          .status,
        409,
      );
      for (const name of ['clip.mp4', 'sound.wav']) await upload(name, { folderId: folder.id });
      const list = (await reader('GET', `${path()}/resources?folderId=${folder.id}`)).data.items;
      assert.equal(list.length, 3);
      assert.deepEqual(list.map((r) => r.mediaType).sort(), ['audio', 'image', 'video']);
      for (const row of list) {
        assert.deepEqual(
          (await reader('GET', row.contentUrl.replace('/api/v1', ''))).bytes,
          fixtures[row.title].bytes,
        );
        assert.equal(row.canManage, false);
      }
      assert.equal((await reader('GET', `${path()}/resources/${image.data.resourceId}/poster`)).status, 200);
      assert.equal(db().prepare('SELECT count(*) AS n FROM projects').get().n, 0);
      assert.equal(db().prepare('SELECT count(*) AS n FROM media_versions').get().n, 0);
      assert.equal(db().prepare('SELECT count(*) AS n FROM workspace_media_files').get().n, 3);
      assert.throws(() => db().exec('UPDATE workspace_media_files SET file_name=file_name'), /immutable/);
      assert.throws(() => db().exec('UPDATE workspace_media_uploads SET file_name=file_name'), /immutable/);
      assert.throws(() => db().exec('DELETE FROM workspace_native_resources'), /softly/);
      const manifest = await verifyMedia(process.env.DATABASE_PATH, process.env.MEDIA_ROOT);
      assert.equal(manifest.valid, true, JSON.stringify(manifest.errors));
      assert.equal(new Set(manifest.files.map((file) => file.workspaceFileId)).size, 3);
    });
    await t.test('bad names, oversized and malformed files never enter the public library', async () => {
      assert.equal((await intent('image.png', { fileName: '../escape.png' })).status, 400);
      assert.equal((await intent('image.png', { byteLength: 2 * 1024 * 1024 + 1 })).status, 413);
      const start = (await intent()).data;
      assert.equal(
        (await member('PUT', `${path()}/media-uploads/${start.id}/content`, Buffer.from('short'))).status,
        400,
      );
      assert.equal((await member('GET', `${path()}/media-uploads/${start.id}`)).data.state, 'created');
      const bad = Buffer.alloc(fixtures['image.png'].bytes.length, 33);
      assert.equal((await member('PUT', `${path()}/media-uploads/${start.id}/content`, bad)).status, 400);
      assert.equal((await member('GET', `${path()}/media-uploads/${start.id}`)).data.state, 'failed');
      assert.equal(
        (await member('PUT', `${path()}/media-uploads/${start.id}/content`, fixtures['image.png'].bytes)).data
          .state,
        'complete',
      );
    });
    await t.test(
      'archive registration failures and expired upload leases recover the same original',
      async () => {
        const start = (await intent()).data;
        db().exec(
          `CREATE TRIGGER forced_workspace_register BEFORE INSERT ON workspace_native_resources BEGIN SELECT RAISE(ABORT,'forced database fault'); END`,
        );
        const failed = await member(
          'PUT',
          `${path()}/media-uploads/${start.id}/content`,
          fixtures['image.png'].bytes,
        );
        assert.equal(failed.status, 409);
        assert.equal(
          (await member('GET', `${path()}/media-uploads/${start.id}`)).data.state,
          'needs_reconciliation',
        );
        db().exec('DROP TRIGGER forced_workspace_register');
        db()
          .prepare(
            "UPDATE workspace_media_uploads SET state='uploading',lease_owner=?,lease_until=0 WHERE id=?",
          )
          .run(randomUUID(), start.id);
        assert.equal(
          (await member('GET', `${path()}/media-uploads/${start.id}`)).data.state,
          'needs_reconciliation',
        );
        const recovered = await member('POST', `${path()}/media-uploads/${start.id}/reconcile`);
        assert.equal(recovered.status, 201, JSON.stringify(recovered.data));
        assert.equal(recovered.data.state, 'complete');
        assert.deepEqual(
          (await reader('GET', `${path()}/resources/${recovered.data.resourceId}/content`)).bytes,
          fixtures['image.png'].bytes,
        );
        const expired = (await intent()).data;
        db()
          .prepare(
            "UPDATE workspace_media_uploads SET state='uploading',lease_owner=?,lease_until=0 WHERE id=?",
          )
          .run(randomUUID(), expired.id);
        assert.equal((await member('GET', `${path()}/media-uploads/${expired.id}`)).data.state, 'failed');
        const count = db().prepare('SELECT count(*) AS n FROM workspace_media_files').get().n;
        assert.ok(count >= 5);
        assert.equal(
          (await member('GET', `${path()}/media-uploads`)).data.items.some((row) => row.id === expired.id),
          true,
        );
      },
    );
    await t.test(
      'removed folders fall back to unclassified and membership loss blocks final registration',
      async () => {
        const folder = (
          await owner(
            'POST',
            `${path()}/library-folders`,
            { name: 'Temporary folder' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const start = (await intent('image.png', { folderId: folder.id })).data;
        await owner('DELETE', `${path()}/library-folders/${folder.id}`, { expectedVersion: 1 });
        const result = await member(
          'PUT',
          `${path()}/media-uploads/${start.id}/content`,
          fixtures['image.png'].bytes,
        );
        assert.equal(result.status, 200, JSON.stringify(result.data));
        assert.equal(
          (await reader('GET', `${path()}/resources?folderId=root`)).data.items.find(
            (row) => row.id === result.data.resourceId,
          ).folderId,
          null,
        );
        const denied = (await intent()).data,
          probe = app.get(MediaProbe),
          inspect = probe.inspect.bind(probe);
        const membership = db()
          .prepare('SELECT * FROM workspace_members WHERE workspace_id=? AND user_id=?')
          .get(workspace.id, memberUser.id);
        const before = db().prepare('SELECT count(*) AS n FROM workspace_media_files').get().n;
        probe.inspect = async (...args) => {
          const result = await inspect(...args);
          db()
            .prepare('DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?')
            .run(workspace.id, memberUser.id);
          return result;
        };
        try {
          assert.equal(
            (await member('PUT', `${path()}/media-uploads/${denied.id}/content`, fixtures['image.png'].bytes))
              .status,
            404,
          );
          assert.equal((await member('GET', `${path()}/resources`)).status, 404);
          assert.equal(db().prepare('SELECT count(*) AS n FROM workspace_media_files').get().n, before);
        } finally {
          probe.inspect = inspect;
          db()
            .prepare('INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(?,?,?)')
            .run(membership.workspace_id, membership.user_id, membership.role);
        }
      },
    );
    await t.test('workspace and project uploads share the same concurrent transfer limit', async () => {
      const { WorkspaceUploadService } = await import('../dist/assets/workspace-upload.service.js');
      const service = app.get(WorkspaceUploadService),
        probe = app.get(MediaProbe),
        inspect = probe.inspect.bind(probe);
      let release,
        ready,
        count = 0;
      const gate = new Promise((resolve) => {
          release = resolve;
        }),
        started = new Promise((resolve) => {
          ready = resolve;
        });
      probe.inspect = async (...args) => {
        const result = await inspect(...args);
        if (++count === 2) ready();
        await gate;
        return result;
      };
      const first = (await intent()).data,
        second = (await intent()).data,
        third = (await intent()).data;
      async function* body() {
        yield fixtures['image.png'].bytes;
      }
      const pending = [
        service.receive(memberUser, workspace.id, first.id, body()),
        service.receive(memberUser, workspace.id, second.id, body()),
      ];
      try {
        await started;
        assert.equal(
          (await member('PUT', `${path()}/media-uploads/${third.id}/content`, fixtures['image.png'].bytes))
            .status,
          429,
        );
        const project = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Concurrency check' })
        ).data;
        const upload = (
          await owner(
            'POST',
            `/projects/${project.id}/media-uploads`,
            { fileName: 'image.png', byteLength: fixtures['image.png'].bytes.length },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        assert.equal(
          (await owner('PUT', `/media-uploads/${upload.id}/content`, fixtures['image.png'].bytes)).status,
          429,
        );
      } finally {
        release();
        const results = await Promise.allSettled(pending);
        probe.inspect = inspect;
        assert.ok(
          results.every((result) => result.status === 'fulfilled' && result.value.state === 'complete'),
        );
      }
    });
    await t.test(
      'direct resources import as independent project versions with fixed provenance',
      async () => {
        const direct = await upload('clip.mp4');
        const target = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Imported production' })
        ).data;
        const destination = `/projects/${target.id}/public-library`,
          key = randomUUID();
        const result = await owner(
          'POST',
          `${destination}/resources/${direct.resourceId}/import`,
          undefined,
          { 'Idempotency-Key': key },
        );
        assert.equal(result.status, 201, JSON.stringify(result.data));
        assert.equal(result.data.mediaType, 'video');
        assert.equal(result.data.librarySource.resourceId, direct.resourceId);
        assert.equal(
          (
            await owner('POST', `${destination}/resources/${direct.resourceId}/import`, undefined, {
              'Idempotency-Key': key,
            })
          ).data.id,
          result.data.id,
        );
        assert.equal(
          (await owner('GET', `${destination}/resources`)).data.items.find(
            (row) => row.id === direct.resourceId,
          ).inProject,
          true,
        );
        assert.equal(
          (await member('DELETE', `${path()}/resources/${direct.resourceId}`, { expectedVersion: 1 })).status,
          200,
        );
        assert.equal((await reader('GET', `${path()}/resources/${direct.resourceId}/content`)).status, 404);
        assert.deepEqual(
          (await owner('GET', `/media-versions/${result.data.id}/content`)).bytes,
          fixtures['clip.mp4'].bytes,
        );
        const foreign = (await owner('POST', '/workspaces', { name: 'Other team' })).data;
        assert.equal(
          (await owner('GET', `/workspaces/${foreign.id}/public-library/media-uploads/${direct.id}`)).status,
          404,
        );
        assert.equal((await reader('GET', `/workspaces/${foreign.id}/public-library/resources`)).status, 404);
        assert.throws(
          () => db().exec('UPDATE workspace_native_imports SET resource_id=resource_id'),
          /immutable/,
        );
        const manifest = await verifyMedia(process.env.DATABASE_PATH, process.env.MEDIA_ROOT);
        assert.equal(manifest.valid, true, JSON.stringify(manifest.errors));
        assert.ok(manifest.files.some((file) => file.mediaVersionId === result.data.id));
        assert.ok(manifest.files.some((file) => file.workspaceFileId));
        const file = db().prepare('SELECT object_key FROM workspace_media_files LIMIT 1').get(),
          absolute = join(process.env.MEDIA_ROOT, ...file.object_key.split('/'));
        await rename(absolute, absolute + '.held');
        try {
          assert.equal((await verifyMedia(process.env.DATABASE_PATH, process.env.MEDIA_ROOT)).valid, false);
        } finally {
          await rename(absolute + '.held', absolute);
        }
        assert.equal(db().pragma('foreign_key_check').length, 0);
      },
    );
    await t.test('direct and project-collected resources share ordered and filtered pagination', async () => {
      const folder = (
        await owner(
          'POST',
          `${path()}/library-folders`,
          { name: 'Mixed page' },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      for (let index = 0; index < 20; index++)
        await upload('image.png', { fileName: `native-${index}.png`, folderId: folder.id });
      const project = (
        await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Legacy collection' })
      ).data;
      for (let index = 0; index < 2; index++) {
        const intent = (
          await owner(
            'POST',
            `/projects/${project.id}/media-uploads`,
            { fileName: `collected-${index}.png`, byteLength: fixtures['image.png'].bytes.length },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const source = (
          await owner('PUT', `/media-uploads/${intent.id}/content`, fixtures['image.png'].bytes)
        ).data.mediaVersion;
        assert.equal(
          (
            await owner(
              'POST',
              `/projects/${project.id}/public-library/resources`,
              { mediaVersionId: source.id, folderId: folder.id },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          201,
        );
      }
      const first = (await reader('GET', `${path()}/resources?folderId=${folder.id}`)).data;
      assert.equal(first.items.length, 20);
      assert.ok(first.nextCursor);
      const second = (
        await reader('GET', `${path()}/resources?folderId=${folder.id}&cursor=${first.nextCursor}`)
      ).data;
      assert.equal(second.items.length, 2);
      assert.equal(second.nextCursor, null);
      const items = [...first.items, ...second.items];
      assert.equal(new Set(items.map((row) => row.id)).size, 22);
      assert.deepEqual(
        items.map((row) => row.id),
        items.map((row) => row.id).sort(),
      );
      const last = items.at(-1),
        search = (
          await reader('GET', `${path()}/resources?folderId=${folder.id}&q=${last.title}&mediaType=image`)
        ).data;
      assert.deepEqual(
        search.items.map((row) => row.id),
        [last.id],
      );
      assert.equal(search.nextCursor, null);
      assert.equal(
        (await reader('GET', `${path()}/resources?folderId=${folder.id}&mediaType=audio`)).data.items.length,
        0,
      );
    });
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
