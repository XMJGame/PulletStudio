import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { CurrentUser, fail } from '../common/http';
import { AppConfig } from '../config';
import { DatabaseService } from '../db/database.service';
import { mediaFrameExtractions } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { MediaService } from './media.service';
import { MediaProbe } from './media-probe';
import { frameSource } from './frame-extraction-state';
import { StorageFailure } from '../storage/local-storage';

const execute = promisify(execFile);
export const frameMaxBytes = 16 * 1024 * 1024;
@Injectable()
export class VideoFrameService {
  private active = 0;
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly media: MediaService,
    private readonly probe: MediaProbe,
    private readonly config: AppConfig,
  ) {}
  async extract(user: CurrentUser, sourceId: string, atMs: number, signal?: AbortSignal) {
    const source = frameSource(this.database, this.authz, user, sourceId, atMs);
    if (this.active >= 2) fail(429, 'FRAME_BUSY', '当前提帧任务较多，请稍后重试');
    this.active++;
    let directory: string | undefined;
    const timeout = AbortSignal.timeout(45000),
      stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      await this.probe.ready();
      if (stop.aborted) throw stop.reason;
      directory = await mkdtemp(join(tmpdir(), 'pullet-frame-'));
      const input = join(directory, 'source.bin');
      const file = await this.media.content(user, source.id, false);
      const hash = createHash('sha256');
      let copied = 0;
      const checked = new Transform({
        transform(chunk: Buffer, _encoding, done) {
          copied += chunk.length;
          hash.update(chunk);
          done(null, chunk);
        },
      });
      await pipeline(file.stream, checked, createWriteStream(input, { flags: 'wx', mode: 0o600 }), {
        signal: stop,
      });
      if (copied !== source.byteLength || hash.digest('hex') !== source.sha256)
        throw new StorageFailure('MEDIA_INTEGRITY_FAILED', '视频在读取过程中变化，请核对原件后重试');
      frameSource(this.database, this.authz, user, sourceId, atMs);
      const { stdout } = await execute(
        this.config.ffmpegPath,
        [
          '-nostdin',
          '-v',
          'error',
          '-threads',
          '1',
          '-protocol_whitelist',
          'file,pipe',
          '-format_whitelist',
          'mov,matroska,webm',
          '-ss',
          (atMs / 1000).toFixed(3),
          '-i',
          input,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-an',
          '-sn',
          '-dn',
          '-map_metadata',
          '-1',
          '-threads',
          '1',
          '-c:v',
          'png',
          '-f',
          'image2pipe',
          'pipe:1',
        ],
        { windowsHide: true, timeout: 30000, maxBuffer: frameMaxBytes, encoding: 'buffer', signal: stop },
      );
      if (!stdout.length || !stdout.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new StorageFailure('FRAME_EMPTY', '当前位置没有可解码画面，请稍向前拖动后重试');
      frameSource(this.database, this.authz, user, sourceId, atMs);
      return { bytes: stdout, sha256: createHash('sha256').update(stdout).digest('hex'), atMs };
    } catch (error) {
      if (
        error instanceof StorageFailure ||
        typeof (error as { getStatus?: unknown })?.getStatus === 'function'
      )
        throw error;
      if (stop.aborted) throw new StorageFailure('FRAME_INTERRUPTED', '提帧已中断或超时，请重试');
      throw new StorageFailure(
        'FRAME_DECODE_FAILED',
        '无法提取当前位置，可能接近视频结尾或编码不受支持，请稍向前拖动重试',
      );
    } finally {
      this.active--;
      if (directory) {
        if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('pullet-frame-'))
          throw new Error('Unexpected frame temporary path');
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
  async save(user: CurrentUser, sourceId: string, atMs: number, expectedSha256: string, key: string) {
    const source = frameSource(this.database, this.authz, user, sourceId, atMs);
    const record = this.database.db.transaction(
      () => {
        const replay = this.database.db
          .select()
          .from(mediaFrameExtractions)
          .where(
            and(
              eq(mediaFrameExtractions.projectId, source.projectId),
              eq(mediaFrameExtractions.createdBy, user.id),
              eq(mediaFrameExtractions.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (
            replay.sourceVersionId !== sourceId ||
            replay.atMs !== atMs ||
            replay.expectedSha256 !== expectedSha256
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于另一张画面');
          return replay;
        }
        return this.database.db
          .insert(mediaFrameExtractions)
          .values({
            id: randomUUID(),
            sourceVersionId: sourceId,
            atMs,
            expectedSha256,
            projectId: source.projectId,
            workspaceId: source.workspaceId,
            createdBy: user.id,
            requestKey: key,
          })
          .returning()
          .get();
      },
      { behavior: 'immediate' },
    );
    if (record.uploadId) {
      const existing = await this.media.upload(user, record.uploadId);
      if (existing.state === 'complete') return existing.mediaVersion;
      if (existing.state === 'needs_reconciliation')
        return (await this.media.reconcile(user, existing.id, undefined, undefined, record.id)).mediaVersion;
      if (existing.state === 'uploading') fail(409, 'FRAME_SAVING', '当前画面正在保存，请稍后重试');
    }
    const extracted = await this.extract(user, sourceId, atMs);
    if (extracted.sha256 !== expectedSha256)
      fail(409, 'FRAME_CONTENT_CHANGED', '提取画面与已确认预览不一致，请重新提取后保存');
    const upload = await this.media.initiate(
      user,
      source.projectId,
      {
        fileName: `frame-${atMs}ms-${record.id}.png`,
        byteLength: extracted.bytes.length,
        contentType: 'image/png',
        assetId: null,
        expectedAssetVersion: 0,
      },
      'frame:' + record.id,
      undefined,
      undefined,
      undefined,
      record.id,
    );
    if (upload.state === 'complete') return upload.mediaVersion;
    const saved = await this.media.receive(
      user,
      upload.id,
      Readable.from([extracted.bytes]),
      String(extracted.bytes.length),
      { mediaType: 'image', signal: new AbortController().signal, frameId: record.id },
    );
    return saved.mediaVersion;
  }
}
