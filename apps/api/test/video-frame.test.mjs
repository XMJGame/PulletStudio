import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import { startComfyMock, fixtureWorkflow } from '../../../tests/fixtures/comfy-mock.mjs';

test('video frame extraction saves reviewed pixels through recoverable scoped media uploads', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pullet-frame-test-'));
  assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
  Object.assign(process.env, {
    DATABASE_PATH: join(dir, 'studio.sqlite'),
    MEDIA_ROOT: join(dir, 'media'),
    COOKIE_SECURE: 'false',
    SETUP_TOKEN: 'isolated-video-frame-fixture-token-2026',
    PROVIDER_MASTER_KEY: '7'.repeat(64),
  });
  const { createApplication } = await import('../dist/application.js'),
    { AppConfig } = await import('../dist/config.js'),
    { DatabaseService } = await import('../dist/db/database.service.js');
  const { VideoFrameService } = await import('../dist/assets/video-frame.service.js'),
    { MediaService } = await import('../dist/assets/media.service.js'),
    { LocalStorage } = await import('../dist/storage/local-storage.js'),
    { GenerationWorker } = await import('../dist/generation/generation-worker.js');
  let app, base, project, setup, readerUser, video, remote;
  function client() {
    let cookies = '',
      csrf = '';
    return async (method, path, body, headers = {}) => {
      const binary = Buffer.isBuffer(body),
        r = await fetch(base + '/api/v1' + path, {
          method,
          headers: {
            'Content-Type': binary ? 'application/octet-stream' : 'application/json',
            'X-Studio-Request': '1',
            'X-CSRF-Token': csrf,
            Cookie: cookies,
            ...headers,
          },
          body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
        });
      const c = r.headers.getSetCookie();
      if (c.length) cookies = c.map((x) => x.split(';')[0]).join('; ');
      if (r.ok && r.headers.get('content-type')?.match(/^(image|video)\//))
        return {
          status: r.status,
          bytes: Buffer.from(await r.arrayBuffer()),
          hash: r.headers.get('x-content-sha256'),
        };
      const data = await r.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: r.status, data };
    };
  }
  const owner = client(),
    reader = client(),
    db = () => app.get(DatabaseService).sqlite;
  let fixtures;
  const upload = async (name) => {
    const intent = await owner(
      'POST',
      '/projects/' + project.id + '/media-uploads',
      { fileName: name, byteLength: fixtures[name].bytes.length },
      { 'Idempotency-Key': randomUUID() },
    );
    assert.equal(intent.status, 201, JSON.stringify(intent.data));
    const result = await owner('PUT', '/media-uploads/' + intent.data.id + '/content', fixtures[name].bytes);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.mediaVersion;
  };
  const preview = (ms, actor = owner, id = video.id) =>
    actor('GET', `/media-versions/${id}/frame?atMs=${ms}`);
  const save = (ms, hash, key = randomUUID(), actor = owner, id = video.id) =>
    actor(
      'POST',
      `/media-versions/${id}/frames`,
      { atMs: ms, expectedSha256: hash },
      { 'Idempotency-Key': key },
    );
  try {
    fixtures = await createMediaFixtures(join(dir, 'fixtures'), new AppConfig().ffmpegPath);
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@frames.test',
        password: 'Studio8!',
        name: 'Owner',
        workspaceName: 'Frames',
      })
    ).data;
    project = (await owner('POST', '/projects', { workspaceId: setup.workspace.id, title: 'Frame source' }))
      .data;
    const invite = (
      await owner('POST', '/workspaces/' + setup.workspace.id + '/invitations', {
        email: 'reader@frames.test',
      })
    ).data;
    readerUser = (
      await reader('POST', '/invitations/accept', {
        token: invite.token,
        password: 'Studio8!',
        name: 'Reader',
      })
    ).data.user;
    await owner('POST', '/projects/' + project.id + '/members', { userId: readerUser.id, role: 'VIEWER' });
    video = await upload('motion.mp4');
    await t.test(
      'different times return different actual PNGs and a reviewed image saves once with fixed provenance',
      async () => {
        const a = await preview(0),
          b = await preview(1000);
        assert.equal(a.status, 200, JSON.stringify(a.data));
        assert.equal(b.status, 200, JSON.stringify(b.data));
        assert.equal(a.hash, createHash('sha256').update(a.bytes).digest('hex'));
        assert.notEqual(a.hash, b.hash);
        assert.notDeepEqual(a.bytes, b.bytes);
        assert.equal(a.bytes.readUInt32BE(16), 96);
        assert.equal(a.bytes.readUInt32BE(20), 64);
        const key = randomUUID(),
          saved = await save(1000, b.hash, key);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const image = saved.data;
        assert.equal(image.origin, 'video_frame');
        assert.equal(image.mediaType, 'image');
        assert.equal(image.mime, 'image/png');
        assert.deepEqual(image.metadata.derivedFrom, { mediaVersionId: video.id, atMs: 1000 });
        assert.deepEqual((await owner('GET', image.contentUrl.replace('/api/v1', ''))).bytes, b.bytes);
        const replay = await save(1000, b.hash, key);
        assert.equal(replay.data.id, image.id);
        assert.equal((await save(0, a.hash, key)).status, 409);
        assert.equal((await save(1000, '0'.repeat(64))).status, 409);
        assert.equal(
          db().prepare("SELECT count(*) n FROM media_versions WHERE origin='video_frame'").get().n,
          1,
        );
        const assets = (await owner('GET', '/projects/' + project.id + '/media-assets')).data.items;
        assert.ok(assets.some((x) => x.latest.id === image.id));
        const refs = await owner('POST', '/projects/' + project.id + '/board-references/resolve', {
          references: [{ nodeId: randomUUID(), ref: { kind: 'media', id: image.id } }],
        });
        assert.equal(refs.status, 201);
        assert.deepEqual(
          (await owner('GET', video.contentUrl.replace('/api/v1', ''))).bytes,
          fixtures['motion.mp4'].bytes,
        );
        const row = db().prepare('SELECT * FROM media_frame_extractions WHERE request_key=?').get(key);
        assert.throws(
          () => db().prepare('UPDATE media_frame_extractions SET at_ms=0 WHERE id=?').run(row.id),
          /immutable/,
        );
        assert.equal(
          (await owner('PUT', '/media-uploads/' + row.upload_id + '/content', b.bytes)).data.code,
          'FRAME_UPLOAD_RESERVED',
        );
        assert.equal(
          (await owner('POST', '/media-uploads/' + row.upload_id + '/reconcile', {})).data.code,
          'FRAME_UPLOAD_RESERVED',
        );
        const pending = (await owner('GET', '/projects/' + project.id + '/media-uploads')).data.items;
        assert.ok(!pending.some((x) => x.id === row.upload_id));
      },
    );
    await t.test(
      'rejects readonly foreign nonvideo trial and out-of-range inputs without creating pictures',
      async () => {
        for (const ms of [-1, 2000, 100000000, NaN, 0.5, 'bad'])
          assert.equal((await preview(ms)).status, 400);
        assert.equal((await preview(0, reader)).status, 403);
        assert.equal((await save(0, 'a'.repeat(64), randomUUID(), reader)).status, 403);
        const image = await upload('image.png');
        assert.equal((await preview(0, owner, image.id)).status, 400);
        const other = (
          await owner('POST', '/projects', { workspaceId: setup.workspace.id, title: 'Private source' })
        ).data;
        const foreignIntent = await owner(
          'POST',
          '/projects/' + other.id + '/media-uploads',
          { fileName: 'motion.mp4', byteLength: fixtures['motion.mp4'].bytes.length },
          { 'Idempotency-Key': randomUUID() },
        );
        const foreign = (
          await owner(
            'PUT',
            '/media-uploads/' + foreignIntent.data.id + '/content',
            fixtures['motion.mp4'].bytes,
          )
        ).data.mediaVersion;
        assert.equal((await preview(0, reader, foreign.id)).status, 404);
        assert.equal(
          (
            await reader(
              'POST',
              `/media-versions/${video.id}/frames`,
              { atMs: 0, expectedSha256: 'a'.repeat(64), projectId: other.id },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          400,
        );
        remote = await startComfyMock({ 'clip.mp4': fixtures['motion.mp4'].bytes });
        const connection = (
          await owner('POST', '/projects/' + project.id + '/generation-connections', {
            name: 'Trial frame fixture',
            baseUrl: remote.baseUrl,
            trustedPrivate: true,
          })
        ).data;
        const workflow = (
          await owner(
            'POST',
            '/projects/' + project.id + '/generation-workflows',
            fixtureWorkflow(connection.id, true),
          )
        ).data;
        const trial = (
          await owner(
            'POST',
            '/projects/' + project.id + '/workflow-trials',
            { workflowId: workflow.id, positivePrompt: 'Trial remains evidence', confirmed: true },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        for (let i = 0; i < 3; i++) await app.get(GenerationWorker).tick();
        const result = (await owner('GET', '/generation-jobs/' + trial.id)).data;
        assert.equal(result.state, 'test_completed');
        assert.equal((await preview(0, owner, result.mediaVersionId)).data.code, 'FRAME_TEST_EVIDENCE');
        assert.equal(
          (await save(0, 'a'.repeat(64), randomUUID(), owner, result.mediaVersionId)).data.code,
          'FRAME_TEST_EVIDENCE',
        );
      },
    );
    await t.test(
      'registration failure resumes original managed upload without extracting again',
      async () => {
        const frame = await preview(500),
          key = randomUUID();
        db().exec(
          "CREATE TRIGGER fixture_frame_registration BEFORE INSERT ON media_versions WHEN NEW.origin='video_frame' BEGIN SELECT RAISE(ABORT,'frame fixture registration'); END;",
        );
        try {
          assert.equal((await save(500, frame.hash, key)).status, 409);
        } finally {
          db().exec('DROP TRIGGER fixture_frame_registration');
        }
        const row = db().prepare('SELECT * FROM media_frame_extractions WHERE request_key=?').get(key);
        assert.ok(row.upload_id);
        assert.equal(
          (await owner('GET', '/media-uploads/' + row.upload_id)).data.state,
          'needs_reconciliation',
        );
        const service = app.get(VideoFrameService),
          extract = service.extract;
        service.extract = () => {
          throw Error('should not re-extract');
        };
        let saved;
        try {
          saved = await save(500, frame.hash, key);
          assert.equal(saved.status, 201, JSON.stringify(saved.data));
        } finally {
          service.extract = extract;
        }
        assert.deepEqual(
          (await owner('GET', saved.data.contentUrl.replace('/api/v1', ''))).bytes,
          frame.bytes,
        );
        assert.equal((await save(500, frame.hash, key)).data.id, saved.data.id);
      },
    );
    await t.test(
      'corruption cancellation processing bounds and revoked source permissions prevent frame saves',
      async () => {
        const storage = app.get(LocalStorage),
          row = db().prepare('SELECT * FROM media_versions WHERE id=?').get(video.id),
          path = await storage.path(row.object_key),
          bytes = await readFile(path);
        try {
          await writeFile(path, Buffer.alloc(bytes.length));
          assert.equal((await preview(0)).data.code, 'MEDIA_INTEGRITY_FAILED');
        } finally {
          await writeFile(path, bytes);
        }
        const service = app.get(VideoFrameService),
          abort = new AbortController();
        const beforeDirs = (await readdir(tmpdir()))
          .filter((name) => name.startsWith('pullet-frame-'))
          .sort();
        abort.abort();
        await assert.rejects(service.extract(setup.user, video.id, 0, abort.signal));
        const config = app.get(AppConfig),
          ffmpeg = config.ffmpegPath;
        config.ffmpegPath = join(dir, 'missing-ffmpeg.exe');
        try {
          assert.equal((await preview(0)).data.code, 'FRAME_DECODE_FAILED');
        } finally {
          config.ffmpegPath = ffmpeg;
        }
        assert.deepEqual(
          (await readdir(tmpdir())).filter((name) => name.startsWith('pullet-frame-')).sort(),
          beforeDirs,
        );
        service.active = 2;
        try {
          assert.equal((await preview(0)).status, 429);
        } finally {
          service.active = 0;
        }
        const frame = await preview(200);
        await owner('POST', '/projects/' + project.id + '/members', {
          userId: readerUser.id,
          role: 'EDITOR',
          expectedRole: 'VIEWER',
        });
        const media = app.get(MediaService),
          receive = media.receive;
        const content = media.content;
        media.content = async function (...args) {
          const opened = await content.apply(this, args);
          opened.stream.destroy();
          return { ...opened, stream: Readable.from([Buffer.alloc(opened.length)]) };
        };
        try {
          assert.equal((await preview(0)).data.code, 'MEDIA_INTEGRITY_FAILED');
        } finally {
          media.content = content;
        }
        media.receive = async function (...args) {
          db()
            .prepare("UPDATE project_members SET role='VIEWER' WHERE project_id=? AND user_id=?")
            .run(project.id, readerUser.id);
          return receive.apply(this, args);
        };
        try {
          assert.equal((await save(200, frame.hash, randomUUID(), reader)).status, 403);
        } finally {
          media.receive = receive;
        }
        assert.deepEqual(db().pragma('foreign_key_check'), []);
        assert.equal(db().pragma('integrity_check', { simple: true }), 'ok');
      },
    );
  } finally {
    await remote?.close();
    await app?.close();
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  }
});
