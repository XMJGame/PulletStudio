import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import { readPackageZip } from '../../../tests/fixtures/read-zip.mjs';

test('selected media packages freeze approvals, validate originals and stream readable ZIPs', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-package-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'isolated-media-package-fixture-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { AppConfig } = await import('../dist/config.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { LocalStorage } = await import('../dist/storage/local-storage.js');
  const { MediaService } = await import('../dist/assets/media.service.js');
  const { MediaPackageService } = await import('../dist/exports/media-package.service.js');
  let app, base, workspace, project, shot, secondShot, take, media, ownerUser, viewerId, saved, originalZip, handoffSaved, handoffBytes;
  function csvRows(bytes) {
    const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
    const rows = []; let row = [], cell = '', quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
      else if (char === '\r' && text[index + 1] === '\n' && !quoted) {
        row.push(cell); rows.push(row); row = []; cell = ''; index++;
      } else cell += char;
    }
    assert.equal(quoted, false);
    assert.equal(cell, '');
    return rows;
  }
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
      if (response.ok && path.endsWith('/file'))
        return {
          status: response.status,
          bytes: Buffer.from(await response.arrayBuffer()),
          headers: response.headers,
        };
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  }
  const owner = client(),
    viewer = client(),
    stranger = client();
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  const db = () => app.get(DatabaseService).sqlite;
  const path = () => `/projects/${project.id}/media-packages`;
  const options = () => ({ scope: { type: 'shots', shotIds: [shot.id, secondShot.id] } });
  const preview = async (input = options(), actor = owner) => actor('POST', path() + '/preview', input);
  const create = (hash, key = randomUUID(), input = options(), actor = owner) =>
    actor('POST', path(), { ...input, expectedSnapshotHash: hash }, { 'Idempotency-Key': key });
  async function fullShot(target = project) {
    const row = (
      await owner('POST', `/projects/${target.id}/shots`, {
        description: 'A train crosses an open landscape.',
      })
    ).data;
    const card = (await owner('GET', `/shots/${row.id}/card/editor`)).data;
    return (await owner('PATCH', `/shots/${row.id}/card`, { expectedVersion: row.version, body: card.body }))
      .data.shot;
  }
  async function approve(target, mediaVersionId = media.id) {
    const candidate = (
      await owner('POST', `/shots/${target.id}/takes`, {
        mediaVersionId,
        expectedShotVersion: target.version,
      })
    ).data;
    for (const [action, version] of [
      ['submit', 0],
      ['approve', 1],
    ]) {
      const response = await owner(
        'POST',
        `/takes/${candidate.id}/reviews`,
        { action, expectedDecisionVersion: version, reason: 'Checked the fixed media.' },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal(response.status, 201, JSON.stringify(response.data));
    }
    const result = await owner(
      'POST',
      `/shots/${target.id}/take-selection`,
      { takeId: candidate.id, expectedSelectionVersion: 0, reason: 'Use the approved media.' },
      { 'Idempotency-Key': randomUUID() },
    );
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return candidate;
  }
  try {
    await start();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@package.test',
        password: 'Studio8!',
        name: 'Producer',
        workspaceName: 'Film team',
      })
    ).data;
    workspace = setup.workspace;
    ownerUser = setup.user;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Railway film' })).data;
    for (const [actor, name, role] of [
      [viewer, 'Viewer', 'VIEWER'],
      [stranger, 'Stranger', null],
    ]) {
      const invitation = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: name + '@package.test' })
      ).data;
      const accepted = (
        await actor('POST', '/invitations/accept', { token: invitation.token, name, password: 'Studio8!' })
      ).data;
      if (role) {
        viewerId = accepted.user.id;
        await owner('POST', `/projects/${project.id}/members`, { userId: viewerId, role });
      }
    }
    const fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    async function upload(name, bytes = fixtures[name].bytes) {
      const intent = await owner(
        'POST',
        `/projects/${project.id}/media-uploads`,
        { fileName: name, byteLength: bytes.length },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal(intent.status, 201, JSON.stringify(intent.data));
      const result = await owner('PUT', `/media-uploads/${intent.data.id}/content`, bytes);
      assert.equal(result.data.state, 'complete', JSON.stringify(result.data));
      return result.data.mediaVersion;
    }
    media = await upload('clip.mp4');
    shot = await fullShot();
    secondShot = await fullShot();
    await t.test(
      'preflight shows blocked shots and rejects foreign targets and duplicate ranges',
      async () => {
        const initial = await preview();
        assert.equal(initial.status, 201);
        assert.equal(initial.data.ready, false);
        assert.equal(initial.data.items.length, 2);
        assert.equal((await create(initial.data.snapshotHash)).data.code, 'PACKAGE_NOT_READY');
        take = await approve(shot);
        const partial = await preview();
        assert.equal(partial.data.items.filter((item) => item.ready).length, 1);
        await approve(secondShot);
        const foreignProject = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Other production' })
        ).data;
        const foreign = await fullShot(foreignProject);
        assert.equal((await preview({ scope: { type: 'shots', shotIds: [foreign.id] } })).status, 404);
        assert.equal((await preview(options(), stranger)).status, 404);
        assert.equal((await preview({ scope: { type: 'shots', shotIds: [shot.id, shot.id] } })).status, 400);
      },
    );
    await t.test('concurrent creation is idempotent and ZIP has one copy of exact originals', async () => {
      const checked = (await preview()).data;
      assert.equal(checked.ready, true);
      assert.equal(checked.fileCount, 1);
      assert.equal(checked.mediaBytes, media.byteLength);
      const key = randomUUID();
      const [a, b] = await Promise.all([
        create(checked.snapshotHash, key),
        create(checked.snapshotHash, key),
      ]);
      assert.equal(a.status, 201, JSON.stringify(a.data));
      assert.equal(b.data.id, a.data.id);
      saved = a.data;
      assert.equal(saved.state, 'snapshot_ready');
      assert.equal(db().prepare('SELECT COUNT(*) n FROM media_package_exports').get().n, 1);
      assert.equal((await create('0'.repeat(64), key)).data.code, 'IDEMPOTENCY_CONFLICT');
      const downloaded = await viewer('GET', `/media-packages/${saved.id}/file`);
      assert.equal(downloaded.status, 200, JSON.stringify(downloaded.data));
      assert.equal(downloaded.headers.get('content-type'), 'application/zip');
      assert.equal(Number(downloaded.headers.get('content-length')), downloaded.bytes.length);
      originalZip = downloaded.bytes;
      const zip = readPackageZip(originalZip),
        manifest = JSON.parse(zip.get('manifest.json'));
      assert.equal(zip.size, 2);
      assert.equal(manifest.shots.length, 2);
      assert.equal(manifest.shots[0].source, null);
      assert.equal(manifest.shots[0].approval.shotVersion, shot.version);
      assert.ok(manifest.shots[0].selection.id);
      assert.equal(manifest.shots[0].take.id, take.id);
      assert.deepEqual(zip.get(manifest.files[0].path), fixtures['clip.mp4'].bytes);
      assert.equal(
        createHash('sha256').update(zip.get(manifest.files[0].path)).digest('hex'),
        manifest.files[0].sha256,
      );
      assert.ok(!JSON.stringify(manifest).includes(directory));
      assert.ok(!JSON.stringify(manifest).includes('baseUrl'));
      assert.equal((await owner('GET', `/media-packages/${saved.id}`)).data.manifest.packageId, saved.id);
    });
    await t.test('preview changes and mid-verification edits require a fresh confirmation', async () => {
      const checked = (await preview()).data;
      const selected = (await owner('GET', `/shots/${shot.id}/take-selection`)).data;
      await owner(
        'POST',
        `/shots/${shot.id}/take-selection`,
        { takeId: null, expectedSelectionVersion: selected.version, reason: 'Recheck this selection.' },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal((await create(checked.snapshotHash)).data.code, 'PACKAGE_NOT_READY');
      await owner(
        'POST',
        `/shots/${shot.id}/take-selection`,
        { takeId: take.id, expectedSelectionVersion: selected.version + 1, reason: 'Select again.' },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal((await create(checked.snapshotHash)).data.code, 'PACKAGE_PREVIEW_CHANGED');
      const current = (await preview()).data;
      const mediaService = app.get(MediaService),
        original = mediaService.content.bind(mediaService);
      let altered = false;
      mediaService.content = async (...args) => {
        const result = await original(...args);
        if (!altered) {
          altered = true;
          const card = (await owner('GET', `/shots/${shot.id}/card/editor`)).data;
          card.body.intent = 'A different editorial intent.';
          shot = (
            await owner('PATCH', `/shots/${shot.id}/card`, { expectedVersion: shot.version, body: card.body })
          ).data.shot;
        }
        return result;
      };
      try {
        assert.equal((await create(current.snapshotHash)).data.code, 'PACKAGE_PREVIEW_CHANGED');
      } finally {
        mediaService.content = original;
      }
      assert.equal(db().prepare('SELECT COUNT(*) n FROM media_package_exports').get().n, 1);
      assert.deepEqual((await viewer('GET', `/media-packages/${saved.id}/file`)).bytes, originalZip);
    });
    await t.test('missing or altered originals fail before ZIP delivery', async () => {
      const row = db().prepare('SELECT object_key FROM media_versions WHERE id=?').get(media.id);
      const physical = await app.get(LocalStorage).path(row.object_key);
      const original = await readFile(physical);
      try {
        await writeFile(physical, Buffer.alloc(original.length, 1));
        assert.equal(
          (await owner('GET', `/media-packages/${saved.id}/file`)).data.code,
          'MEDIA_INTEGRITY_FAILED',
        );
        await rm(physical);
        assert.equal((await owner('GET', `/media-packages/${saved.id}/file`)).status, 409);
      } finally {
        await writeFile(physical, original, { flag: 'wx' });
      }
      assert.deepEqual((await owner('GET', `/media-packages/${saved.id}/file`)).bytes, originalZip);
    });
    await t.test('new protected voice references revoke historical package access', async () => {
      const sound = await upload('sound.wav'),
        audioShot = await fullShot();
      await approve(audioShot, sound.id);
      const input = { scope: { type: 'shots', shotIds: [audioShot.id] }, layout: 'delivery' };
      const checked = (await preview(input)).data;
      const packageRow = (await create(checked.snapshotHash, randomUUID(), input)).data;
      assert.equal((await viewer('GET', `/media-packages/${packageRow.id}/file`)).status, 200);
      await owner(
        'POST',
        `/projects/${project.id}/entities`,
        {
          kind: 'voice',
          body: { name: 'Narrator', media: [{ role: 'voice_sample', mediaVersionId: sound.id }] },
        },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal((await preview(input, viewer)).data.ready, false);
      assert.equal((await viewer('GET', `/media-packages/${packageRow.id}`)).status, 403);
      assert.equal((await viewer('GET', `/media-packages/${packageRow.id}/file`)).status, 403);
      assert.equal((await owner('GET', `/media-packages/${packageRow.id}/file`)).status, 200);
    });
    await t.test('AAC audio originals retain a usable extension in packages', async () => {
      const sound = await upload('sound.m4a');
      const target = await fullShot();
      await approve(target, sound.id);
      const input = { scope: { type: 'shots', shotIds: [target.id] } };
      const checked = (await preview(input)).data;
      const result = await create(checked.snapshotHash, randomUUID(), input);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      const delivered = await owner('GET', `/media-packages/${result.data.id}/file`);
      const zip = readPackageZip(delivered.bytes),
        manifest = JSON.parse(zip.get('manifest.json'));
      assert.ok(manifest.files[0].path.endsWith('.m4a'));
      assert.deepEqual(zip.get(manifest.files[0].path), fixtures['sound.m4a'].bytes);
    });
    await t.test('audit failures roll back fixed manifests and history stays immutable', async () => {
      const input = { scope: { type: 'shots', shotIds: [secondShot.id] } };
      const checked = (await preview(input)).data;
      const count = db().prepare('SELECT COUNT(*) n FROM media_package_exports').get().n;
      db().exec(
        "CREATE TRIGGER package_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='media.package.create' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
      );
      try {
        assert.equal((await create(checked.snapshotHash, randomUUID(), input)).status, 409);
      } finally {
        db().exec('DROP TRIGGER package_audit_failure');
      }
      assert.equal(db().prepare('SELECT COUNT(*) n FROM media_package_exports').get().n, count);
      assert.throws(() => db().exec("UPDATE media_package_exports SET manifest_json='{}'"), /immutable/);
      assert.throws(() => db().exec('DELETE FROM media_package_exports'), /immutable/);
    });
    await t.test('standard handoff freezes exact selected media, documents and CSV path mappings', async () => {
      const picture = await upload('image.png'), sound = await upload('sound.m4a');
      const targets = [];
      const description = ' \u200b=1+1,\n"桥"与远山';
      for (const source of [media, media, picture, sound]) {
        let target = await fullShot();
        const editor = (await owner('GET', `/shots/${target.id}/card/editor`)).data;
        editor.body.description = description;
        editor.body.durationSeconds = 7;
        editor.body.dialogue = '你好，旅人。\nNext stop.';
        target = (await owner('PATCH', `/shots/${target.id}/card`, { expectedVersion: target.version, body: editor.body })).data.shot;
        await approve(target, source.id);
        targets.push(target);
      }
      const input = { scope: { type: 'shots', shotIds: targets.map(target => target.id) }, layout: 'delivery' };
      const checked = (await preview(input)).data;
      assert.equal(checked.ready, true);
      assert.equal(checked.layout, 'delivery');
      assert.equal(checked.documents.length, 2);
      assert.equal(checked.fileCount, 3);
      assert.deepEqual(checked.directories, ['01_Video', '03_Images', '02_Audio']);
      const key = randomUUID();
      const result = await create(checked.snapshotHash, key, input);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      handoffSaved = result.data;
      assert.equal(handoffSaved.layout, 'delivery');
      assert.equal((await create(checked.snapshotHash, key, input)).data.layout, 'delivery');
      assert.equal((await create(checked.snapshotHash, key, { scope: input.scope })).data.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await create((await preview({ scope: input.scope })).data.snapshotHash, randomUUID(), input)).data.code, 'PACKAGE_PREVIEW_CHANGED');
      assert.equal((await owner('GET', path())).data.items.find(item => item.id === handoffSaved.id).layout, 'delivery');
      handoffBytes = (await viewer('GET', `/media-packages/${handoffSaved.id}/file`)).bytes;
      const zip = readPackageZip(handoffBytes), manifest = JSON.parse(zip.get('manifest.json'));
      assert.equal(zip.size, 6);
      assert.equal(manifest.schemaVersion, 'studio.media-package.v2');
      assert.equal(manifest.shots.length, 4);
      assert.equal(manifest.files.length, 3);
      for (const document of manifest.documents) {
        const content = zip.get(document.path);
        assert.equal(content.length, document.byteLength);
        assert.equal(createHash('sha256').update(content).digest('hex'), document.sha256);
        assert.equal(content.toString('utf8'), document.content);
      }
      const csv = zip.get('05_Documents/ShotList.csv');
      assert.deepEqual([...csv.subarray(0, 3)], [239, 187, 191]);
      const [headers, ...rows] = csvRows(csv);
      assert.equal(rows.length, 4);
      const objects = rows.map(row => {
        assert.equal(row.length, headers.length);
        return Object.fromEntries(headers.map((header, index) => [header, row[index]]));
      });
      assert.equal(objects[0].media_path, objects[1].media_path);
      assert.equal(objects[0].description, "'" + description);
      assert.equal(objects[0].dialogue, '你好，旅人。\nNext stop.');
      assert.equal(objects[0].planned_duration_seconds, '7');
      assert.equal(Number(objects[0].source_duration_ms), media.metadata.durationMs);
      assert.equal(objects[2].source_duration_ms, '');
      for (const [index, row] of objects.entries()) {
        assert.equal(row.order, String(index + 1));
        const frozen = manifest.shots[index];
        assert.equal(row.approval_id, frozen.approval.id);
        assert.equal(row.take_id, frozen.take.id);
        const file = manifest.files.find(file => file.mediaVersionId === frozen.take.mediaVersionId);
        assert.equal(row.media_path, file.path);
        assert.equal(zip.get(file.path).length, file.byteLength);
      }
      for (const file of manifest.files) {
        const expected = file.mime === 'video/mp4' ? 'clip.mp4' : file.mime === 'image/png' ? 'image.png' : 'sound.m4a';
        assert.deepEqual(zip.get(file.path), fixtures[expected].bytes);
      }
      const notes = zip.get('05_Documents/ProductionNotes.md').toString('utf8');
      assert.match(notes, /不等于最终剪辑时长/);
      assert.match(notes, /字幕 SRT 和 PDF 尚未纳入/);
      assert.ok(![...zip.keys()].some(path => path.startsWith('04_Subtitles/') || path.endsWith('.pdf')));
      const editor = (await owner('GET', `/shots/${targets[0].id}/card/editor`)).data;
      editor.body.description = 'Later production revision.';
      await owner('PATCH', `/shots/${targets[0].id}/card`, { expectedVersion: targets[0].version, body: editor.body });
      assert.deepEqual((await owner('GET', `/media-packages/${handoffSaved.id}/file`)).bytes, handoffBytes);
      assert.equal((await create(checked.snapshotHash, key, input)).data.id, handoffSaved.id);
      assert.deepEqual((await viewer('GET', `/media-packages/${saved.id}/file`)).bytes, originalZip);
    });
    await t.test('legacy unsafe codes and case-folded collisions cannot escape delivery folders', async () => {
      const one = await upload('image.png'), two = await upload('image.png');
      const targets = [await fullShot(), await fullShot()];
      for (const [index, target] of targets.entries()) {
        db().prepare('UPDATE shots SET code=? WHERE id=?').run(index ? '..\\Same' : '../Same', target.id);
        await approve(target, index ? two.id : one.id);
      }
      const input = { scope: { type: 'shots', shotIds: targets.map(target => target.id) }, layout: 'delivery' };
      const result = await create((await preview(input)).data.snapshotHash, randomUUID(), input);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      const zip = readPackageZip((await owner('GET', `/media-packages/${result.data.id}/file`)).bytes);
      const manifest = JSON.parse(zip.get('manifest.json'));
      assert.equal(new Set(manifest.files.map(file => file.path.toLowerCase())).size, 2);
      for (const file of manifest.files) {
        assert.match(file.path, /^03_Images\/[a-zA-Z0-9_-]+\.png$/);
        assert.deepEqual(zip.get(file.path), fixtures['image.png'].bytes);
      }
    });
    await t.test('delivery document capacity rejects without saving a truncated handoff', async () => {
      const { packageLimits } = await import('../dist/exports/media-package-contract.js');
      const limit = packageLimits.documentBytes;
      const count = db().prepare('SELECT COUNT(*) n FROM media_package_exports').get().n;
      packageLimits.documentBytes = 1;
      try {
        const input = { scope: { type: 'shots', shotIds: [secondShot.id] }, layout: 'delivery' };
        assert.equal((await preview(input)).data.code, 'PACKAGE_DOCUMENT_LIMIT');
        assert.equal((await create('0'.repeat(64), randomUUID(), input)).data.code, 'PACKAGE_DOCUMENT_LIMIT');
        assert.equal(db().prepare('SELECT COUNT(*) n FROM media_package_exports').get().n, count);
      } finally { packageLimits.documentBytes = limit; }
    });
    await t.test(
      'canceled downloads close source streams and blocked downloads do not start archives',
      async () => {
        const service = app.get(MediaPackageService);
        const abort = new AbortController();
        abort.abort();
        await assert.rejects(service.file(ownerUser, saved.id, abort.signal));
        const mediaService = app.get(MediaService),
          original = mediaService.content.bind(mediaService),
          opened = [];
        mediaService.content = async (...args) => {
          const value = await original(...args);
          opened.push(value.stream);
          return value;
        };
        try {
          const controller = new AbortController();
          const file = await service.file(ownerUser, saved.id, controller.signal);
          await new Promise((resolve, reject) => {
            file.stream.once('error', reject);
            file.stream.once('data', () => controller.abort());
            file.stream.once('close', resolve);
            file.stream.resume();
          });
          for (let i = 0; i < 30 && !opened.every((stream) => stream.closed); i++)
            await new Promise((resolve) => setTimeout(resolve, 10));
          assert.ok(opened.every((stream) => stream.closed));
        } finally {
          mediaService.content = original;
        }
        let calls = 0;
        mediaService.content = async (...args) => {
          const source = await original(...args);
          if (++calls === 2) {
            source.stream.destroy();
            source.stream = Readable.from([Buffer.alloc(source.length, 1)]);
          }
          return source;
        };
        try {
          await assert.rejects(async () => {
            const file = await service.file(ownerUser, saved.id);
            const sink = new Writable({
              write(_chunk, _encoding, done) {
                done();
              },
            });
            await pipeline(file.stream, sink);
          }, /Media integrity changed/);
        } finally {
          mediaService.content = original;
        }
      },
    );
    await t.test(
      'history pagination, independent backup and API restart retain fixed ZIP bytes',
      async () => {
        const input = { scope: { type: 'shots', shotIds: [secondShot.id] } };
        const checked = (await preview(input)).data;
        for (let i = 0; i < 20; i++)
          assert.equal((await create(checked.snapshotHash, randomUUID(), input)).status, 201);
        const first = (await owner('GET', path())).data;
        assert.equal(first.items.length, 20);
        assert.ok(first.nextCursor);
        const more = (await owner('GET', path() + '?cursor=' + first.nextCursor)).data;
        assert.equal(
          new Set([...first.items, ...more.items].map((row) => row.id)).size,
          first.items.length + more.items.length,
        );
        const { backupDatabase } = await import('../dist/db/backup.js');
        const backup = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backup')),
          restored = join(directory, 'restored.sqlite');
        await copyFile(backup, restored);
        const copy = new DatabaseService({ databasePath: restored });
        try {
          assert.equal(copy.sqlite.pragma('integrity_check', { simple: true }), 'ok');
          assert.deepEqual(copy.sqlite.pragma('foreign_key_check'), []);
          assert.deepEqual(
            copy.sqlite.prepare('SELECT * FROM media_package_exports ORDER BY id').all(),
            db().prepare('SELECT * FROM media_package_exports ORDER BY id').all(),
          );
        } finally {
          copy.onModuleDestroy();
        }
        await app.close();
        await start();
        assert.deepEqual((await owner('GET', `/media-packages/${saved.id}/file`)).bytes, originalZip);
        assert.deepEqual((await owner('GET', `/media-packages/${handoffSaved.id}/file`)).bytes, handoffBytes);
      },
    );
    await t.test('package bounds reject oversized scope and media without truncation', async () => {
      const { shots } = await import('../dist/db/schema.js');
      const database = app.get(DatabaseService).db;
      const template = database
        .select()
        .from(shots)
        .all()
        .find((row) => row.id === secondShot.id);
      for (let i = 0; i < 101; i++)
        database
          .insert(shots)
          .values({
            ...template,
            id: randomUUID(),
            code: `LIMIT${i}`,
            sequence: 1000 + i,
          })
          .run();
      assert.equal((await preview({ scope: { type: 'project' } })).data.code, 'PACKAGE_SHOT_LIMIT');
      const mediaService = app.get(MediaService),
        original = mediaService.version.bind(mediaService);
      mediaService.version = (...args) => ({ ...original(...args), byteLength: 2 * 1024 * 1024 * 1024 + 1 });
      try {
        assert.equal(
          (await preview({ scope: { type: 'shots', shotIds: [secondShot.id] } })).data.code,
          'PACKAGE_SIZE_LIMIT',
        );
      } finally {
        mediaService.version = original;
      }
    });
    await t.test('project membership and trash protect persisted manifests and ZIP downloads', async () => {
      assert.equal((await stranger('GET', `/media-packages/${saved.id}`)).status, 404);
      await owner('DELETE', `/projects/${project.id}/members/${viewerId}`, { expectedRole: 'VIEWER' });
      assert.equal((await viewer('GET', `/media-packages/${saved.id}/file`)).status, 404);
      await owner('POST', `/projects/${project.id}/trash`, { expectedVersion: project.version });
      assert.equal((await owner('GET', `/media-packages/${saved.id}`)).status, 404);
      assert.equal((await owner('GET', `/media-packages/${saved.id}/file`)).status, 404);
    });
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
