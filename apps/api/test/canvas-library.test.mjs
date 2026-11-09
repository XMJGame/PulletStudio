import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';

test('canvas uploads retain durable non-library intent and explicit project collection is authorized atomic and repeat-safe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pullet-canvas-library-'));
  Object.assign(process.env, {
    DATABASE_PATH: join(root, 'studio.sqlite'),
    MEDIA_ROOT: join(root, 'media'),
    COOKIE_SECURE: 'false',
    SETUP_TOKEN: 'isolated-canvas-library-setup-token-2026',
  });
  const { createApplication } = await import('../dist/application.js'),
    { DatabaseService } = await import('../dist/db/database.service.js'),
    { AppConfig } = await import('../dist/config.js');
  let app, base;
  let cookies = '',
    csrf = '';
  async function start() {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  }
  async function call(method, path, body, key = randomUUID(), cookie = cookies, token = csrf) {
    const binary = Buffer.isBuffer(body);
    const r = await fetch(base + '/api/v1' + path, {
      method,
      headers: {
        'content-type': binary ? 'application/octet-stream' : 'application/json',
        cookie,
        'X-Studio-Request': '1',
        'X-CSRF-Token': token,
        'Idempotency-Key': key,
      },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    });
    return { status: r.status, data: await r.json(), response: r };
  }
  try {
    await start();
    const fixtures = await createMediaFixtures(join(root, 'fixtures'), app.get(AppConfig).ffmpegPath);
    const bytes = fixtures['image.png'].bytes;
    const init = await call('POST', '/setup/initialize', {
      setupToken: process.env.SETUP_TOKEN,
      email: 'owner@canvas-library.test',
      password: 'Studio8!',
      name: 'Owner',
      workspaceName: 'Canvas library',
    });
    assert.equal(init.status, 201);
    cookies = init.response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
    csrf = init.data.csrfToken;
    const workspace = init.data.workspace.id;
    const project = (await call('POST', '/projects', { workspaceId: workspace, title: 'Canvas drafts' }))
      .data;
    const other = (await call('POST', '/projects', { workspaceId: workspace, title: 'Other project' })).data;
    const folder = (
      await call('POST', `/projects/${project.id}/library-folders`, { name: 'Selected references' })
    ).data;
    const foreign = (await call('POST', `/projects/${other.id}/library-folders`, { name: 'Foreign' })).data;
    const key = randomUUID(),
      input = {
        fileName: 'canvas.png',
        byteLength: bytes.length,
        contentType: 'image/png',
        addToLibrary: false,
      };
    const intent = await call('POST', `/projects/${project.id}/media-uploads`, input, key);
    assert.equal(intent.status, 201);
    assert.equal(
      (await call('POST', `/projects/${project.id}/media-uploads`, { ...input, addToLibrary: true }, key))
        .status,
      409,
    );
    const db = app.get(DatabaseService).sqlite;
    assert.throws(
      () => db.prepare('UPDATE media_uploads SET add_to_library=1 WHERE id=?').run(intent.data.id),
      /immutable/,
    );
    // Abort final registration after bytes are archived, then restart before reconciling.
    db.exec(
      "CREATE TRIGGER fixture_collection_failure BEFORE INSERT ON media_versions BEGIN SELECT RAISE(ABORT,'fixture'); END;",
    );
    const failed = await call('PUT', `/media-uploads/${intent.data.id}/content`, bytes);
    assert.equal(failed.status, 409);
    assert.equal((await call('GET', `/media-uploads/${intent.data.id}`)).data.state, 'needs_reconciliation');
    db.exec('DROP TRIGGER fixture_collection_failure');
    await app.close();
    app = undefined;
    await start();
    const done = await call('POST', `/media-uploads/${intent.data.id}/reconcile`, {});
    assert.equal(done.status, 201, JSON.stringify(done.data));
    const media = done.data.mediaVersion;
    assert.equal(media.inLibrary, false);
    assert.equal((await call('GET', `/projects/${project.id}/media-assets`)).data.items.length, 0);
    assert.equal(
      (await call('GET', `/projects/${project.id}/board-sources?kind=media`)).data.items.length,
      0,
    );
    const content = await fetch(base + '/api/v1' + `/media-versions/${media.id}/content`, {
      headers: { cookie: cookies },
    });
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), bytes);
    const payload = {
      mediaVersionId: media.id,
      name: 'Chosen reference',
      folderId: foreign.id,
      expectedAssetVersion: 1,
    };
    assert.equal((await call('POST', `/projects/${project.id}/library-media`, payload)).status, 404);
    assert.equal((await call('GET', `/media-versions/${media.id}`)).data.inLibrary, false);
    const invite = (
      await call('POST', `/workspaces/${workspace}/invitations`, { email: 'viewer@canvas-library.test' })
    ).data;
    const joined = await call(
      'POST',
      '/invitations/accept',
      { token: invite.token, name: 'Viewer', password: 'Studio8!' },
      randomUUID(),
      '',
      '',
    );
    const readerCookies = joined.response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
    await call('POST', `/projects/${project.id}/members`, { userId: joined.data.user.id, role: 'VIEWER' });
    payload.folderId = folder.id;
    assert.equal(
      (
        await call(
          'POST',
          `/projects/${project.id}/library-media`,
          payload,
          randomUUID(),
          readerCookies,
          joined.data.csrfToken,
        )
      ).status,
      403,
    );
    const saved = await call('POST', `/projects/${project.id}/library-media`, payload);
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    assert.equal(saved.data.alreadyInLibrary, false);
    assert.equal(
      (await call('POST', `/projects/${project.id}/library-media`, { ...payload, name: 'Do not overwrite' }))
        .data.alreadyInLibrary,
      true,
    );
    const current = (await call('GET', `/media-versions/${media.id}`)).data;
    assert.equal(current.libraryName, 'Chosen reference');
    assert.equal(current.fileName, 'canvas.png');
    assert.equal(current.id, media.id);
    assert.equal(current.assetVersion, 1);
    assert.equal(
      app.get(DatabaseService).sqlite.prepare('SELECT name FROM media_assets WHERE id=?').get(media.assetId)
        .name,
      'canvas.png',
    );
    assert.equal(
      (await call('POST', `/projects/${project.id}/library-media`, { ...payload, expectedAssetVersion: 2 }))
        .status,
      409,
    );
    assert.equal(
      (await call('POST', `/projects/${other.id}/library-media`, { ...payload, folderId: null })).status,
      404,
    );
    const retained = await fetch(base + `/api/v1/media-versions/${media.id}/content`, {
      headers: { cookie: cookies },
    });
    assert.deepEqual(Buffer.from(await retained.arrayBuffer()), bytes);
    const listing = (
      await call('GET', `/projects/${project.id}/board-sources?kind=media&q=Chosen&folderId=${folder.id}`)
    ).data;
    assert.equal(listing.items.length, 1);
    assert.equal(listing.items[0].value.title, 'Chosen reference');
    assert.equal(
      app
        .get(DatabaseService)
        .sqlite.prepare("SELECT count(*) n FROM audit_events WHERE action='library.media.save'")
        .get().n,
      1,
    );
    assert.equal(app.get(DatabaseService).sqlite.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(app.get(DatabaseService).sqlite.pragma('foreign_key_check'), []);
  } finally {
    if (app) await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
