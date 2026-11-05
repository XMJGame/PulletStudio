import { Injectable } from '@nestjs/common';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppConfig } from '../config';
import type { StorageProvider } from '../../../../packages/contracts/src/storage-port';

export class StorageFailure extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const sessionPattern = new RegExp(`^${uuid}$`),
  keyPattern = new RegExp(
    `^(staging/${uuid}|workspaces/${uuid}/projects/${uuid}/objects/${uuid})/(original\\.bin|poster\\.jpg)$`,
  );
const normalize = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);
export const objectPrefix = (workspaceId: string, projectId: string, versionId: string) =>
  `workspaces/${workspaceId}/projects/${projectId}/objects/${versionId}`;
const signature = (stat: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }) =>
  `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
@Injectable()
export class LocalStorage implements StorageProvider {
  readonly kind = 'local';
  private initialization: Promise<string> | undefined;
  private readonly verified = new Map<string, string>();
  constructor(private readonly config: AppConfig) {}
  private async directory(path: string, create = false) {
    const absolute = resolve(path),
      anchor = parse(absolute).root;
    let current = anchor;
    for (const segment of relative(anchor, absolute).split(sep).filter(Boolean)) {
      current = resolve(current, segment);
      if (create)
        try {
          await mkdir(current, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new StorageFailure('STORAGE_PATH_UNSAFE', '存储路径不是受控的普通目录');
    }
    if (normalize(await realpath(absolute)) !== normalize(absolute))
      throw new StorageFailure('STORAGE_PATH_UNSAFE', '存储目录存在重定向');
  }
  async ready() {
    if (!this.initialization)
      this.initialization = this.initialize().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }
  private async initialize() {
    if (resolve(this.config.mediaRoot) === parse(this.config.mediaRoot).root)
      throw new StorageFailure('STORAGE_PATH_UNSAFE', '媒体存储必须使用专用子目录');
    await this.directory(this.config.mediaRoot, true);
    const marker = resolve(this.config.mediaRoot, '.pullet-storage.json');
    try {
      const handle = await open(marker, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify({ schemaVersion: 1, kind: 'local', id: randomUUID() }));
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const stat = await lstat(marker);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2048)
      throw new StorageFailure('STORAGE_MARKER_INVALID', '媒体根标记无效');
    const handle = await open(marker, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const actual = await handle.stat();
      if (signature(stat) !== signature(actual))
        throw new StorageFailure('STORAGE_PATH_CHANGED', '媒体根标记已变化');
      const markerValue = JSON.parse(await handle.readFile('utf8')) as {
        schemaVersion: number;
        kind: string;
        id: string;
      };
      if (
        markerValue.schemaVersion !== 1 ||
        markerValue.kind !== 'local' ||
        !sessionPattern.test(markerValue.id)
      )
        throw new StorageFailure('STORAGE_MARKER_INVALID', '媒体根标记不受支持');
      return markerValue.id;
    } finally {
      await handle.close();
    }
  }
  async path(key: string, createParent = false, skipLeafDirectory = false) {
    await this.ready();
    if (!keyPattern.test(key)) throw new StorageFailure('STORAGE_KEY_INVALID', '媒体对象键不符合约定');
    const target = resolve(this.config.mediaRoot, ...key.split('/')),
      offset = relative(this.config.mediaRoot, target);
    if (offset.startsWith('..') || isAbsolute(offset))
      throw new StorageFailure('STORAGE_KEY_INVALID', '媒体对象越出存储范围');
    await this.directory(skipLeafDirectory ? dirname(dirname(target)) : dirname(target), createParent);
    return target;
  }
  private async opened(key: string) {
    const target = await this.path(key),
      before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
      throw new StorageFailure('STORAGE_PATH_UNSAFE', '媒体对象不是独立普通文件');
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const after = await handle.stat();
      if (signature(before) !== signature(after))
        throw new StorageFailure('STORAGE_PATH_CHANGED', '媒体文件在读取前变化');
      return { handle, stat: after };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  async stat(key: string) {
    try {
      const { handle, stat } = await this.opened(key);
      await handle.close();
      return { bytes: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async digest(key: string) {
    const { handle, stat } = await this.opened(key);
    try {
      const sha256 = await this.hashHandle(handle);
      if (signature(await handle.stat()) !== signature(stat))
        throw new StorageFailure('STORAGE_PATH_CHANGED', '媒体在校验中变化');
      return { key, bytes: stat.size, sha256 };
    } finally {
      await handle.close();
    }
  }
  async prefix(key: string, bytes = 65536) {
    const { handle } = await this.opened(key);
    try {
      const data = Buffer.alloc(bytes);
      const result = await handle.read(data, 0, bytes, 0);
      return data.subarray(0, result.bytesRead);
    } finally {
      await handle.close();
    }
  }
  private async hashHandle(handle: Awaited<ReturnType<typeof open>>) {
    const hash = createHash('sha256'),
      buffer = Buffer.alloc(65536);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return hash.digest('hex');
  }
  async stage(
    sessionId: string,
    body: AsyncIterable<Uint8Array>,
    limits: { bytes: number; timeoutMs: number },
    signal?: AbortSignal,
    onProgress?: (bytes: number) => void,
  ) {
    if (!sessionPattern.test(sessionId)) throw new StorageFailure('STORAGE_KEY_INVALID', '上传标识无效');
    const key = `staging/${sessionId}/original.bin`,
      target = await this.path(key, true);
    const handle = await open(target, 'wx', 0o600);
    let bytes = 0;
    const hash = createHash('sha256');
    const input = Readable.from(body);
    const stop = () => input.destroy(new StorageFailure('UPLOAD_INTERRUPTED', '上传中断或超时'));
    const timer = setTimeout(stop, limits.timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    try {
      if (signal?.aborted) stop();
      for await (const value of input) {
        const chunk = Buffer.from(value as Uint8Array);
        bytes += chunk.length;
        if (bytes > limits.bytes) throw new StorageFailure('UPLOAD_SIZE_MISMATCH', '上传字节超过声明大小');
        hash.update(chunk);
        onProgress?.(bytes);
        let offset = 0;
        while (offset < chunk.length) {
          const result = await handle.write(chunk, offset, chunk.length - offset);
          if (!result.bytesWritten) throw new StorageFailure('STORAGE_WRITE_FAILED', '文件写入未完成');
          offset += result.bytesWritten;
        }
      }
      if (bytes !== limits.bytes)
        throw new StorageFailure('UPLOAD_SIZE_MISMATCH', '实际上传字节与声明大小不一致');
      await handle.sync();
      return { key, bytes, sha256: hash.digest('hex') };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      input.destroy();
      await handle.close();
    }
  }
  async publish(sessionId: string, prefix: string) {
    if (!sessionPattern.test(sessionId)) throw new StorageFailure('STORAGE_KEY_INVALID', '上传标识无效');
    const source = dirname(await this.path(`staging/${sessionId}/original.bin`)),
      target = dirname(await this.path(`${prefix}/original.bin`, true, true));
    await this.directory(dirname(target), true);
    try {
      await lstat(target);
      throw new StorageFailure('STORAGE_OBJECT_EXISTS', '已归档目录已存在，需核对后登记');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(source, target);
  }
  async openVerified(
    key: string,
    expected: { bytes: number; sha256: string },
    range?: { start: number; end: number },
  ) {
    const { handle, stat } = await this.opened(key);
    try {
      if (stat.size !== expected.bytes)
        throw new StorageFailure('MEDIA_INTEGRITY_FAILED', '原件大小与归档记录不一致');
      const cacheKey = `${key}:${signature(stat)}`;
      if (this.verified.get(cacheKey) !== expected.sha256) {
        const hash = await this.hashHandle(handle);
        if (hash !== expected.sha256 || signature(await handle.stat()) !== signature(stat))
          throw new StorageFailure('MEDIA_INTEGRITY_FAILED', '媒体校验失败，未提供变化的原件');
        if (this.verified.size >= 1000) this.verified.clear();
        this.verified.set(cacheKey, expected.sha256);
      }
      return handle.createReadStream({
        start: range?.start ?? 0,
        end: range?.end ?? expected.bytes - 1,
        autoClose: true,
      });
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  async discardStaging(sessionId: string) {
    if (!sessionPattern.test(sessionId)) throw new StorageFailure('STORAGE_KEY_INVALID', '上传标识无效');
    for (const name of ['original.bin', 'poster.jpg'])
      try {
        const key = `staging/${sessionId}/${name}`,
          target = await this.path(key);
        const stat = await lstat(target);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1)
          throw new StorageFailure('STORAGE_PATH_UNSAFE', '临时文件异常，未清理');
        await unlink(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    try {
      await rmdir(resolve(this.config.mediaRoot, 'staging', sessionId));
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
}
