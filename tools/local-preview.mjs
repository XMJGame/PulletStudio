import { createServer, request } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = resolve(root, 'data');
const statePath = resolve(data, 'preview-run.json');
const origin = (port) => `http://127.0.0.1:${port}`;
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const missing = (error) => error.code === 'ENOENT';
const secret = () => randomBytes(32).toString('hex');
function openBrowser(port) {
  if (process.argv.includes('--open') && process.platform === 'win32') {
    const browser = spawn('explorer.exe', [origin(port)], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    browser.on('error', () => console.log(`Open ${origin(port)} in your browser.`));
    browser.unref();
  }
}

async function configuration() {
  const path = resolve(data, 'preview-config.json');
  try {
    const config = await json(path);
    if (
      ![config.webPort, config.apiPort].every((n) => Number.isInteger(n) && n >= 1024 && n <= 65535) ||
      config.webPort === config.apiPort ||
      !/^[a-f0-9]{64}$/.test(config.setupToken) ||
      !/^[a-f0-9]{64}$/.test(config.providerMasterKey)
    )
      throw new Error('Invalid data/preview-config.json. Restore the original configuration.');
    return config;
  } catch (error) {
    if (!missing(error)) throw error;
    const config = { webPort: 5188, apiPort: 3188, setupToken: secret(), providerMasterKey: secret() };
    await writeFile(path, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
    return config;
  }
}

async function control(state, action) {
  const response = await fetch(`${origin(state.port)}/__pullet_preview/${action}`, {
    method: action === 'stop' ? 'POST' : 'GET',
    headers: { 'X-Pullet-Control': state.key },
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error('Preview control identity could not be verified.');
  const result = await response.json();
  if (result.id !== state.id) throw new Error('Preview control identity changed.');
  return result;
}

async function available(port) {
  const server = createSocketServer();
  await new Promise((done, reject) => {
    server.once('error', () =>
      reject(new Error(`Port ${port} is occupied. Close its service or change preview-config.json ports.`)),
    );
    server.listen(port, '127.0.0.1', done);
  });
  await new Promise((done) => server.close(done));
}

async function serve(config) {
  const state = { id: secret(), key: secret(), pid: process.pid, port: config.webPort };
  // Exclusive file prevents a second supervisor from ever sharing this data directory.
  await writeFile(statePath, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
  const children = [];
  const logs = [];
  let ready = false,
    stopping = false,
    exitCode = 0,
    shutdownPromise;
  const web = resolve(root, 'apps/web/dist');
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_PATH: resolve(data, 'studio.sqlite'),
    MEDIA_ROOT: resolve(data, 'media'),
    SETUP_TOKEN: config.setupToken,
    PROVIDER_MASTER_KEY: config.providerMasterKey,
    APP_ORIGINS: origin(config.webPort),
    PORT: String(config.apiPort),
    COOKIE_SECURE: 'false',
    SESSION_HOURS: '12',
    FFMPEG_PATH: resolve(root, 'runtime/ffmpeg/ffmpeg.exe'),
    FFPROBE_PATH: resolve(root, 'runtime/ffmpeg/ffprobe.exe'),
  };
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, origin(config.webPort)).pathname;
      if (path.startsWith('/__pullet_preview/')) {
        res.setHeader('Cache-Control', 'no-store');
        const supplied = Buffer.from(String(req.headers['x-pullet-control'] || ''));
        const expected = Buffer.from(state.key);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          res.writeHead(403).end();
          return;
        }
        if (path === '/__pullet_preview/status' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ id: state.id, ready, stopping }));
        } else if (path === '/__pullet_preview/stop' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ id: state.id, stopping: true }));
          void shutdown();
        } else res.writeHead(404).end();
        return;
      }
      if (stopping || !ready) {
        res.writeHead(503).end('Pullet Studio is starting or stopping. Please try again shortly.');
        return;
      }
      if (
        path === '/api' ||
        path.startsWith('/api/') ||
        path.startsWith('/health/') ||
        path === '/openapi.json'
      ) {
        const upstream = request(
          {
            host: '127.0.0.1',
            port: config.apiPort,
            path: req.url,
            method: req.method,
            headers: { ...req.headers, host: `127.0.0.1:${config.apiPort}`, connection: 'close' },
          },
          (response) => {
            res.writeHead(response.statusCode, response.headers);
            response.pipe(res);
            response.on('error', () => res.destroy());
          },
        );
        upstream.on('error', () => {
          if (!res.headersSent) res.writeHead(502).end('API unavailable');
          else res.destroy();
        });
        req.on('aborted', () => upstream.destroy());
        res.on('close', () => {
          if (!res.writableFinished) upstream.destroy();
        });
        req.pipe(upstream);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405).end();
        return;
      }
      const decoded = decodeURIComponent(path);
      if (decoded.split('/').some((part) => part.startsWith('.'))) {
        res.writeHead(404).end();
        return;
      }
      const relative = decoded.startsWith('/assets/')
        ? decoded.slice(1)
        : decoded === '/' || (!extname(decoded) && !decoded.includes('..'))
          ? 'index.html'
          : null;
      const file = relative && resolve(web, relative);
      if (!file || !file.startsWith(web + sep) || decoded.includes('\\') || decoded.includes('\0')) {
        res.writeHead(404).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404).end();
        return;
      }
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'",
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(file);
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 400).end();
      else res.destroy();
    }
  });

  function child(entry, name) {
    const log = createWriteStream(resolve(data, `logs/${name}.log`), { flags: 'a' });
    logs.push(log);
    const processChild = spawn(
      process.execPath,
      [resolve(root, 'tools/local-child.cjs'), resolve(root, `apps/api/dist/${entry}.js`)],
      {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    children.push(processChild);
    processChild.stdout.pipe(log, { end: false });
    processChild.stderr.pipe(log, { end: false });
    processChild.once('error', () => {
      exitCode = 1;
      void shutdown();
    });
    processChild.once('exit', () => {
      if (!stopping) {
        exitCode = 1;
        void shutdown();
      }
    });
    return processChild;
  }
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    stopping = true;
    ready = false;
    shutdownPromise = (async () => {
      // Worker first: finish its in-flight step before closing the API/database.
      for (const processChild of [...children].reverse()) {
        if (processChild.exitCode !== null || processChild.signalCode !== null) continue;
        await new Promise((done) => {
          processChild.once('exit', done);
          if (processChild.connected) processChild.send('pullet-stop', () => {});
          else processChild.kill();
        });
      }
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      for (const log of logs) log.end();
      await unlink(statePath);
      process.exitCode = exitCode;
    })().catch(() => {
      process.exitCode = 1;
    });
    return shutdownPromise;
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(config.webPort, '127.0.0.1', done);
    });
    await available(config.apiPort);
    const api = child('main', 'api');
    const deadline = Date.now() + 45000;
    for (;;) {
      if (stopping) throw new Error('API exited. See data/logs/api.log.');
      try {
        const response = await fetch(`${origin(config.apiPort)}/health/ready`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok && api.exitCode === null) break;
      } catch {
        /* wait for this new API to initialize its own database */
      }
      if (Date.now() > deadline) throw new Error('API readiness timed out. See data/logs/api.log.');
      await delay(200);
    }
    const worker = child('generation-worker', 'generation-worker');
    await new Promise((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Worker readiness timed out.')), 15000);
      worker.once('exit', () => {
        clearTimeout(timeout);
        reject(new Error('Worker exited.'));
      });
      let output = '';
      worker.stdout.on('data', (chunk) => {
        output = (output + chunk).slice(-4096);
        if (output.includes('Media generation worker ready')) {
          clearTimeout(timeout);
          done();
        }
      });
    });
    if (!stopping) {
      ready = true;
      console.log(`Ready: ${origin(config.webPort)}`);
    }
  } catch (error) {
    console.error(error.message);
    exitCode = 1;
    await shutdown();
  }
}

async function main() {
  await mkdir(resolve(data, 'logs'), { recursive: true });
  const command = process.argv[2] || 'start';
  if (!['start', 'stop', 'status', 'serve'].includes(command)) throw new Error('Use start, stop or status.');
  const config = await configuration();
  if (command === 'serve') {
    await serve(config);
    return;
  }
  let state;
  try {
    state = await json(statePath);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  if (state) {
    let current;
    try {
      current = await control(state, 'status');
    } catch {
      // Never kill an arbitrary PID. A stale state can only be removed if its PID is gone.
      try {
        process.kill(state.pid, 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          await unlink(statePath);
          state = null;
        } else throw error;
      }
      if (state)
        throw new Error(
          'Preview is starting or control cannot be verified. Check logs; no process was killed.',
        );
    }
    if (state && command === 'stop') {
      await control(state, 'stop');
      for (let i = 0; i < 120; i++) {
        try {
          await stat(statePath);
        } catch (error) {
          if (missing(error)) {
            console.log('Stopped. Data and media are preserved.');
            return;
          }
          throw error;
        }
        await delay(250);
      }
      console.log('Stopping: waiting for the current worker step. Run status later; no forced termination.');
      return;
    }
    if (state) {
      console.log(
        `${current.stopping ? 'Stopping' : current.ready ? 'Running' : 'Starting'}: ${origin(state.port)}`,
      );
      if (command === 'start' && current.ready) openBrowser(state.port);
      return;
    }
  }
  if (command !== 'start') {
    console.log('Stopped.');
    return;
  }
  const lock = resolve(data, 'preview-start.lock');
  try {
    await writeFile(lock, String(process.pid), { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = Number(await readFile(lock, 'utf8'));
    if (!Number.isInteger(previous) || previous <= 0)
      throw new Error('Invalid preview-start.lock; inspect it locally.');
    try {
      process.kill(previous, 0);
      throw new Error('Another start is in progress. Please wait.');
    } catch (aliveError) {
      if (aliveError.code !== 'ESRCH') throw aliveError;
      await unlink(lock);
      await writeFile(lock, String(process.pid), { flag: 'wx' });
    }
  }
  try {
    await available(config.webPort);
    await available(config.apiPort);
    await writeFile(
      resolve(data, 'FIRST-START.txt'),
      `Open ${origin(config.webPort)}\r\nInitialization key (only needed once):\r\n${config.setupToken}\r\nChoose your own name, email, workspace and 8-16 character password.\r\nKeep preview-config.json with your data backups; it contains the encryption key.\r\n`,
      { mode: 0o600 },
    );
    const log = await import('node:fs').then(({ openSync }) =>
      openSync(resolve(data, 'logs/launcher.log'), 'a'),
    );
    const supervisor = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    await new Promise((done, reject) => {
      supervisor.once('spawn', done);
      supervisor.once('error', reject);
    });
    supervisor.unref();
    const deadline = Date.now() + 65000;
    for (;;) {
      try {
        const running = await control(await json(statePath), 'status');
        if (running.ready) {
          console.log(
            `Running: ${origin(config.webPort)}\nFirst setup: ${resolve(data, 'FIRST-START.txt')}\nStop: double-click stop.cmd. Closing the browser does not stop the server.`,
          );
          openBrowser(config.webPort);
          return;
        }
      } catch {
        /* supervisor writes identity before listening */
      }
      if (supervisor.exitCode !== null || Date.now() > deadline)
        throw new Error('Startup failed. See data/logs/launcher.log and api.log.');
      await delay(250);
    }
  } finally {
    await unlink(lock);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
