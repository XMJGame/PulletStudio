import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, rename, copyFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';

test('formal boards persist immutable references with project permissions and conflict recovery', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-boards-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'isolated-board-integration-setup-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { AppConfig } = await import('../dist/config.js');
  let app,
    base,
    project,
    workspace,
    editorId,
    viewerId,
    board,
    shot,
    entities = [],
    media = {};
  const db = () => app.get(DatabaseService).sqlite;
  function client() {
    let cookies = '',
      csrf = '';
    return async (method, path, body, headers = {}) => {
      const binary = Buffer.isBuffer(body);
      const response = await fetch(base + '/api/v1' + path, {
        method,
        headers: {
          'Content-Type': binary ? 'application/octet-stream' : 'application/json',
          'X-Studio-Request': '1',
          Cookie: cookies,
          'X-CSRF-Token': csrf,
          ...headers,
        },
        body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      });
      if (response.headers.getSetCookie().length)
        cookies = response.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
      if (response.ok && method === 'GET' && /\/(content|poster)$/.test(path))
        return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  }
  const owner = client(),
    editor = client(),
    viewer = client(),
    outsider = client();
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  const create = (title = '视觉探索', unitId = null, actor = owner, key = randomUUID()) =>
    actor('POST', `/projects/${project.id}/boards`, { title, unitId }, { 'Idempotency-Key': key });
  const save = (value, actor = owner, key = randomUUID()) =>
    actor(
      'POST',
      `/boards/${value.id}/revisions`,
      { title: value.title, expectedRevision: value.revision, layout: value.layout },
      { 'Idempotency-Key': key },
    );
  const node = (ref, type = 'reference') => ({
    id: randomUUID(),
    type,
    position: { x: 20, y: 30 },
    width: 240,
    height: 240,
    data:
      type === 'reference'
        ? { ref }
        : type === 'group'
          ? { label: '视觉组', collapsed: false }
          : { text: '制作便签' },
  });
  try {
    await start();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@boards.test',
        password: 'Studio8!',
        name: 'Producer',
        workspaceName: 'Canvas team',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'A coastal journey' }))
      .data;
    for (const [actor, name, role] of [
      [editor, 'Artist', 'EDITOR'],
      [viewer, 'Reader', 'VIEWER'],
      [outsider, 'Outside', null],
    ]) {
      const invitation = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: name + '@boards.test' })
      ).data;
      const joined = (
        await actor('POST', '/invitations/accept', { token: invitation.token, name, password: 'Studio8!' })
      ).data;
      if (role) await owner('POST', `/projects/${project.id}/members`, { userId: joined.user.id, role });
      if (role === 'EDITOR') editorId = joined.user.id;
      if (role === 'VIEWER') viewerId = joined.user.id;
    }
    const fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    for (const name of ['image.png', 'clip.mp4', 'sound.wav']) {
      const intent = (
        await owner(
          'POST',
          `/projects/${project.id}/media-uploads`,
          { fileName: name, byteLength: fixtures[name].bytes.length },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      media[name] = (
        await owner('PUT', `/media-uploads/${intent.id}/content`, fixtures[name].bytes)
      ).data.mediaVersion;
    }
    const basic = (
      await owner('POST', `/projects/${project.id}/shots`, { description: 'Morning light at the station.' })
    ).data;
    const card = (await owner('GET', `/shots/${basic.id}/card/editor`)).data;
    shot = (
      await owner('PATCH', `/shots/${basic.id}/card`, { expectedVersion: basic.version, body: card.body })
    ).data.shot;
    for (const kind of ['character', 'environment', 'prop', 'voice']) {
      const result = await owner(
        'POST',
        `/projects/${project.id}/entities`,
        {
          kind,
          body: {
            name: `Private ${kind} reference`,
            description: 'Fixed identity.',
            media: [
              {
                role: kind === 'voice' ? 'voice_sample' : 'reference',
                mediaVersionId: media[kind === 'voice' ? 'sound.wav' : 'image.png'].id,
              },
            ],
          },
        },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal(result.status, 201, JSON.stringify(result.data));
      entities.push(result.data);
    }
    await t.test(
      'project and unit boards are scoped, idempotent and backed by a first revision',
      async () => {
        const key = randomUUID();
        const first = await create('视觉探索', null, owner, key);
        assert.equal(first.status, 201, JSON.stringify(first.data));
        board = first.data;
        assert.equal(board.revision, 1);
        assert.equal(board.layout.nodes.length, 0);
        assert.equal((await create('视觉探索', null, owner, key)).data.id, board.id);
        assert.equal((await create('改名', null, owner, key)).data.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal((await create('只读', null, viewer)).status, 403);
        assert.equal((await outsider('GET', `/boards/${board.id}`)).status, 404);
        const unit = (
          await owner('POST', `/projects/${project.id}/units`, { kind: 'scene', title: 'Station' })
        ).data;
        const scoped = (await create('场次画布', unit.id)).data;
        assert.equal(scoped.unitTitle, 'Station');
        assert.equal(
          (await owner('GET', `/projects/${project.id}/boards?unitId=${unit.id}`)).data.items.length,
          1,
        );
        const other = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Other project' })
        ).data;
        const foreign = (
          await owner('POST', `/projects/${other.id}/units`, { kind: 'scene', title: 'Foreign' })
        ).data;
        assert.equal((await create('Foreign scope', foreign.id)).status, 404);
      },
    );
    await t.test(
      'fixed shot/entity/media references are resolved without copying business state',
      async () => {
        board.layout.nodes = [
          node({ kind: 'shot', id: shot.id, version: shot.version }),
          ...entities.map((entity) =>
            node({ kind: 'entity', id: entity.id, revisionId: entity.revision.id }),
          ),
          node({ kind: 'media', id: media['clip.mp4'].id }),
          node(null, 'note'),
          node(null, 'brief'),
        ];
        board.layout.edges = [
          { id: randomUUID(), source: board.layout.nodes[1].id, target: board.layout.nodes[0].id },
        ];
        const result = await save(board);
        assert.equal(result.status, 201, JSON.stringify(result.data));
        board = result.data;
        assert.equal(board.resolved[board.layout.nodes[0].id].version, shot.version);
        assert.equal(board.resolved[board.layout.nodes[0].id].summary, shot.description);
        const raw = db()
          .prepare('SELECT layout_json FROM board_revisions WHERE board_id=? ORDER BY version DESC LIMIT 1')
          .get(board.id).layout_json;
        assert.ok(!raw.includes('Private character reference'));
        assert.ok(!raw.includes('Morning light'));
        assert.ok(!raw.includes('blob:'));
        assert.ok(!raw.includes(directory));
        const read = (await editor('GET', `/boards/${board.id}`)).data;
        const restricted = board.layout.nodes[4].id;
        assert.deepEqual(read.resolved[restricted], { status: 'unavailable', title: '引用不可用' });
        assert.ok(!JSON.stringify(read).includes('Private voice reference'));
        assert.ok(!JSON.stringify(read).includes('sound.wav'));
        assert.equal((await editor('GET', media['sound.wav'].contentUrl.replace('/api/v1', ''))).status, 403);
        const unchanged = await save(read, editor);
        assert.equal(unchanged.status, 201, JSON.stringify(unchanged.data));
        board = unchanged.data;
        const duplicated = structuredClone(board);
        duplicated.layout.nodes.push({ ...duplicated.layout.nodes[4], id: randomUUID() });
        assert.equal((await save(duplicated, editor)).status, 404);
        const sources = (await editor('GET', `/projects/${project.id}/board-sources?kind=entities`)).data;
        assert.ok(!JSON.stringify(sources).includes('Private voice reference'));
      },
    );
    await t.test(
      'source filters preserve project and private-media boundaries and search before pagination',
      async () => {
        const path = `/projects/${project.id}/board-sources`;
        for (const [type, name] of [
          ['image', 'image.png'],
          ['video', 'clip.mp4'],
          ['audio', 'sound.wav'],
        ]) {
          const result = await owner('GET', `${path}?kind=media&mediaType=${type}`);
          assert.equal(result.status, 200);
          assert.deepEqual(
            result.data.items.map((item) => item.value.title),
            [name],
          );
          assert.equal(result.data.nextCursor, null);
          const reader = await viewer('GET', `${path}?kind=media&mediaType=${type}`);
          assert.equal(reader.status, 200);
          if (type === 'audio') assert.equal(reader.data.items.length, 0);
        }
        assert.equal((await owner('GET', `${path}?kind=media&mediaType=video&q=image`)).data.items.length, 0);
        assert.equal((await owner('GET', `${path}?kind=media&mediaType=other`)).status, 400);
        assert.equal((await owner('GET', `${path}?kind=entities&mediaType=image`)).status, 400);
        assert.equal((await outsider('GET', `${path}?kind=media&mediaType=image`)).status, 404);
        const searchable = [];
        for (let i = 0; i < 24; i++) {
          const result = await owner(
            'POST',
            `/projects/${project.id}/entities`,
            {
              kind: 'prop',
              body: { name: `Shelf item ${i} / reference`, description: 'Search fixture' },
            },
            { 'Idempotency-Key': randomUUID() },
          );
          assert.equal(result.status, 201, JSON.stringify(result.data));
          searchable.push(result.data);
        }
        const target = searchable.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
        const all = (await owner('GET', `${path}?kind=entities`)).data;
        assert.equal(all.items.length, 20);
        assert.ok(all.nextCursor);
        assert.ok(!all.items.some((item) => item.ref.id === target.id));
        const found = await owner(
          'GET',
          `${path}?kind=entities&q=${encodeURIComponent(target.revision.name)}`,
        );
        assert.deepEqual(
          found.data.items.map((item) => item.ref.id),
          [target.id],
        );
        assert.equal(found.data.nextCursor, null);
      },
    );
    await t.test(
      'library folders scope resources, preserve fixed references and recover conflicts',
      async () => {
        const path = `/projects/${project.id}/library-folders`;
        const key = randomUUID();
        const first = await owner('POST', path, { name: 'References' }, { 'Idempotency-Key': key });
        assert.equal(first.status, 201, JSON.stringify(first.data));
        const folder = first.data;
        assert.equal(
          (await owner('POST', path, { name: 'References' }, { 'Idempotency-Key': key })).data.id,
          folder.id,
        );
        assert.equal(
          (await owner('POST', path, { name: 'Different' }, { 'Idempotency-Key': key })).status,
          409,
        );
        assert.equal(
          (await editor('POST', path, { name: 'references' }, { 'Idempotency-Key': randomUUID() })).status,
          409,
        );
        assert.equal((await viewer('GET', path)).data.length, 1);
        assert.equal(
          (await viewer('POST', path, { name: 'Denied' }, { 'Idempotency-Key': randomUUID() })).status,
          403,
        );
        assert.equal((await outsider('GET', path)).status, 404);
        const movePath = `/projects/${project.id}/library-placement`;
        const ref = { kind: 'media', id: media['image.png'].id };
        const before = (await owner('GET', `/boards/${board.id}`)).data;
        const move = await editor('POST', movePath, { ref, folderId: folder.id, expectedVersion: 0 });
        assert.equal(move.status, 201, JSON.stringify(move.data));
        assert.equal(move.data.version, 1);
        assert.equal(
          (await editor('POST', movePath, { ref, folderId: folder.id, expectedVersion: 0 })).data.version,
          1,
        );
        assert.equal(
          (await editor('POST', movePath, { ref, folderId: null, expectedVersion: 0 })).status,
          409,
        );
        assert.equal(
          (await viewer('POST', movePath, { ref, folderId: null, expectedVersion: 1 })).status,
          403,
        );
        const sources = `/projects/${project.id}/board-sources`;
        const filtered = await owner('GET', `${sources}?kind=media&folderId=${folder.id}`);
        assert.deepEqual(
          filtered.data.items.map((item) => item.ref),
          [ref],
        );
        assert.equal(filtered.data.items[0].placement.version, 1);
        assert.ok(
          !(await owner('GET', `${sources}?kind=media&folderId=root`)).data.items.some(
            (item) => item.ref.id === ref.id,
          ),
        );
        assert.equal(
          (await owner('GET', `${sources}?kind=media&folderId=${folder.id}&mediaType=video`)).data.items
            .length,
          0,
        );
        const allEntities = db()
          .prepare(
            'SELECT e.id, r.id AS current_revision_id FROM asset_entities e JOIN asset_entity_revisions r ON r.entity_id=e.id AND r.version=e.version WHERE e.project_id=? ORDER BY e.id',
          )
          .all(project.id);
        const target = allEntities.at(-1);
        const entityRef = { kind: 'entity', id: target.id, revisionId: target.current_revision_id };
        assert.equal(
          (await owner('POST', movePath, { ref: entityRef, folderId: folder.id, expectedVersion: 0 })).status,
          201,
        );
        assert.deepEqual(
          (await owner('GET', `${sources}?kind=entities&folderId=${folder.id}`)).data.items.map(
            (item) => item.ref,
          ),
          [entityRef],
        );
        const other = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Other library' })
        ).data;
        assert.equal(
          (
            await owner('POST', `/projects/${other.id}/library-placement`, {
              ref,
              folderId: folder.id,
              expectedVersion: 0,
            })
          ).status,
          404,
        );
        assert.equal(
          (await owner('GET', `/projects/${other.id}/board-sources?kind=media&folderId=${folder.id}`)).status,
          400,
        );
        const renamed = await owner('PATCH', `${path}/${folder.id}`, {
          name: 'Selected references',
          expectedVersion: 1,
        });
        assert.equal(renamed.data.version, 2);
        assert.equal((await owner('DELETE', `${path}/${folder.id}`, { expectedVersion: 1 })).status, 409);
        assert.equal((await owner('DELETE', `${path}/${folder.id}`, { expectedVersion: 2 })).status, 200);
        assert.equal((await owner('GET', path)).data.length, 0);
        const restored = (await owner('GET', `${sources}?kind=media&folderId=root`)).data.items.find(
          (item) => item.ref.id === ref.id,
        );
        assert.deepEqual(restored.ref, ref);
        assert.deepEqual(restored.placement, { folderId: null, version: 2 });
        const after = (await owner('GET', `/boards/${board.id}`)).data;
        assert.equal(after.revision, before.revision);
        assert.deepEqual(after.layout, before.layout);
        assert.equal(
          (await owner('GET', restored.value.media.contentUrl.replace('/api/v1', ''))).status,
          200,
        );
        assert.equal(db().pragma('foreign_key_check').length, 0);
      },
    );
    await t.test('workspace library works without any project access and restricts management', async () => {
      const path = `/workspaces/${workspace.id}/public-library`;
      const collected = (
        await owner(
          'POST',
          `/projects/${project.id}/public-library/resources`,
          { mediaVersionId: media['image.png'].id },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      const before = db().prepare('SELECT count(*) AS n FROM projects').get().n;
      const listed = await outsider('GET', `${path}/resources`);
      assert.equal(listed.status, 200, JSON.stringify(listed.data));
      assert.equal(listed.data.items.length, 1);
      assert.equal(listed.data.canManageFolders, false);
      assert.equal(listed.data.items[0].contentUrl, `/api/v1${path}/resources/${collected.id}/content`);
      assert.equal(listed.data.items[0].inProject, false);
      assert.equal((await outsider('GET', `/projects/${project.id}/public-library/resources`)).status, 404);
      assert.equal((await outsider('GET', `/media-versions/${media['image.png'].id}/content`)).status, 404);
      assert.deepEqual(
        (await outsider('GET', `${path}/resources/${collected.id}/content`)).bytes,
        fixtures['image.png'].bytes,
      );
      const partial = await outsider('GET', `${path}/resources/${collected.id}/content`, undefined, {
        Range: 'bytes=0-7',
      });
      assert.equal(partial.status, 206);
      assert.equal(partial.bytes.length, 8);
      assert.equal((await outsider('GET', `${path}/resources/${collected.id}/poster`)).status, 200);
      assert.equal(
        (
          await outsider(
            'POST',
            `${path}/library-folders`,
            { name: 'Denied' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        403,
      );
      assert.equal(
        (await outsider('DELETE', `${path}/resources/${collected.id}`, { expectedVersion: 1 })).status,
        403,
      );
      const key = randomUUID();
      const folder = (
        await owner('POST', `${path}/library-folders`, { name: 'Workspace only' }, { 'Idempotency-Key': key })
      ).data;
      assert.equal(
        (
          await owner(
            'POST',
            `${path}/library-folders`,
            { name: 'Workspace only' },
            { 'Idempotency-Key': key },
          )
        ).data.id,
        folder.id,
      );
      assert.equal(
        (
          await owner('PATCH', `${path}/library-folders/${folder.id}`, {
            name: 'Team shelf',
            expectedVersion: 1,
          })
        ).data.version,
        2,
      );
      assert.equal((await outsider('GET', `${path}/library-folders`)).data[0].name, 'Team shelf');
      assert.equal(
        (
          await owner('PATCH', `${path}/resources/${collected.id}`, {
            folderId: folder.id,
            expectedVersion: 1,
          })
        ).data.version,
        2,
      );
      assert.equal(
        (await outsider('GET', `${path}/resources?folderId=${folder.id}&q=image&mediaType=image`)).data.items
          .length,
        1,
      );
      assert.equal(
        (await outsider('GET', `${path}/resources?folderId=${folder.id}&mediaType=video`)).data.items.length,
        0,
      );
      assert.equal(
        (await owner('DELETE', `${path}/library-folders/${folder.id}`, { expectedVersion: 1 })).status,
        409,
      );
      assert.equal(
        (await owner('DELETE', `${path}/library-folders/${folder.id}`, { expectedVersion: 2 })).status,
        200,
      );
      assert.equal(
        (await owner('DELETE', `${path}/resources/${collected.id}`, { expectedVersion: 2 })).status,
        409,
      );
      assert.equal(
        (await owner('DELETE', `${path}/resources/${collected.id}`, { expectedVersion: 3 })).status,
        200,
      );
      assert.equal((await outsider('GET', `${path}/resources/${collected.id}/content`)).status, 404);
      assert.equal(db().prepare('SELECT count(*) AS n FROM projects').get().n, before);
      const emptyWorkspace = (await owner('POST', '/workspaces', { name: 'Empty public library' })).data;
      assert.deepEqual(
        (await owner('GET', `/workspaces/${emptyWorkspace.id}/public-library/resources`)).data.items,
        [],
      );
      assert.equal(
        (await outsider('GET', `/workspaces/${emptyWorkspace.id}/public-library/resources`)).status,
        404,
      );
      assert.equal(
        (
          await owner(
            'GET',
            `/workspaces/${emptyWorkspace.id}/public-library/resources/${collected.id}/content`,
          )
        ).status,
        404,
      );
      assert.equal(
        (
          await owner(
            'POST',
            `/workspaces/${emptyWorkspace.id}/public-library/library-folders`,
            { name: 'Empty team folder' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        201,
      );
    });
    await t.test(
      'public library imports fixed versions without opening private source projects',
      async () => {
        const path = `/projects/${project.id}/public-library`;
        const target = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Library destination' })
        ).data;
        await owner('POST', `/projects/${target.id}/members`, {
          userId: (await outsider('GET', '/auth/me')).data.user.id,
          role: 'EDITOR',
        });
        await owner('POST', `/projects/${target.id}/members`, { userId: viewerId, role: 'VIEWER' });
        const destination = `/projects/${target.id}/public-library`;
        const folder = (
          await owner(
            'POST',
            `${path}/library-folders`,
            { name: 'Team references' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const key = randomUUID();
        const published = await owner(
          'POST',
          `${path}/resources`,
          { mediaVersionId: media['image.png'].id, folderId: folder.id },
          { 'Idempotency-Key': key },
        );
        assert.equal(published.status, 201, JSON.stringify(published.data));
        const id = published.data.id;
        assert.equal(
          (
            await owner(
              'POST',
              `${path}/resources`,
              { mediaVersionId: media['image.png'].id, folderId: folder.id },
              { 'Idempotency-Key': key },
            )
          ).data.id,
          id,
        );
        assert.equal(
          (
            await owner(
              'POST',
              `${path}/resources`,
              { mediaVersionId: media['clip.mp4'].id },
              { 'Idempotency-Key': key },
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await owner(
              'POST',
              `${path}/resources`,
              { mediaVersionId: media['sound.wav'].id },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await viewer(
              'POST',
              `${path}/resources`,
              { mediaVersionId: media['image.png'].id },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          403,
        );
        assert.equal(
          (await outsider('GET', `${destination}/resources?folderId=${folder.id}&mediaType=video`)).data.items
            .length,
          0,
        );
        const listed = (await outsider('GET', `${destination}/resources?folderId=${folder.id}&q=image`)).data;
        assert.equal(listed.items.length, 1);
        assert.equal(listed.items[0].canManage, false);
        assert.equal(listed.items[0].sourceProjectId, undefined);
        assert.equal((await outsider('GET', `/media-versions/${media['image.png'].id}/content`)).status, 404);
        assert.deepEqual(
          (await outsider('GET', `${destination}/resources/${id}/content`)).bytes,
          fixtures['image.png'].bytes,
        );
        const partial = await outsider('GET', `${destination}/resources/${id}/content`, undefined, {
          Range: 'bytes=0-7',
        });
        assert.equal(partial.status, 206);
        assert.equal(partial.bytes.length, 8);
        const importKey = randomUUID();
        const imported = await outsider('POST', `${destination}/resources/${id}/import`, undefined, {
          'Idempotency-Key': importKey,
        });
        assert.equal(imported.status, 201, JSON.stringify(imported.data));
        assert.equal(imported.data.origin, 'workspace_library');
        assert.equal(imported.data.librarySource.resourceId, id);
        assert.equal(imported.data.projectId, target.id);
        assert.notEqual(imported.data.id, media['image.png'].id);
        assert.equal(imported.data.sha256, media['image.png'].sha256);
        assert.equal(
          (
            await outsider('POST', `${destination}/resources/${id}/import`, undefined, {
              'Idempotency-Key': importKey,
            })
          ).data.id,
          imported.data.id,
        );
        assert.equal(
          (
            await viewer('POST', `${destination}/resources/${id}/import`, undefined, {
              'Idempotency-Key': randomUUID(),
            })
          ).status,
          403,
        );
        assert.equal(
          (await outsider('DELETE', `${destination}/resources/${id}`, { expectedVersion: 1 })).status,
          403,
        );
        assert.equal(
          (
            await outsider(
              'POST',
              `${destination}/library-folders`,
              { name: 'Denied' },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          403,
        );
        assert.equal(
          (await owner('DELETE', `${path}/library-folders/${folder.id}`, { expectedVersion: 1 })).status,
          200,
        );
        assert.equal(
          (await outsider('GET', `${destination}/resources?folderId=root`)).data.items[0].version,
          2,
        );
        assert.equal((await owner('DELETE', `${path}/resources/${id}`, { expectedVersion: 1 })).status, 409);
        assert.equal((await owner('DELETE', `${path}/resources/${id}`, { expectedVersion: 2 })).status, 200);
        assert.equal((await outsider('GET', `${destination}/resources/${id}/content`)).status, 404);
        assert.equal(
          (
            await outsider('POST', `${destination}/resources/${id}/import`, undefined, {
              'Idempotency-Key': randomUUID(),
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await outsider('POST', `${destination}/resources/${id}/import`, undefined, {
              'Idempotency-Key': importKey,
            })
          ).data.id,
          imported.data.id,
        );
        assert.deepEqual(
          (await outsider('GET', `/media-versions/${imported.data.id}/content`)).bytes,
          fixtures['image.png'].bytes,
        );
        const otherWorkspace = (await owner('POST', '/workspaces', { name: 'Other team' })).data;
        const foreign = (
          await owner('POST', '/projects', { workspaceId: otherWorkspace.id, title: 'Other team film' })
        ).data;
        const clip = (
          await owner(
            'POST',
            `${path}/resources`,
            { mediaVersionId: media['clip.mp4'].id },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        assert.equal(
          (await owner('GET', `/projects/${foreign.id}/public-library/resources`)).data.items.length,
          0,
        );
        assert.equal(
          (await owner('GET', `/projects/${foreign.id}/public-library/resources/${clip.id}/content`)).status,
          404,
        );
        assert.equal(
          (
            await owner(
              'POST',
              `/projects/${foreign.id}/public-library/resources/${clip.id}/import`,
              undefined,
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          404,
        );
        const video = await outsider('POST', `${destination}/resources/${clip.id}/import`, undefined, {
          'Idempotency-Key': randomUUID(),
        });
        assert.equal(video.status, 201, JSON.stringify(video.data));
        assert.equal(video.data.mediaType, 'video');
        assert.deepEqual(
          (await outsider('GET', `/media-versions/${video.data.id}/content`)).bytes,
          fixtures['clip.mp4'].bytes,
        );
        const audioIntent = (
          await owner(
            'POST',
            `/projects/${project.id}/media-uploads`,
            { fileName: 'shared-audio.wav', byteLength: fixtures['sound.wav'].bytes.length },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const audio = (
          await owner('PUT', `/media-uploads/${audioIntent.id}/content`, fixtures['sound.wav'].bytes)
        ).data.mediaVersion;
        const publicAudio = (
          await owner(
            'POST',
            `${path}/resources`,
            { mediaVersionId: audio.id },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const sound = await outsider('POST', `${destination}/resources/${publicAudio.id}/import`, undefined, {
          'Idempotency-Key': randomUUID(),
        });
        assert.equal(sound.status, 201, JSON.stringify(sound.data));
        assert.equal(sound.data.mediaType, 'audio');
        assert.deepEqual(
          (await outsider('GET', `/media-versions/${sound.data.id}/content`)).bytes,
          fixtures['sound.wav'].bytes,
        );
        await owner(
          'POST',
          `/projects/${project.id}/entities`,
          {
            kind: 'voice',
            body: {
              name: 'Newly protected sample',
              media: [{ role: 'voice_sample', mediaVersionId: audio.id }],
            },
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(
          (await outsider('GET', `${destination}/resources/${publicAudio.id}/content`)).status,
          403,
        );
        assert.ok(
          !(await outsider('GET', `${destination}/resources`)).data.items.some(
            (item) => item.id === publicAudio.id,
          ),
        );
        assert.throws(
          () => db().exec('UPDATE workspace_media_imports SET resource_id=resource_id'),
          /immutable/,
        );
        assert.throws(() => db().exec('DELETE FROM workspace_media_resources'), /softly/);
        const { MediaProbe } = await import('../dist/assets/media-probe.js');
        const probe = app.get(MediaProbe),
          inspect = probe.inspect.bind(probe);
        probe.inspect = async (...args) => {
          const details = await inspect(...args);
          db()
            .prepare('UPDATE workspace_media_resources SET removed_at=? WHERE id=?')
            .run(new Date().toISOString(), clip.id);
          return details;
        };
        try {
          const interrupted = await outsider(
            'POST',
            `${destination}/resources/${clip.id}/import`,
            undefined,
            { 'Idempotency-Key': randomUUID() },
          );
          assert.equal(interrupted.status, 404, JSON.stringify(interrupted.data));
          const pending = db()
            .prepare(
              "SELECT i.upload_id FROM workspace_media_imports i JOIN media_uploads u ON u.id=i.upload_id WHERE i.resource_id=? AND i.project_id=? AND u.state<>'complete'",
            )
            .get(clip.id, target.id);
          assert.equal((await outsider('POST', `/media-uploads/${pending.upload_id}/reconcile`)).status, 404);
          assert.equal(
            db().prepare('SELECT count(*) AS n FROM media_versions WHERE project_id=?').get(target.id).n,
            3,
          );
        } finally {
          probe.inspect = inspect;
        }
        assert.equal(db().pragma('foreign_key_check').length, 0);
      },
    );
    await t.test('public folder and name filters apply before pagination', async () => {
      const path = `/projects/${project.id}/public-library`;
      const folder = (
        await owner(
          'POST',
          `${path}/library-folders`,
          { name: 'Paged library' },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      const published = [];
      for (let index = 0; index < 21; index++) {
        const fileName = `public-reference-${index}.png`;
        const upload = (
          await owner(
            'POST',
            `/projects/${project.id}/media-uploads`,
            { fileName, byteLength: fixtures['image.png'].bytes.length },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const media = (await owner('PUT', `/media-uploads/${upload.id}/content`, fixtures['image.png'].bytes))
          .data.mediaVersion;
        const result = await owner(
          'POST',
          `${path}/resources`,
          { mediaVersionId: media.id, folderId: folder.id },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(result.status, 201, JSON.stringify(result.data));
        published.push({ id: result.data.id, fileName });
      }
      const first = (await owner('GET', `${path}/resources?folderId=${folder.id}`)).data;
      assert.equal(first.items.length, 20);
      assert.ok(first.nextCursor);
      const second = (
        await owner('GET', `${path}/resources?folderId=${folder.id}&cursor=${first.nextCursor}`)
      ).data;
      assert.equal(second.items.length, 1);
      assert.equal(second.nextCursor, null);
      const last = published.sort((a, b) => a.id.localeCompare(b.id)).at(-1);
      assert.ok(!first.items.some((item) => item.id === last.id));
      const found = (
        await owner('GET', `${path}/resources?folderId=${folder.id}&q=${last.fileName}&mediaType=image`)
      ).data;
      assert.deepEqual(
        found.items.map((item) => item.id),
        [last.id],
      );
      assert.equal(found.nextCursor, null);
      assert.equal(
        (await owner('GET', `${path}/resources?folderId=${folder.id}&mediaType=audio`)).data.items.length,
        0,
      );
    });
    await t.test(
      'stale writers get 409 and response-loss replays retain the exact saved revision',
      async () => {
        const old = structuredClone(board),
          other = structuredClone(board);
        old.title = 'Owner change';
        other.title = 'Artist change';
        const results = await Promise.all([save(old), save(other, editor)]);
        assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
        board = results.find((result) => result.status === 201).data;
        const key = randomUUID(),
          value = structuredClone(board);
        value.title = 'Recover response';
        const saved = await save(value, owner, key);
        assert.equal(saved.status, 201);
        const advanced = await save({ ...saved.data, title: 'Head after recovered response' });
        assert.equal(advanced.status, 201);
        assert.equal((await save(value, owner, key)).data.revision, saved.data.revision);
        assert.equal((await owner('GET', `/boards/${board.id}`)).data.revision, advanced.data.revision);
        assert.equal(
          (await save({ ...value, title: 'Different' }, owner, key)).data.code,
          'IDEMPOTENCY_CONFLICT',
        );
        board = advanced.data;
        assert.equal((await save(old)).data.code, 'BOARD_VERSION_CONFLICT');
        assert.equal((await save(board, viewer)).status, 403);
        assert.throws(() => db().exec('UPDATE board_revisions SET title=title'), /immutable/);
        assert.throws(() => db().exec('DELETE FROM board_revisions'), /immutable/);
        assert.throws(() => db().exec('UPDATE boards SET version=version+1'), /head/);
      },
    );
    await t.test(
      'forged references, duplicate edges, groups, URLs and oversized layouts are rejected',
      async () => {
        const invalid = [
          (value) => value.layout.nodes.push(node({ kind: 'media', id: randomUUID() })),
          (value) => (value.layout.nodes[0].data.ref.version = 999),
          (value) => (value.layout.nodes[0].data.contentUrl = 'https://example.com/private'),
          (value) => (value.layout.nodes[0].data.ref.baseUrl = 'http://example.com'),
          (value) => value.layout.nodes.push(value.layout.nodes[0]),
          (value) =>
            value.layout.edges.push({
              id: randomUUID(),
              source: value.layout.nodes[0].id,
              target: randomUUID(),
            }),
          (value) => (value.layout.nodes[0].parentId = value.layout.nodes[0].id),
          (value) => (value.layout.nodes[0].position.x = 1000000),
          (value) => value.layout.nodes.push(...Array.from({ length: 101 }, () => node(null, 'note'))),
          (value) =>
            value.layout.nodes.push(
              ...Array.from({ length: 80 }, () => ({
                ...node(null, 'note'),
                data: { text: '旁白'.repeat(2000) },
              })),
            ),
        ];
        for (const [index, mutate] of invalid.entries()) {
          const copy = structuredClone(board);
          mutate(copy);
          const result = await save(copy);
          assert.ok([400, 404, 413].includes(result.status), JSON.stringify({ index, result }));
        }
        const other = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Foreign media project' })
        ).data;
        const intent = (
          await owner(
            'POST',
            `/projects/${other.id}/media-uploads`,
            { fileName: 'image.png', byteLength: fixtures['image.png'].bytes.length },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const foreign = (
          await owner('PUT', `/media-uploads/${intent.id}/content`, fixtures['image.png'].bytes)
        ).data.mediaVersion;
        const copy = structuredClone(board);
        copy.layout.nodes.push(node({ kind: 'media', id: foreign.id }));
        assert.equal((await save(copy)).status, 404);
        const grouped = structuredClone(board),
          group = node(null, 'group');
        grouped.layout.nodes.unshift(group);
        grouped.layout.nodes[1].parentId = group.id;
        group.data.collapsed = true;
        const result = await save(grouped);
        assert.equal(result.status, 201, JSON.stringify(result.data));
        board = result.data;
        assert.equal(board.layout.nodes[0].data.collapsed, true);
      },
    );
    await t.test('new source versions and approval revocation never switch pinned revisions', async () => {
      const fixed = board.layout.nodes.find((n) => n.data.ref?.kind === 'shot');
      const card = (await owner('GET', `/shots/${shot.id}/card/editor`)).data;
      card.body.description = 'Updated workbench description';
      await owner('PATCH', `/shots/${shot.id}/card`, { expectedVersion: shot.version, body: card.body });
      const refreshed = (await owner('GET', `/boards/${board.id}`)).data;
      assert.equal(refreshed.resolved[fixed.id].status, 'stale');
      assert.equal(refreshed.resolved[fixed.id].summary, shot.description);
      const history = (await owner('GET', `/boards/${board.id}/revisions`)).data;
      assert.ok(history.items.length >= 4);
      const old = (await owner('GET', `/boards/${board.id}?revision=1`)).data;
      assert.equal(old.layout.nodes.length, 0);
      assert.ok(old.headRevision > 1);
      const sources = (await owner('GET', `/projects/${project.id}/board-sources?kind=shots&q=SH`)).data;
      assert.equal(sources.items.find((item) => item.ref.id === shot.id).ref.version, shot.version + 1);
      const entity = entities[0],
        endpoint = `/entities/${entity.id}/revisions/${entity.revision.version}/decisions`;
      const first = await owner(
        'POST',
        endpoint,
        { action: 'approve', expectedDecisionVersion: 0, reason: 'Approved reference' },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal(first.status, 201, JSON.stringify(first.data));
      assert.equal(
        (
          await owner(
            'POST',
            endpoint,
            { action: 'revoke', expectedDecisionVersion: 1, reason: 'Revoked exact reference' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        201,
      );
      const updated = (await owner('GET', `/boards/${board.id}`)).data;
      const reference = updated.layout.nodes.find((n) => n.data.ref?.id === entity.id);
      assert.equal(updated.resolved[reference.id].status, 'revoked');
    });
    await t.test('audit errors roll back head and history together', async () => {
      const count = db().prepare('SELECT count(*) n FROM board_revisions').get().n;
      db().exec(
        "CREATE TRIGGER board_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='board.save' BEGIN SELECT RAISE(ABORT,'fixture'); END",
      );
      try {
        assert.equal((await save(board)).status, 409);
        assert.equal(db().prepare('SELECT count(*) n FROM board_revisions').get().n, count);
      } finally {
        db().exec('DROP TRIGGER board_audit_failure');
      }
    });
    await t.test(
      'batch resolution rechecks permissions, missing files and immutable entity/media versions',
      async () => {
        const ref = board.layout.nodes.find((n) => n.data.ref?.id === entities[1].id);
        const entity = entities[1];
        const revised = await owner(
          'POST',
          `/entities/${entity.id}/revisions`,
          {
            expectedVersion: entity.revision.version,
            body: {
              name: 'Revised environment',
              description: 'New environment',
              media: [{ role: 'reference', mediaVersionId: media['image.png'].id }],
            },
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(revised.status, 201, JSON.stringify(revised.data));
        const resolved = await owner('POST', `/projects/${project.id}/board-references/resolve`, {
          references: [
            { nodeId: ref.id, ref: ref.data.ref },
            { nodeId: randomUUID(), ref: { kind: 'media', id: randomUUID() } },
          ],
        });
        assert.equal(resolved.status, 201);
        assert.equal(resolved.data[ref.id].status, 'stale');
        assert.equal(resolved.data[ref.id].title, entity.revision.name);
        assert.ok(
          Object.values(resolved.data).some(
            (value) => value.status === 'unavailable' && Object.keys(value).length === 2,
          ),
        );
        assert.equal(
          (await outsider('POST', `/projects/${project.id}/board-references/resolve`, { references: [] }))
            .status,
          404,
        );
        const sample = board.layout.nodes.find((n) => n.data.ref?.id === entities[3].id);
        const protectedValue = (
          await editor('POST', `/projects/${project.id}/board-references/resolve`, {
            references: [{ nodeId: sample.id, ref: sample.data.ref }],
          })
        ).data[sample.id];
        assert.deepEqual(protectedValue, { status: 'unavailable', title: '引用不可用' });
        const row = db()
          .prepare('SELECT object_key FROM media_versions WHERE id=?')
          .get(media['clip.mp4'].id);
        const path = join(process.env.MEDIA_ROOT, ...row.object_key.split('/')),
          held = path + '.test-held';
        await rename(path, held);
        try {
          const missing = await owner('GET', media['clip.mp4'].contentUrl.replace('/api/v1', ''));
          assert.ok([404, 503].includes(missing.status), JSON.stringify(missing));
          const stable = (await owner('GET', `/boards/${board.id}`)).data;
          assert.equal(
            stable.layout.nodes.find((n) => n.data.ref?.kind === 'media').data.ref.id,
            media['clip.mp4'].id,
          );
        } finally {
          await rename(held, path);
        }
        assert.equal((await owner('GET', media['clip.mp4'].contentUrl.replace('/api/v1', ''))).status, 200);
        // Many revisions exercise the independent history cursor without modifying production cards.
        let head = (await owner('GET', `/boards/${board.id}`)).data;
        for (let index = 0; index < 21; index++) {
          const result = await save({ ...head, title: `Revision ${index}` });
          assert.equal(result.status, 201);
          head = result.data;
        }
        const page = (await owner('GET', `/boards/${board.id}/revisions`)).data;
        const next = (await owner('GET', `/boards/${board.id}/revisions?before=${page.nextCursor}`)).data;
        assert.equal(page.items.length, 20);
        assert.ok(next.items.length);
        assert.equal(
          new Set([...page.items, ...next.items].map((item) => item.revision)).size,
          page.items.length + next.items.length,
        );
        board = head;
      },
    );
    await t.test(
      'pagination, independent backup and process restart preserve layouts and old business rows',
      async () => {
        for (let i = 0; i < 21; i++) assert.equal((await create(`Board ${i}`)).status, 201);
        const first = (await owner('GET', `/projects/${project.id}/boards`)).data;
        const next = (await owner('GET', `/projects/${project.id}/boards?cursor=${first.nextCursor}`)).data;
        assert.equal(first.items.length, 20);
        assert.equal(
          new Set([...first.items, ...next.items].map((row) => row.id)).size,
          first.items.length + next.items.length,
        );
        const before = (await owner('GET', `/boards/${board.id}`)).data;
        const { backupDatabase } = await import('../dist/db/backup.js');
        const backup = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backup'));
        const restored = join(directory, 'restored.sqlite');
        await copyFile(backup, restored);
        const copy = new DatabaseService({ databasePath: restored });
        try {
          assert.equal(copy.sqlite.pragma('integrity_check', { simple: true }), 'ok');
          assert.deepEqual(copy.sqlite.pragma('foreign_key_check'), []);
          for (const table of ['boards', 'board_revisions'])
            assert.deepEqual(
              copy.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
              db().prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
            );
        } finally {
          copy.onModuleDestroy();
        }
        await app.close();
        await start();
        assert.deepEqual((await owner('GET', `/boards/${board.id}`)).data, before);
        assert.equal((await owner('GET', media['image.png'].contentUrl.replace('/api/v1', ''))).status, 200);
      },
    );
    await t.test('membership and project trash revoke historical and current board reads', async () => {
      await owner('DELETE', `/projects/${project.id}/members/${viewerId}`, { expectedRole: 'VIEWER' });
      assert.equal((await viewer('GET', `/boards/${board.id}`)).status, 404);
      assert.equal((await viewer('GET', `/boards/${board.id}?revision=1`)).status, 404);
      await owner('POST', `/projects/${project.id}/trash`, { expectedVersion: project.version });
      assert.equal((await owner('GET', `/boards/${board.id}`)).status, 404);
      assert.equal((await editor('GET', `/projects/${project.id}/boards`)).status, 404);
    });
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
