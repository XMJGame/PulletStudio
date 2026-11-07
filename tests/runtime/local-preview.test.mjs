import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { readFile, writeFile, stat, rename } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createMediaFixtures } from '../fixtures/media-fixtures.mjs';

const execute = promisify(execFile);
const root = process.env.PULLET_PREVIEW_TEST_ROOT && resolve(process.env.PULLET_PREVIEW_TEST_ROOT);
const config = {
  webPort: 5192,
  apiPort: 3112,
  setupToken: 'c'.repeat(64),
  providerMasterKey: 'd'.repeat(64),
};
const base = `http://127.0.0.1:${config.webPort}`;
const launch = (command) =>
  execute(resolve(root, 'runtime/node.exe'), [resolve(root, 'tools/local-preview.mjs'), command], {
    // Deliberately outside the package: all data must still stay inside it.
    cwd: resolve('data/e2e'),
    windowsHide: true,
    timeout: 80000,
  });
test(
  'unpacked Windows preview runs isolated, protects control, handles media and preserves data on restart',
  {
    skip: !root || process.platform !== 'win32',
    timeout: 180000,
  },
  async (t) => {
    assert.match(root, /[\\/]data[\\/]e2e[\\/]/, 'run tests only in a separate QA directory');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(resolve(root, 'data'), { recursive: true });
    await writeFile(resolve(root, 'data/preview-config.json'), JSON.stringify(config), { flag: 'wx' });
    const manifest = JSON.parse(await readFile(resolve(root, 'FILES.json'), 'utf8'));
    await t.test('package file whitelist excludes user data, tests and environment files', async () => {
      assert(manifest.length > 100);
      for (const item of manifest) assert(!/^(data\/|tests\/|\.env)|(^|\/)\.env$/.test(item.path), item.path);
      for (const path of [
        'runtime/node.exe',
        'runtime/ffmpeg/ffmpeg.exe',
        'tools/local-preview.mjs',
        'apps/api/dist/main.js',
        'apps/web/dist/index.html',
      ]) {
        const file = manifest.find((x) => x.path === path);
        assert(file, path);
        const bytes = await readFile(resolve(root, path));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
      }
    });
    await t.test('occupied web port fails without terminating the owner', async () => {
      const blocker = createServer();
      await new Promise((done) => blocker.listen(config.webPort, '127.0.0.1', done));
      try {
        await assert.rejects(launch('start'), (error) => /occupied/.test(error.stderr));
        assert(blocker.listening);
      } finally {
        await new Promise((done) => blocker.close(done));
      }
    });
    await t.test('failed API startup closes the supervisor and releases its ports', async () => {
      const entry = resolve(root, 'apps/api/dist/main.js');
      await rename(entry, `${entry}.qa-disabled`);
      try {
        await assert.rejects(launch('start'), (error) => /Startup failed/.test(error.stderr));
        await assert.rejects(fetch(base + '/health/ready'));
        await assert.rejects(fetch(`http://127.0.0.1:${config.apiPort}/health/ready`));
        assert.match((await launch('status')).stdout, /Stopped/);
      } finally {
        await rename(`${entry}.qa-disabled`, entry);
      }
    });
    let cookie, csrf, workspace, media;
    async function call(method, path, body, headers = {}) {
      return fetch(base + path, {
        method,
        headers: {
          Cookie: cookie || '',
          'X-Studio-Request': '1',
          'X-CSRF-Token': csrf || '',
          'Idempotency-Key': randomUUID(),
          ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
      });
    }
    try {
      await t.test('self-contained runtime starts, repeats safely and only serves Web files', async () => {
        assert.match((await launch('start')).stdout, /Running:/);
        assert.match((await launch('start')).stdout, /Running:/);
        assert.equal((await fetch(base + '/health/ready')).status, 200);
        const index = await fetch(base);
        assert.match(await index.text(), /assets\/index-/);
        assert.match(index.headers.get('content-security-policy'), /frame-ancestors 'none'/);
        for (const path of [
          '/data/preview-config.json',
          '/data/studio.sqlite',
          '/.env',
          '/runtime/node.exe',
          '/node_modules/better-sqlite3/package.json',
        ])
          assert.equal((await fetch(base + path)).status, 404, path);
        assert.equal((await fetch(base + '/__pullet_preview/stop', { method: 'POST' })).status, 403);
        assert.match((await launch('status')).stdout, /Running:/);
      });
      await t.test(
        'same-origin setup/cookies/CSRF and real video import, Range, frame preview/save',
        async () => {
          const response = await call('POST', '/api/v1/setup/initialize', {
            setupToken: config.setupToken,
            email: 'artist@board.test',
            password: 'Studio8!',
            name: 'QA creator',
            workspaceName: 'QA workspace',
          });
          assert.equal(response.status, 201, await response.clone().text());
          cookie = response.headers
            .getSetCookie()
            .map((entry) => entry.split(';')[0])
            .join('; ');
          const setup = await response.json();
          csrf = setup.csrfToken;
          workspace = setup.workspace;
          const projectResponse = await call('POST', '/api/v1/projects', {
            workspaceId: workspace.id,
            title: 'Runtime frame acceptance',
            aspectRatio: '16:9',
          });
          assert(projectResponse.ok, await projectResponse.clone().text());
          const project = await projectResponse.json();
          const fixtures = await createMediaFixtures(
            resolve(root, 'data/qa-fixtures'),
            resolve(root, 'runtime/ffmpeg/ffmpeg.exe'),
          );
          const video = fixtures['motion.mp4'];
          const initiate = await call('POST', `/api/v1/projects/${project.id}/media-uploads`, {
            fileName: 'motion.mp4',
            byteLength: video.bytes.length,
            contentType: 'video/mp4',
          });
          assert(initiate.ok, await initiate.clone().text());
          const upload = await initiate.json();
          const receive = await call('PUT', `/api/v1/media-uploads/${upload.id}/content`, video.bytes, {
            'Content-Type': 'application/octet-stream',
          });
          assert(receive.ok, await receive.clone().text());
          media = (await receive.json()).mediaVersion;
          const range = await call('GET', `/api/v1/media-versions/${media.id}/content`, null, {
            Range: 'bytes=0-99',
          });
          assert.equal(range.status, 206);
          assert.equal((await range.arrayBuffer()).byteLength, 100);
          const frame = await call('GET', `/api/v1/media-versions/${media.id}/frame?atMs=600`);
          assert.equal(frame.status, 200, await frame.clone().text());
          const pixels = Buffer.from(await frame.arrayBuffer());
          const hash = frame.headers.get('x-content-sha256');
          assert.equal(createHash('sha256').update(pixels).digest('hex'), hash);
          const save = await call('POST', `/api/v1/media-versions/${media.id}/frames`, {
            atMs: 600,
            expectedSha256: hash,
          });
          assert(save.ok, await save.clone().text());
          const image = await save.json();
          const original = await call('GET', `/api/v1/media-versions/${image.id}/content`);
          assert.deepEqual(Buffer.from(await original.arrayBuffer()), pixels);
        },
      );
      await t.test(
        'stop is idempotent, releases both ports and restart retains account and media',
        async () => {
          assert.match((await launch('stop')).stdout, /Stopped/);
          assert.match((await launch('stop')).stdout, /Stopped/);
          await assert.rejects(fetch(base + '/health/ready'));
          await assert.rejects(fetch(`http://127.0.0.1:${config.apiPort}/health/ready`));
          assert((await stat(resolve(root, 'data/studio.sqlite'))).size > 0);
          assert.match((await launch('start')).stdout, /Running:/);
          const me = await call('GET', '/api/v1/auth/me');
          assert.equal(me.status, 200);
          const content = await call('GET', `/api/v1/media-versions/${media.id}/content`);
          assert.equal(content.status, 200);
          await content.arrayBuffer();
          const Database = createRequire(resolve(root, 'apps/api/package.json'))('better-sqlite3');
          const db = new Database(resolve(root, 'data/studio.sqlite'), { readonly: true });
          try {
            assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
            assert.equal(db.pragma('foreign_key_check').length, 0);
            assert.equal(db.prepare('select count(*) as n from __drizzle_migrations').get().n, 54);
          } finally {
            db.close();
          }
        },
      );
    } finally {
      await launch('stop');
    }
  },
);
