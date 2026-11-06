import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import { startComfyMock, fixtureI2V, fixtureWorkflow } from '../../../tests/fixtures/comfy-mock.mjs';

test('saved canvas nodes execute typed fixed inputs through the existing generation queue', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-board-execution-'));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.COOKIE_SECURE = 'false';
  process.env.SETUP_TOKEN = 'isolated-board-execution-setup-token-2026';
  process.env.PROVIDER_MASTER_KEY = 'c'.repeat(64);
  const { createApplication } = await import('../dist/application.js'),
    { DatabaseService } = await import('../dist/db/database.service.js'),
    { AppConfig } = await import('../dist/config.js'),
    { GenerationWorker } = await import('../dist/generation/generation-worker.js');
  let app, base, remote, project, workspace, board, image, workflow, viewerId, queued;
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  function client() {
    let cookie = '',
      csrf = '';
    return async (method, path, body, key = randomUUID()) => {
      const binary = Buffer.isBuffer(body),
        res = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            Cookie: cookie,
            'X-Studio-Request': '1',
            'X-CSRF-Token': csrf,
            'Content-Type': binary ? 'application/octet-stream' : 'application/json',
            'Idempotency-Key': key,
          },
          body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
        });
      if (res.headers.getSetCookie().length)
        cookie = res.headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .join('; ');
      const data = await res.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: res.status, data };
    };
  }
  const owner = client(),
    viewer = client(),
    db = () => app.get(DatabaseService).sqlite;
  const node = (type, data) => ({
    id: randomUUID(),
    type,
    data,
    position: { x: 0, y: 0 },
    width: 250,
    height: 280,
  });
  let textNode, imageNode, genNode, layout;
  const save = (value = layout, key = randomUUID()) =>
    owner(
      'POST',
      `/boards/${board.id}/revisions`,
      { title: board.title, expectedRevision: board.revision, layout: value },
      key,
    );
  const path = () => `/boards/${board.id}/nodes/${genNode.id}/generation-jobs`;
  const run = (key = randomUUID(), revision = board.revision, actor = owner, extra = {}) =>
    actor('POST', path(), { expectedRevision: revision, confirmed: true, ...extra }, key);
  try {
    const fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    remote = await startComfyMock({
      'image.png': fixtures['image.png'].bytes,
      'clip.mp4': fixtures['clip.mp4'].bytes,
    });
    await start();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@boardexec.test',
        password: 'Studio8!',
        name: 'Creator',
        workspaceName: 'Board team',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'A station study' }))
      .data;
    const invite = (
      await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: 'viewer@boardexec.test' })
    ).data;
    viewerId = (
      await viewer('POST', '/invitations/accept', {
        token: invite.token,
        name: 'Viewer',
        password: 'Studio8!',
      })
    ).data.user.id;
    await owner('POST', `/projects/${project.id}/members`, { userId: viewerId, role: 'VIEWER' });
    const upload = (
      await owner('POST', `/projects/${project.id}/media-uploads`, {
        fileName: 'image.png',
        byteLength: fixtures['image.png'].bytes.length,
      })
    ).data;
    image = (await owner('PUT', `/media-uploads/${upload.id}/content`, fixtures['image.png'].bytes)).data
      .mediaVersion;
    const connection = (
      await owner('POST', `/projects/${project.id}/generation-connections`, {
        name: 'Fixture',
        baseUrl: remote.baseUrl,
        trustedPrivate: true,
      })
    ).data;
    workflow = (
      await owner('POST', `/projects/${project.id}/generation-workflows`, fixtureI2V(connection.id))
    ).data;
    board = (await owner('POST', `/projects/${project.id}/boards`, { title: 'Station board' })).data;
    textNode = node('note', {
      text: 'A slow dolly across a station',
      prompt: { negativePrompt: 'no lettering', source: 'External notes' },
    });
    imageNode = node('reference', { ref: { kind: 'media', id: image.id } });
    genNode = node('generation', { generation: { workflowId: workflow.id } });
    layout = {
      ...board.layout,
      nodes: [textNode, imageNode, genNode],
      edges: [
        {
          id: randomUUID(),
          source: textNode.id,
          target: genNode.id,
          kind: 'input_binding',
          sourcePort: 'text',
          targetPort: 'prompt',
        },
        {
          id: randomUUID(),
          source: imageNode.id,
          target: genNode.id,
          kind: 'input_binding',
          sourcePort: 'image',
          targetPort: 'first_frame',
        },
      ],
    };
    await t.test(
      'v1 extension rejects mismatched, duplicate, forged and unbounded execution links',
      async () => {
        for (const mutate of [
          (l) => {
            l.edges[0].sourcePort = 'image';
          },
          (l) => {
            l.edges.push({ ...l.edges[0], id: randomUUID() });
          },
          (l) => {
            l.edges[0].source = genNode.id;
          },
          (l) => {
            l.edges[0].target = randomUUID();
          },
          (l) => {
            l.edges[0].kind = 'annotation';
          },
          (l) => {
            l.nodes.push(node('result', { jobId: randomUUID() }));
          },
          (l) => {
            l.nodes[2].data.generation.endpoint = 'http://forbidden';
          },
        ]) {
          const invalid = structuredClone(layout);
          mutate(invalid);
          assert.equal((await save(invalid)).status, 400);
        }
        const result = await save();
        assert.equal(result.status, 201, JSON.stringify(result.data));
        board = result.data;
        assert.equal(board.layout.schemaVersion, 'studio.board.v1');
        assert.equal(db().prepare('SELECT count(*) n FROM generation_jobs').get().n, 0);
        const annotation = structuredClone(layout);
        annotation.edges = annotation.edges.map(({ id, source, target }) => ({ id, source, target }));
        const other = (await owner('POST', `/projects/${project.id}/boards`, { title: 'Old annotation' }))
          .data;
        assert.equal(
          (
            await owner('POST', `/boards/${other.id}/revisions`, {
              title: other.title,
              expectedRevision: 1,
              layout: annotation,
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await owner('POST', `/boards/${other.id}/nodes/${genNode.id}/generation-jobs`, {
              expectedRevision: 2,
              confirmed: true,
            })
          ).data.code,
          'BOARD_GENERATION_INCOMPLETE',
        );
      },
    );
    await t.test('execution freezes actual sources and replay survives later canvas edits', async () => {
      assert.equal((await run(randomUUID(), board.revision - 1)).status, 409);
      assert.equal((await run(randomUUID(), board.revision, viewer)).status, 403);
      const key = randomUUID(),
        result = await run(key);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      queued = result.data;
      assert.equal(queued.shotId, null);
      assert.equal(queued.image.id, image.id);
      assert.equal(queued.boardExecution.revision, board.revision);
      assert.equal(queued.boardExecution.nodeId, genNode.id);
      assert.equal(queued.boardExecution.requestHash, undefined);
      assert.equal(queued.prompt.positivePrompt, textNode.data.text);
      layout.nodes[0].data.text = 'A changed station';
      board = (await save()).data;
      const replay = await run(key, queued.boardExecution.revision);
      assert.equal(replay.status, 201);
      assert.equal(replay.data.id, queued.id);
      assert.equal((await run(key)).status, 409);
      assert.equal(db().prepare('SELECT count(*) n FROM generation_jobs').get().n, 1);
      assert.equal(
        JSON.parse(
          db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(queued.id).snapshot_json,
        ).graph['1'].inputs.text,
        'A slow dolly across a station',
      );
      assert.equal(
        (
          await owner('POST', `/projects/${project.id}/generation-jobs`, {
            workflowId: workflow.id,
            positivePrompt: 'x',
            boardExecution: { nodeId: genNode.id },
            confirmed: true,
          })
        ).status,
        400,
      );
    });
    await t.test(
      'the existing worker uploads one image and archives the exact fixed video result',
      async () => {
        await app.get(GenerationWorker).tick();
        assert.equal(remote.mock.submissions.length, 1);
        assert.deepEqual(remote.mock.uploads[0].bytes, fixtures['image.png'].bytes);
        assert.equal(remote.mock.submissions[0].prompt['1'].inputs.text, 'A slow dolly across a station');
        assert.equal(remote.mock.submissions[0].prompt['2'].inputs.text, 'no lettering');
        assert.equal(remote.mock.submissions[0].prompt['4'].inputs.image, `pullet-studio/${queued.id}.png`);
        await app.get(GenerationWorker).tick();
        await app.get(GenerationWorker).tick();
        queued = (await owner('GET', `/generation-jobs/${queued.id}`)).data;
        assert.equal(queued.state, 'completed');
        assert.equal(queued.inLibrary, false);
        const resultNode = { ...node('result', { jobId: queued.id }), id: queued.id };
        layout.nodes.push(resultNode);
        board = (await save()).data;
        assert.equal(board.resolved[queued.id].media.id, queued.mediaVersionId);
        assert.equal(board.resolved[queued.id].media.mediaType, 'video');
        const invalid = structuredClone(layout);
        invalid.edges[1].source = queued.id;
        assert.equal((await save(invalid)).status, 201);
        const oldBoard = board;
        board = (await owner('GET', `/boards/${board.id}`)).data;
        assert.equal((await run()).data.code, 'REFERENCE_IMAGE_INVALID');
        board = oldBoard;
        layout.edges[1].source = imageNode.id;
        board = (await owner('GET', `/boards/${board.id}`)).data;
        board = (await save()).data;
        assert.equal(db().prepare('SELECT count(*) n FROM shots').get().n, 0);
        assert.equal(db().prepare('SELECT count(*) n FROM takes').get().n, 0);
      },
    );
    await t.test('foreign workflows, results and sources cannot bypass project permissions', async () => {
      const foreign = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Private' }))
          .data,
        otherWorkflow = (
          await owner('POST', `/projects/${foreign.id}/generation-workflows`, fixtureWorkflow(connection.id))
        ).data;
      const bad = structuredClone(layout);
      bad.nodes[2].data.generation.workflowId = otherWorkflow.id;
      assert.equal((await save(bad)).status, 404);
      const foreignBoard = (await owner('POST', `/projects/${foreign.id}/boards`, { title: 'Foreign' })).data;
      const badResult = {
        ...foreignBoard.layout,
        nodes: [{ ...node('result', { jobId: queued.id }), id: queued.id }],
      };
      assert.equal(
        (
          await owner('POST', `/boards/${foreignBoard.id}/revisions`, {
            title: foreignBoard.title,
            expectedRevision: 1,
            layout: badResult,
          })
        ).status,
        404,
      );
      assert.equal((await viewer('GET', path())).data.items[0].id, queued.id);
      assert.equal(
        (await owner('GET', `/boards/${board.id}/nodes/${randomUUID()}/generation-jobs`)).data.items.length,
        0,
      );
      const missing = structuredClone(layout);
      missing.edges = missing.edges.filter((e) => e.targetPort !== 'first_frame');
      board = (await save(missing)).data;
      assert.equal((await run()).data.code, 'REFERENCE_IMAGE_REQUIRED');
      board = (await save()).data;
    });
    await t.test(
      'audit failure rolls back the reused job and history survives restart and backup',
      async () => {
        db().exec(
          "CREATE TRIGGER fail_board_job BEFORE INSERT ON audit_events WHEN NEW.action='generation.job.queue' BEGIN SELECT RAISE(ABORT,'fixture'); END",
        );
        const before = db().prepare('SELECT count(*) n FROM generation_jobs').get().n,
          failed = await run();
        assert.equal(failed.status, 409, JSON.stringify(failed));
        assert.equal(db().prepare('SELECT count(*) n FROM generation_jobs').get().n, before);
        db().exec('DROP TRIGGER fail_board_job');
        await app.close();
        await start();
        const list = (await owner('GET', path())).data;
        assert.equal(list.items[0].id, queued.id);
        assert.equal(list.items[0].boardExecution.revision, 2);
        const { backupDatabase } = await import('../dist/db/backup.js'),
          backup = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backup')),
          restored = new DatabaseService({ databasePath: backup });
        try {
          assert.equal(
            JSON.parse(
              restored.sqlite.prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(queued.id)
                .snapshot_json,
            ).boardExecution.nodeId,
            genNode.id,
          );
          assert.deepEqual(restored.sqlite.pragma('foreign_key_check'), []);
        } finally {
          restored.onModuleDestroy();
        }
        await owner('DELETE', `/projects/${project.id}/members/${viewerId}`, { expectedRole: 'VIEWER' });
        assert.equal((await viewer('GET', path())).status, 404);
        await owner('POST', `/projects/${project.id}/trash`, { expectedVersion: project.version });
        assert.equal((await owner('GET', path())).status, 404);
        assert.equal((await run()).status, 404);
      },
    );
  } finally {
    await app?.close();
    await remote?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
