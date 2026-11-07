import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
test('public entity snapshots retain structured content and independently import reference media', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-public-entities-'));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'public-entities-isolated-setup-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js'),
    { DatabaseService } = await import('../dist/db/database.service.js'),
    { AppConfig } = await import('../dist/config.js');
  let app,
    base,
    workspace,
    project,
    target,
    fixtures,
    entity,
    published,
    imported,
    images = [];
  const db = () => app.get(DatabaseService).sqlite;
  const client = () => {
    let cookie = '',
      csrf = '';
    return async (method, path, body, key = randomUUID()) => {
      const binary = Buffer.isBuffer(body),
        response = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            'Content-Type': binary ? 'application/octet-stream' : 'application/json',
            'X-Studio-Request': '1',
            Cookie: cookie,
            'X-CSRF-Token': csrf,
            'Idempotency-Key': key,
          },
          body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
        });
      if (response.headers.getSetCookie().length)
        cookie = response.headers
          .getSetCookie()
          .map((v) => v.split(';')[0])
          .join('; ');
      if (response.ok && !response.headers.get('content-type')?.includes('application/json'))
        return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  };
  const owner = client(),
    recipient = client(),
    viewer = client(),
    maker = client();
  const publicPath = () => `/workspaces/${workspace.id}/public-library`,
    sourcePath = () => `/projects/${project.id}/public-library`,
    targetPath = () => `/projects/${target.id}/public-library`;
  const create = async (kind, name, extra = {}, actor = owner) => {
    const value = await actor('POST', `/projects/${project.id}/entities`, { kind, body: { name, ...extra } });
    assert.equal(value.status, 201, JSON.stringify(value.data));
    return value.data;
  };
  const collect = async (value, actor = owner, extra = {}, key = randomUUID()) =>
    actor('POST', `${sourcePath()}/entities`, { revisionId: value.revision.id, ...extra }, key);
  try {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@public-entity.test',
        password: 'Studio8!',
        name: 'Owner',
        workspaceName: 'Public assets',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Private source' })).data;
    target = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Target' })).data;
    for (const [actor, name, sourceRole, targetRole] of [
      [recipient, 'Recipient', null, 'EDITOR'],
      [viewer, 'Viewer', 'VIEWER', 'VIEWER'],
      [maker, 'Maker', 'EDITOR', null],
    ]) {
      const invitation = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, {
          email: `${name}@public-entity.test`,
        })
      ).data;
      const joined = (
        await actor('POST', '/invitations/accept', { token: invitation.token, name, password: 'Studio8!' })
      ).data;
      if (sourceRole)
        await owner('POST', `/projects/${project.id}/members`, { userId: joined.user.id, role: sourceRole });
      if (targetRole)
        await owner('POST', `/projects/${target.id}/members`, { userId: joined.user.id, role: targetRole });
    }
    fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    for (const name of ['image.png', 'other.png', 'sound.wav']) {
      const bytes = fixtures[name === 'other.png' ? 'image.png' : name].bytes,
        start = (
          await owner('POST', `/projects/${project.id}/media-uploads`, {
            fileName: name,
            byteLength: bytes.length,
          })
        ).data;
      const file = (await owner('PUT', `/media-uploads/${start.id}/content`, bytes)).data.mediaVersion;
      images.push(file);
    }
    await t.test('collects one fixed revision and scopes all metadata and reference images', async () => {
      entity = await create('character', 'Coastal traveller', {
        description: 'Keeps the original design.',
        attributes: { appearance: 'Short hair', costume: 'Weatherproof coat' },
        media: [
          { role: 'front', mediaVersionId: images[0].id },
          { role: 'side', mediaVersionId: images[0].id },
          { role: 'detail', mediaVersionId: images[1].id },
        ],
      });
      await owner('POST', `/entities/${entity.id}/revisions/1/decisions`, {
        action: 'approve',
        expectedDecisionVersion: 0,
        reason: 'Reference accepted',
      });
      const key = randomUUID(),
        result = await collect(entity, owner, {}, key);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      published = result.data;
      assert.equal((await collect(entity, owner, {}, key)).data.id, published.id);
      const later = await owner('POST', `/entities/${entity.id}/revisions`, {
        expectedVersion: 1,
        body: {
          name: 'Updated traveller',
          description: 'Later source changes',
          attributes: { appearance: 'Long hair' },
          media: [],
        },
      });
      assert.equal(later.status, 201);
      const listed = (await recipient('GET', `${publicPath()}/entities?kind=character&q=Coastal`)).data;
      assert.equal(listed.items.length, 1);
      const read = (await recipient('GET', `${targetPath()}/entities/${published.id}`)).data;
      assert.equal(read.snapshotVersion, 1);
      assert.equal(read.name, 'Coastal traveller');
      assert.equal(read.attributes.costume, 'Weatherproof coat');
      assert.equal(read.media.length, 3);
      assert.equal((await recipient('GET', `/entities/${entity.id}`)).status, 404);
      assert.equal((await recipient('GET', `/media-versions/${images[0].id}/content`)).status, 404);
      assert.deepEqual(
        (await recipient('GET', read.media[0].contentUrl.replace('/api/v1', ''))).bytes,
        fixtures['image.png'].bytes,
      );
      assert.equal(
        (await recipient('GET', `${publicPath()}/entities/${published.id}/media/${images[2].id}/content`))
          .status,
        404,
      );
      assert.equal((await recipient('GET', `${publicPath()}/resources`)).data.items.length, 0);
      const foreign = (await owner('POST', '/workspaces', { name: 'Other team' })).data;
      assert.equal(
        (await owner('GET', `/workspaces/${foreign.id}/public-library/entities/${published.id}`)).status,
        404,
      );
      assert.equal((await recipient('GET', `/workspaces/${foreign.id}/public-library/entities`)).status, 404);
    });
    await t.test(
      'asset ownership, image ownership, voice samples and revoked revisions remain protected',
      async () => {
        assert.equal((await collect(entity, viewer)).status, 403);
        assert.equal((await collect(entity, maker)).status, 403);
        const withPrivateImage = await create(
          'prop',
          'Another artist image',
          { media: [{ role: 'front', mediaVersionId: images[0].id }] },
          maker,
        );
        assert.equal((await collect(withPrivateImage, maker)).status, 403);
        const voice = await create('voice', 'Private voice', {
          attributes: { consentStatus: 'owned' },
          media: [{ role: 'voice_sample', mediaVersionId: images[2].id }],
        });
        assert.equal((await collect(voice)).status, 403);
        assert.equal((await viewer('POST', `${targetPath()}/entities/${published.id}/import`)).status, 403);
        assert.equal(
          (await recipient('DELETE', `${publicPath()}/entities/${published.id}`, { expectedVersion: 1 }))
            .status,
          403,
        );
        const revoked = await create('environment', 'Revoked scene');
        await owner('POST', `/entities/${revoked.id}/revisions/1/decisions`, {
          action: 'approve',
          expectedDecisionVersion: 0,
          reason: 'Initial',
        });
        await owner('POST', `/entities/${revoked.id}/revisions/1/decisions`, {
          action: 'revoke',
          expectedDecisionVersion: 1,
          reason: 'Outdated',
        });
        assert.equal((await collect(revoked)).status, 409);
      },
    );
    await t.test(
      'independent imported drafts preserve attributes and deduplicate image role copies',
      async () => {
        const key = randomUUID(),
          result = await recipient('POST', `${targetPath()}/entities/${published.id}/import`, undefined, key);
        assert.equal(result.status, 201, JSON.stringify(result.data));
        imported = result.data;
        assert.notEqual(imported.id, entity.id);
        assert.equal(imported.revision.name, 'Coastal traveller');
        assert.equal(imported.revision.status, 'draft');
        assert.equal(imported.revision.attributes.appearance, 'Short hair');
        assert.equal(imported.revision.media.length, 3);
        assert.equal(imported.librarySource.resourceId, published.id);
        assert.equal(new Set(imported.revision.media.map((ref) => ref.mediaVersionId)).size, 2);
        assert.equal(
          db().prepare('SELECT count(*) AS n FROM media_versions WHERE project_id=?').get(target.id).n,
          2,
        );
        const changed = await recipient('POST', `/entities/${imported.id}/revisions`, {
          expectedVersion: 1,
          body: { name: 'Target variant', media: [] },
        });
        assert.equal(changed.status, 201);
        const replay = await recipient(
          'POST',
          `${targetPath()}/entities/${published.id}/import`,
          undefined,
          key,
        );
        assert.equal(replay.data.revision.version, 1);
        assert.equal(replay.data.revision.name, 'Coastal traveller');
        const scene = await create('environment', 'Shared workshop', {
            attributes: { layout: 'Two doors', lighting: 'Soft daylight' },
          }),
          scenePublic = (await collect(scene)).data;
        const sceneImport = await recipient('POST', `${targetPath()}/entities/${scenePublic.id}/import`);
        assert.equal(sceneImport.status, 201, JSON.stringify(sceneImport.data));
        assert.equal(sceneImport.data.revision.attributes.layout, 'Two doors');
        const prop = await create('prop', 'Compass', {
            attributes: { material: 'Brass', scale: 'Handheld' },
          }),
          propPublic = (await collect(prop)).data;
        const propImport = await recipient('POST', `${targetPath()}/entities/${propPublic.id}/import`);
        assert.equal(propImport.data.revision.attributes.material, 'Brass');
        assert.throws(
          () =>
            db().exec('UPDATE workspace_entity_imports SET entity_id=entity_id WHERE entity_id IS NOT NULL'),
          /immutable/,
        );
        assert.throws(() => db().exec('DELETE FROM workspace_entity_import_media'), /immutable/);
        assert.equal(
          (await owner('DELETE', `${publicPath()}/entities/${published.id}`, { expectedVersion: 1 })).status,
          200,
        );
        assert.equal((await recipient('GET', `${publicPath()}/entities/${published.id}`)).status, 404);
        assert.equal(
          (await recipient('POST', `${targetPath()}/entities/${published.id}/import`, undefined, key)).data
            .revision.version,
          1,
        );
        const image = imported.revision.media[0];
        assert.deepEqual(
          (await recipient('GET', `/media-versions/${image.mediaVersionId}/content`)).bytes,
          fixtures['image.png'].bytes,
        );
      },
    );
    await t.test(
      'partial media and final transaction failures recover without duplicate entities or images',
      async () => {
        const source = await create('character', 'Recoverable', {
            media: [
              { role: 'front', mediaVersionId: images[0].id },
              { role: 'side', mediaVersionId: images[1].id },
            ],
          }),
          resource = (await collect(source)).data,
          key = randomUUID();
        const before = db()
          .prepare('SELECT count(*) AS n FROM media_versions WHERE project_id=?')
          .get(target.id).n;
        db().exec(
          `CREATE TRIGGER forced_entity_result BEFORE INSERT ON asset_entities WHEN NEW.project_id='${target.id}' BEGIN SELECT RAISE(ABORT,'forced result failure'); END`,
        );
        const failed = await recipient(
          'POST',
          `${targetPath()}/entities/${resource.id}/import`,
          undefined,
          key,
        );
        assert.equal(failed.status, 409, JSON.stringify(failed.data));
        db().exec('DROP TRIGGER forced_entity_result');
        assert.equal(
          (await recipient('GET', `${targetPath()}/entities/${resource.id}`)).data.pendingImportKey,
          key,
        );
        assert.equal((await recipient('POST', `${targetPath()}/entities/${resource.id}/import`)).status, 409);
        assert.equal(
          db().prepare('SELECT count(*) AS n FROM media_versions WHERE project_id=?').get(target.id).n,
          before + 2,
        );
        const recovered = await recipient(
          'POST',
          `${targetPath()}/entities/${resource.id}/import`,
          undefined,
          key,
        );
        assert.equal(recovered.status, 201, JSON.stringify(recovered.data));
        assert.equal(recovered.data.revision.media.length, 2);
        assert.equal(
          db().prepare('SELECT count(*) AS n FROM media_versions WHERE project_id=?').get(target.id).n,
          before + 2,
        );
        const source2 = await create('prop', 'Recover image registration', {
            media: [{ role: 'reference', mediaVersionId: images[0].id }],
          }),
          resource2 = (await collect(source2)).data,
          key2 = randomUUID();
        db().exec(
          `CREATE TRIGGER forced_entity_media BEFORE INSERT ON media_versions WHEN NEW.project_id='${target.id}' BEGIN SELECT RAISE(ABORT,'forced media failure'); END`,
        );
        assert.equal(
          (await recipient('POST', `${targetPath()}/entities/${resource2.id}/import`, undefined, key2))
            .status,
          409,
        );
        db().exec('DROP TRIGGER forced_entity_media');
        assert.equal(
          (await recipient('POST', `${targetPath()}/entities/${resource2.id}/import`, undefined, key2))
            .status,
          201,
        );
        const { MediaProbe } = await import('../dist/assets/media-probe.js'),
          probe = app.get(MediaProbe),
          inspect = probe.inspect.bind(probe);
        const source3 = await create('prop', 'Removed while importing', {
            media: [{ role: 'reference', mediaVersionId: images[1].id }],
          }),
          resource3 = (await collect(source3)).data;
        probe.inspect = async (...args) => {
          const details = await inspect(...args);
          db()
            .prepare('UPDATE workspace_entity_resources SET removed_at=? WHERE id=?')
            .run(new Date().toISOString(), resource3.id);
          return details;
        };
        try {
          assert.equal(
            (await recipient('POST', `${targetPath()}/entities/${resource3.id}/import`)).status,
            404,
          );
        } finally {
          probe.inspect = inspect;
        }
        assert.equal(db().pragma('foreign_key_check').length, 0);
      },
    );
    await t.test('folder classification, revocation and filters apply to fixed public entries', async () => {
      const folder = (await owner('POST', `${publicPath()}/library-folders`, { name: 'Asset shelf' })).data,
        resource = (
          await collect(await create('environment', 'Paged studio'), owner, { folderId: folder.id })
        ).data;
      assert.equal(
        (await recipient('GET', `${publicPath()}/entities?folderId=${folder.id}&kind=environment&q=Paged`))
          .data.items.length,
        1,
      );
      assert.equal(
        (await recipient('GET', `${publicPath()}/entities?folderId=${folder.id}&kind=prop`)).data.items
          .length,
        0,
      );
      const row = (await recipient('GET', `${publicPath()}/entities/${resource.id}`)).data;
      assert.equal(
        (
          await owner('PATCH', `${publicPath()}/entities/${resource.id}`, {
            expectedVersion: row.version,
            folderId: null,
          })
        ).data.version,
        2,
      );
      assert.equal(
        (
          await owner('PATCH', `${publicPath()}/entities/${resource.id}`, {
            expectedVersion: 1,
            folderId: null,
          })
        ).status,
        409,
      );
      const ref = db()
        .prepare('SELECT source_entity_id FROM workspace_entity_resources WHERE id=?')
        .get(resource.id);
      await owner('POST', `/entities/${ref.source_entity_id}/revisions/1/decisions`, {
        action: 'approve',
        expectedDecisionVersion: 0,
        reason: 'Approved',
      });
      await owner('POST', `/entities/${ref.source_entity_id}/revisions/1/decisions`, {
        action: 'revoke',
        expectedDecisionVersion: 1,
        reason: 'Retired',
      });
      assert.equal((await recipient('GET', `${publicPath()}/entities/${resource.id}`)).status, 409);
      assert.equal((await recipient('GET', `${publicPath()}/entities?q=Paged`)).data.items.length, 0);
      assert.equal(
        (await owner('DELETE', `${publicPath()}/entities/${resource.id}`, { expectedVersion: 2 })).status,
        200,
      );
    });
    await t.test(
      'public entity folder filtering and pagination never truncate the requested category',
      async () => {
        const folder = (await owner('POST', `${publicPath()}/library-folders`, { name: 'Paged entities' }))
          .data;
        const all = [];
        for (let i = 0; i < 22; i++) {
          const value = await create(i % 2 ? 'prop' : 'environment', `Paged reference ${i}`);
          const resource = (await collect(value, owner, { folderId: folder.id })).data;
          all.push({ ...resource, name: value.revision.name });
        }
        const first = (await recipient('GET', `${publicPath()}/entities?folderId=${folder.id}`)).data;
        assert.equal(first.items.length, 20);
        assert.ok(first.nextCursor);
        const second = (
          await recipient('GET', `${publicPath()}/entities?folderId=${folder.id}&cursor=${first.nextCursor}`)
        ).data;
        assert.equal(second.items.length, 2);
        assert.equal(second.nextCursor, null);
        const last = all.sort((a, b) => a.id.localeCompare(b.id)).at(-1),
          found = (
            await recipient(
              'GET',
              `${publicPath()}/entities?folderId=${folder.id}&q=${encodeURIComponent(last.name)}`,
            )
          ).data;
        assert.equal(found.items.find((row) => row.id === last.id)?.name, last.name);
        assert.equal(
          (await recipient('GET', `${publicPath()}/entities?folderId=${folder.id}&kind=prop`)).data.items
            .length,
          11,
        );
        assert.equal(
          (await owner('DELETE', `${publicPath()}/library-folders/${folder.id}`, { expectedVersion: 1 }))
            .status,
          200,
        );
        const moved = (await recipient('GET', `${publicPath()}/entities/${last.id}`)).data;
        assert.equal(moved.folderId, null);
        assert.equal(moved.version, 2);
        assert.equal(db().pragma('foreign_key_check').length, 0);
      },
    );
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
