import { execFileSync } from 'node:child_process';
import { cp, mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { resolve, dirname, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
export async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Refusing package symlink: ${path}`);
    if (item.isDirectory()) result.push(...(await files(path)));
    else if (item.isFile()) result.push(path);
  }
  return result.sort();
}

export async function packagePreview(output) {
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new Error('This preview packager targets Windows x64.');
  output = resolve(output);
  if (existsSync(output) || existsSync(`${output}.zip`))
    throw new Error('Output already exists; choose a new version directory.');
  const runtime = resolve(root, 'data/tools/ffmpeg');
  const nodeLicense = resolve(root, 'data/tools/node/LICENSE');
  if (!existsSync(nodeLicense))
    throw new Error(
      `Save https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE to data/tools/node/LICENSE before packaging.`,
    );
  for (const path of [
    'apps/api/dist/main.js',
    'apps/api/dist/generation-worker.js',
    'apps/web/dist/index.html',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  ])
    if (!existsSync(resolve(root, path))) throw new Error(`Build/install first: missing ${path}`);
  for (const path of ['bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE', 'README.txt'])
    if (!existsSync(resolve(runtime, path))) throw new Error(`Missing media runtime: ${path}`);
  await mkdir(output, { recursive: true });
  const copy = async (source, target = source, options = {}) => {
    await mkdir(dirname(resolve(output, target)), { recursive: true });
    await cp(resolve(root, source), resolve(output, target), { recursive: true, ...options });
  };
  // Explicit allowlist. Never copy the repository's data/, .env, or entire tree.
  await copy('apps/api/dist', 'apps/api/dist', { filter: (path) => !/\.(map|ts)$/.test(path) });
  await copy('apps/api/package.json');
  await copy('apps/web/dist');
  await copy('apps/api/drizzle', 'apps/api/drizzle', {
    filter: (path) => !path.endsWith('.json') || path.endsWith('_journal.json'),
  });
  for (const path of ['tools/local-preview.mjs', 'tools/local-child.cjs']) await copy(path);
  await copy('docs/operations/LOCAL-PREVIEW.md', '使用说明.md');
  await mkdir(resolve(output, 'runtime/ffmpeg'), { recursive: true });
  await cp(process.execPath, resolve(output, 'runtime/node.exe'));
  await cp(nodeLicense, resolve(output, 'runtime/NODE-LICENSE.txt'));
  for (const path of ['bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE', 'README.txt'])
    await cp(resolve(runtime, path), resolve(output, `runtime/ffmpeg/${basename(path)}`));
  const npm =
    process.platform === 'win32'
      ? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
      : 'npm';
  const dependencies = execFileSync(
    process.execPath,
    [npm, 'ls', '--omit=dev', '--all', '--parseable', '--workspace', '@pullet-studio/api'],
    { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
  )
    .trim()
    .split(/\r?\n/)
    .map((path) => resolve(path));
  const dependencyRoot = resolve(root, 'node_modules') + sep;
  const selected = dependencies.filter(
    (path) => path.startsWith(dependencyRoot) && !path.includes(`${sep}@pullet-studio${sep}`),
  );
  for (const path of selected) {
    if (selected.some((parent) => parent !== path && path.startsWith(parent + sep))) continue;
    await copy(relative(root, path));
  }
  const version = {
    sourceCommit: git('rev-parse', 'HEAD'),
    branch: git('branch', '--show-current'),
    builtAt: new Date().toISOString(),
    node: process.version,
    platform: 'win32-x64',
    sourceDirty: Boolean(git('status', '--porcelain')),
  };
  await writeFile(resolve(output, 'VERSION.json'), JSON.stringify(version, null, 2));
  await writeFile(
    resolve(output, 'THIRD-PARTY.txt'),
    'Node.js license: runtime/NODE-LICENSE.txt\r\nFFmpeg/FFprobe: independent executables; original build/source information and GPL license are in runtime/ffmpeg/README.txt and LICENSE.\r\nAPI dependencies retain their package.json and license files in node_modules.\r\nThis local preview is not a hosted production or public binary release.\r\n',
  );
  for (const command of ['start', 'stop', 'status']) {
    const content = `@echo off\r\ncd /d "%~dp0"\r\n"%~dp0runtime\\node.exe" "%~dp0tools\\local-preview.mjs" ${command}${command === 'start' ? ' --open' : ''}\r\nif errorlevel 1 (\r\n  echo See data\\logs for details.\r\n  pause\r\n  exit /b 1\r\n)\r\npause\r\n`;
    await writeFile(resolve(output, `${command}.cmd`), content);
  }
  const manifest = [];
  for (const path of await files(output)) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    manifest.push({
      path: relative(output, path).split(sep).join('/'),
      bytes: (await stat(path)).size,
      sha256: hash.digest('hex'),
    });
  }
  await writeFile(resolve(output, 'FILES.json'), JSON.stringify(manifest));
  const zip = new yazl.ZipFile();
  const zipped = pipeline(zip.outputStream, createWriteStream(`${output}.zip`, { flags: 'wx' }));
  for (const path of await files(output))
    zip.addFile(path, `${basename(output)}/${relative(output, path).split(sep).join('/')}`);
  zip.end();
  await zipped;
  return {
    directory: output,
    zip: `${output}.zip`,
    files: manifest.length,
    bytes: (await stat(`${output}.zip`)).size,
    ...version,
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const output =
      process.argv[2] ||
      resolve(root, `data/releases/PulletStudio-preview-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    console.log(JSON.stringify(await packagePreview(output), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
