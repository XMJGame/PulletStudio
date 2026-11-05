import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, copyFile, cp, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import Database from 'better-sqlite3';
const execute = promisify(execFile);

test('immutable timelines render real mixed animatics with durable jobs and audio policy', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-animatic-test-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'isolated-animatic-fixture-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { AppConfig } = await import('../dist/config.js');
  const { AnimaticWorker } = await import('../dist/timeline/animatic-worker.js');
  const { AnimaticRenderer } = await import('../dist/timeline/animatic-renderer.js');
  const { ProductionService } = await import('../dist/production/production.service.js');
  let app,
    base,
    project,
    workspace,
    revision,
    input,
    shots = [],
    savedMedia,
    viewerId,
    clip;
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
      const incoming = response.headers.getSetCookie();
      if (incoming.length) cookies = incoming.map((value) => value.split(';')[0]).join('; ');
      if (response.ok && method === 'GET' && /\/content(?:\?|$)|\/poster$/.test(path))
        return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  }
  const owner = client(),
    viewer = client(),
    outsider = client();
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  const db = () => app.get(DatabaseService).sqlite;
  const path = () => `/projects/${project.id}`;
  const preview = async (value = input) => owner('POST', path() + '/timelines/preview', value);
  const save = async (value, version, key = randomUUID(), actor = owner) => {
    const prepared = await preview(value);
    assert.equal(prepared.status, 201, JSON.stringify(prepared.data));
    return actor(
      'POST',
      path() + '/timelines',
      { ...value, expectedVersion: version, expectedPreviewHash: prepared.data.snapshotHash },
      { 'Idempotency-Key': key },
    );
  };
  const queue = (id = revision.id, key = randomUUID(), actor = owner) =>
    actor('POST', `/timelines/${id}/animatics`, {}, { 'Idempotency-Key': key });
  const readJob = async (id, timelineId = revision.id) =>
    (await owner('GET', `/timelines/${timelineId}/animatics`)).data.find((row) => row.id === id);
  const tick = () => app.get(AnimaticWorker).tick();
  try {
    await start();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@animatic.test',
        password: 'Studio8!',
        name: 'Producer',
        workspaceName: 'Animation team',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Travel montage' })).data;
    for (const [actor, name, role] of [
      [viewer, 'Viewer', 'VIEWER'],
      [outsider, 'Outsider', null],
    ]) {
      const invite = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: name + '@animatic.test' })
      ).data;
      const joined = (
        await actor('POST', '/invitations/accept', { token: invite.token, name, password: 'Studio8!' })
      ).data;
      if (role) {
        viewerId = joined.user.id;
        await owner('POST', path() + '/members', { userId: viewerId, role });
      }
    }
    const config = new AppConfig();
    const fixtures = await createMediaFixtures(join(directory, 'fixtures'), config.ffmpegPath);
    const media = {};
    for (const file of ['clip.mp4', 'image.png']) {
      const intent = (
        await owner(
          'POST',
          path() + '/media-uploads',
          { fileName: file, byteLength: fixtures[file].bytes.length },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      media[file] = (
        await owner('PUT', `/media-uploads/${intent.id}/content`, fixtures[file].bytes)
      ).data.mediaVersion;
    }
    clip = media['clip.mp4'];
    for (let i = 0; i < 4; i++) {
      const shot = (await owner('POST', path() + '/shots', { description: `Travel image ${i + 1}` })).data;
      const card = (await owner('GET', `/shots/${shot.id}/card/editor`)).data;
      card.body.durationSeconds = i % 2 ? 14 : 1;
      const updated = (
        await owner('PATCH', `/shots/${shot.id}/card`, { expectedVersion: shot.version, body: card.body })
      ).data.shot;
      const take = (
        await owner('POST', `/shots/${shot.id}/takes`, {
          mediaVersionId: media[i % 2 ? 'image.png' : 'clip.mp4'].id,
          expectedShotVersion: updated.version,
        })
      ).data;
      for (const [action, version] of [
        ['submit', 0],
        ['approve', 1],
      ])
        assert.equal(
          (
            await owner(
              'POST',
              `/takes/${take.id}/reviews`,
              { action, expectedDecisionVersion: version, reason: 'Review the montage source.' },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          201,
        );
      await owner(
        'POST',
        `/shots/${shot.id}/take-selection`,
        { takeId: take.id, expectedSelectionVersion: 0, reason: 'Use in montage.' },
        { 'Idempotency-Key': randomUUID() },
      );
      shots.push(updated);
    }
    const scope = { type: 'shots', shotIds: shots.map((shot) => shot.id) };
    const editor = (await owner('POST', path() + '/timeline-editor', { scope })).data;
    input = {
      scope,
      sourceHash: editor.sourceHash,
      profile: 'landscape',
      clips: editor.clips.map((item, index) => ({
        shotId: item.shotId,
        inMs: 0,
        durationMs: item.durationMs,
        audioPolicy: index === 0 ? 'keep' : 'mute',
      })),
    };
    await t.test(
      'time ranges, frame alignment and source policies use current fixed selections',
      async () => {
        assert.equal(editor.clips[0].audioPolicy, '');
        assert.equal(editor.clips[1].audioPolicy, 'mute');
        assert.equal(editor.ready, true);
        for (const mutate of [
          (x) => {
            x.clips[0].durationMs = 2000;
          },
          (x) => {
            x.clips[0].inMs = -1;
          },
          (x) => {
            x.clips[1].inMs = 1;
          },
          (x) => {
            x.clips[1].audioPolicy = 'keep';
          },
          (x) => {
            x.clips[0].audioPolicy = 'inspect';
          },
          (x) => {
            x.clips[1].shotId = x.clips[0].shotId;
          },
        ]) {
          const value = structuredClone(input);
          mutate(value);
          assert.equal((await preview(value)).status, 400);
        }
        const long = structuredClone(input);
        long.clips[1].durationMs = 200000;
        long.clips[3].durationMs = 200000;
        assert.equal((await preview(long)).data.code, 'TIMELINE_DURATION_LIMIT');
        const aligned = structuredClone(input);
        aligned.clips[0].durationMs = 41;
        const result = (await preview(aligned)).data.snapshot;
        assert.equal(result.clips[0].durationMs, 80);
        assert.equal(result.clips[1].positionMs, 80);
        const reordered = structuredClone(input);
        reordered.clips.reverse();
        assert.equal((await preview(reordered)).data.snapshot.clips[0].shotId, shots[3].id);
        assert.equal((await outsider('POST', path() + '/timeline-editor', { scope })).status, 404);
      },
    );
    await t.test('timeline revisions use CAS, immutable snapshots and durable idempotence', async () => {
      const key = randomUUID();
      const result = await save(input, 0, key);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      revision = result.data;
      assert.equal(revision.durationMs, 30000);
      assert.equal((await save(input, 0, key)).data.id, revision.id);
      const changed = { ...input, profile: 'portrait' };
      assert.equal((await save(changed, 0, key)).data.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await save(changed, 0)).data.code, 'TIMELINE_VERSION_CONFLICT');
      assert.equal((await save(input, 1, randomUUID(), viewer)).status, 403);
      assert.throws(() => db().exec('UPDATE timeline_revisions SET duration_ms=40'), /immutable/);
      assert.throws(() => db().exec('DELETE FROM timeline_revisions'), /immutable/);
    });
    await t.test(
      'worker heartbeats cannot turn an optimistic shot conflict into SQLITE_BUSY_SNAPSHOT',
      async () => {
        const writer = new Database(process.env.DATABASE_PATH);
        writer.pragma('busy_timeout=0');
        const production = app.get(ProductionService),
          original = production.shot.bind(production);
        let blocked = false;
        production.shot = (...args) => {
          const row = original(...args);
          try {
            writer
              .prepare(
                "INSERT INTO system_state(key,value) VALUES ('fixture_worker_heartbeat','1') ON CONFLICT(key) DO UPDATE SET value='2'",
              )
              .run();
          } catch (error) {
            if (error.code !== 'SQLITE_BUSY') throw error;
            blocked = true;
          }
          return row;
        };
        try {
          const result = await owner('PATCH', `/shots/${shots[0].id}`, {
            expectedVersion: shots[0].version - 1,
            description: 'Stale local edit.',
          });
          assert.equal(result.status, 409, JSON.stringify(result.data));
          assert.equal(result.data.code, 'VERSION_CONFLICT');
          assert.equal(blocked, true);
        } finally {
          production.shot = original;
          writer.close();
        }
      },
    );
    await t.test('a real 30-second mixed preview preserves one source audio and mutes another', async () => {
      assert.equal((await queue(revision.id, randomUUID(), viewer)).status, 403);
      const key = randomUUID(),
        queued = await queue(revision.id, key);
      assert.equal(queued.status, 201);
      assert.equal((await queue(revision.id, key)).data.id, queued.data.id);
      assert.equal((await queue()).data.code, 'ANIMATIC_ACTIVE');
      await tick();
      const job = await readJob(queued.data.id);
      assert.equal(job.state, 'completed', JSON.stringify(job));
      savedMedia = job.media;
      assert.equal(job.media.origin, 'animatic');
      assert.equal(job.media.metadata.width, 640);
      assert.equal(job.media.metadata.height, 360);
      assert.ok(Math.abs(job.media.metadata.durationMs - 30000) <= 80);
      assert.equal(job.media.metadata.hasAudio, true);
      const bytes = (await viewer('GET', job.media.contentUrl.replace('/api/v1', ''))).bytes;
      const output = join(directory, '30-second-preview.mp4');
      await writeFile(output, bytes);
      const energy = async (start) => {
        const result = await execute(
          config.ffmpegPath,
          [
            '-nostdin',
            '-v',
            'error',
            '-ss',
            String(start),
            '-i',
            output,
            '-t',
            '0.4',
            '-vn',
            '-ac',
            '1',
            '-ar',
            '8000',
            '-f',
            'f32le',
            'pipe:1',
          ],
          { encoding: 'buffer', windowsHide: true },
        );
        let sum = 0;
        for (let i = 0; i < result.stdout.length; i += 4) sum += result.stdout.readFloatLE(i) ** 2;
        return Math.sqrt(sum / (result.stdout.length / 4));
      };
      assert.ok((await energy(0.2)) > 0.01);
      assert.ok((await energy(15.2)) < 0.00001);
      assert.deepEqual(
        (await owner('GET', clip.contentUrl.replace('/api/v1', ''))).bytes,
        fixtures['clip.mp4'].bytes,
      );
      assert.equal(db().prepare('SELECT COUNT(*) n FROM takes').get().n, 4);
      assert.equal(
        (await owner('GET', path() + '/media-uploads')).data.items.some((upload) =>
          upload.fileName.startsWith('animatic-'),
        ),
        false,
      );
      const upload = db().prepare('SELECT id FROM media_uploads WHERE animatic_job_id=?').get(job.id);
      assert.equal(
        (await owner('POST', `/media-uploads/${upload.id}/reconcile`, {})).data.code,
        'ANIMATIC_UPLOAD_RESERVED',
      );
    });
    await t.test('expired leases recover in an independent worker after API restart', async () => {
      const short = structuredClone(input);
      short.clips.forEach((clip) => {
        clip.durationMs = 200;
        clip.audioPolicy = 'mute';
      });
      revision = (await save(short, 1)).data;
      const job = (await queue()).data;
      db()
        .prepare("UPDATE animatic_jobs SET state='rendering', lease_id=?, lease_until=? WHERE id=?")
        .run(randomUUID(), Date.now() + 60000, job.id);
      assert.equal(await tick(), false);
      db().prepare('UPDATE animatic_jobs SET lease_until=0 WHERE id=?').run(job.id);
      await app.close();
      await execute(
        process.execPath,
        [fileURLToPath(new URL('../dist/animatic-worker.js', import.meta.url)), '--once'],
        { windowsHide: true, timeout: 90000 },
      );
      await start();
      assert.equal((await readJob(job.id)).state, 'completed', JSON.stringify(await readJob(job.id)));
    });
    await t.test('queued and running cancellation fence the worker', async () => {
      const queued = (await queue()).data;
      assert.equal((await owner('POST', `/animatic-jobs/${queued.id}/cancel`, {})).data.state, 'canceled');
      assert.equal(await tick(), false);
      const running = (await queue()).data;
      const renderer = app.get(AnimaticRenderer),
        original = renderer.render.bind(renderer);
      renderer.render = async (_user, _snapshot, _directory, signal) => {
        await owner('POST', `/animatic-jobs/${running.id}/cancel`, {});
        await new Promise((_resolve, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      };
      try {
        await tick();
      } finally {
        renderer.render = original;
      }
      assert.equal((await readJob(running.id)).state, 'canceled');
    });
    await t.test('archive registration failure resumes without rendering or publishing twice', async () => {
      const job = (await queue()).data;
      db().exec(
        "CREATE TRIGGER animatic_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='animatic.complete' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
      );
      await tick();
      assert.equal((await readJob(job.id)).state, 'archiving');
      const upload = db()
        .prepare('SELECT media_version_id FROM media_uploads WHERE animatic_job_id=? AND state=?')
        .get(job.id, 'complete');
      assert.ok(upload);
      db().exec('DROP TRIGGER animatic_audit_failure');
      db().prepare('UPDATE animatic_jobs SET next_at=0 WHERE id=?').run(job.id);
      const renderer = app.get(AnimaticRenderer),
        original = renderer.render.bind(renderer);
      renderer.render = async () => {
        throw new Error('Should reuse archived output');
      };
      try {
        await tick();
      } finally {
        renderer.render = original;
      }
      assert.equal((await readJob(job.id)).state, 'completed');
      assert.equal((await readJob(job.id)).media.id, upload.media_version_id);
    });
    await t.test('stale source approval or card prevents queueing and rendering', async () => {
      const job = (await queue()).data;
      const card = (await owner('GET', `/shots/${shots[0].id}/card/editor`)).data;
      card.body.intent = 'New editorial intent.';
      await owner('PATCH', `/shots/${shots[0].id}/card`, {
        expectedVersion: shots[0].version,
        body: card.body,
      });
      assert.equal((await queue()).data.code, 'ANIMATIC_INPUT_CHANGED');
      await tick();
      assert.equal((await readJob(job.id)).state, 'failed');
      assert.equal((await readJob(job.id)).errorCode, 'ANIMATIC_INPUT_CHANGED');
    });
    await t.test('fractional video in-points retain the source frame clock', async () => {
      const sourcePath = join(directory, 'timing-source.mp4');
      await execute(
        config.ffmpegPath,
        [
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'color=red:s=96x64:r=12:d=1',
          '-f',
          'lavfi',
          '-i',
          'color=blue:s=96x64:r=12:d=2',
          '-filter_complex',
          '[0:v][1:v]concat=n=2:v=1:a=0[v]',
          '-map',
          '[v]',
          '-an',
          '-c:v',
          'libx264',
          '-threads',
          '1',
          '-pix_fmt',
          'yuv420p',
          sourcePath,
        ],
        { windowsHide: true },
      );
      const bytes = await readFile(sourcePath);
      const intent = (
        await owner(
          'POST',
          path() + '/media-uploads',
          { fileName: 'timing-source.mp4', byteLength: bytes.length },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      const source = (await owner('PUT', `/media-uploads/${intent.id}/content`, bytes)).data.mediaVersion;
      const row = (await owner('POST', path() + '/shots', {})).data;
      const card = (await owner('GET', `/shots/${row.id}/card/editor`)).data;
      const shot = (
        await owner('PATCH', `/shots/${row.id}/card`, { expectedVersion: row.version, body: card.body })
      ).data.shot;
      const take = (
        await owner('POST', `/shots/${shot.id}/takes`, {
          mediaVersionId: source.id,
          expectedShotVersion: shot.version,
        })
      ).data;
      for (const [action, version] of [
        ['submit', 0],
        ['approve', 1],
      ])
        assert.equal(
          (
            await owner(
              'POST',
              `/takes/${take.id}/reviews`,
              { action, expectedDecisionVersion: version, reason: 'Check source timing.' },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          201,
        );
      await owner(
        'POST',
        `/shots/${shot.id}/take-selection`,
        { takeId: take.id, expectedSelectionVersion: 0, reason: 'Use timing source.' },
        { 'Idempotency-Key': randomUUID() },
      );
      const scope = { type: 'shots', shotIds: [shot.id] };
      const editor = (await owner('POST', path() + '/timeline-editor', { scope })).data;
      revision = (
        await save(
          {
            scope,
            sourceHash: editor.sourceHash,
            profile: 'landscape',
            clips: [{ shotId: shot.id, inMs: 100, durationMs: 2000, audioPolicy: 'mute' }],
          },
          revision.version,
        )
      ).data;
      const job = (await queue()).data;
      await tick();
      const completed = await readJob(job.id);
      assert.equal(completed.state, 'completed', JSON.stringify(completed));
      const output = join(directory, 'timing-preview.mp4');
      await writeFile(output, (await owner('GET', completed.media.contentUrl.replace('/api/v1', ''))).bytes);
      const pixel = await execute(
        config.ffmpegPath,
        [
          '-v',
          'error',
          '-ss',
          '0.88',
          '-i',
          output,
          '-vf',
          'crop=2:2',
          '-frames:v',
          '1',
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          'pipe:1',
        ],
        { encoding: 'buffer', windowsHide: true },
      );
      assert.ok(
        pixel.stdout[0] > 240 && pixel.stdout[2] < 15,
        'Frame at source time 0.98 seconds should still be red',
      );
    });
    await t.test(
      'database and media backups restore timeline jobs and archived preview together',
      async () => {
        const { backupDatabase } = await import('../dist/db/backup.js');
        const { verifyMedia } = await import('../../../tools/verify-media.mjs');
        const backup = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backup')),
          restored = join(directory, 'restored.sqlite'),
          root = join(directory, 'restored-media');
        await copyFile(backup, restored);
        await cp(process.env.MEDIA_ROOT, root, { recursive: true });
        const copy = new DatabaseService({ databasePath: restored });
        try {
          assert.equal(copy.sqlite.pragma('integrity_check', { simple: true }), 'ok');
          assert.deepEqual(copy.sqlite.pragma('foreign_key_check'), []);
          for (const table of ['timeline_revisions', 'animatic_jobs'])
            assert.deepEqual(
              copy.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
              db().prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
            );
        } finally {
          copy.onModuleDestroy();
        }
        assert.equal((await verifyMedia(restored, root)).valid, true);
        assert.equal((await viewer('GET', savedMedia.contentUrl.replace('/api/v1', ''))).status, 200);
        await owner('DELETE', path() + '/members/' + viewerId, { expectedRole: 'VIEWER' });
        assert.equal((await viewer('GET', `/timelines/${revision.id}`)).status, 404);
        assert.equal((await viewer('GET', savedMedia.contentUrl.replace('/api/v1', ''))).status, 404);
        await owner('POST', path() + '/trash', { expectedVersion: project.version });
        assert.equal((await owner('GET', `/timelines/${revision.id}`)).status, 404);
      },
    );
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
