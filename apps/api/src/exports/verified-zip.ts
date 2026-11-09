import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { ZipFile } from 'yazl';
import { CurrentUser, fail } from '../common/http';
import { MediaService } from '../assets/media.service';

export const packageExtensions: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
};
export type ZipSource = { path: string; mediaVersionId: string; byteLength: number; sha256: string };
type ZipDocument = { path: string; content: string; byteLength: number; sha256: string };

export async function verifyZipFiles(
  media: MediaService,
  user: CurrentUser,
  files: ZipSource[],
  signal?: AbortSignal,
) {
  for (const file of files) {
    if (signal?.aborted) fail(409, 'PACKAGE_DOWNLOAD_ABORTED', '素材包下载已中断');
    const opened = await media.content(user, file.mediaVersionId, false);
    await new Promise<void>((resolve, reject) => {
      opened.stream.once('close', resolve);
      opened.stream.once('error', reject);
      opened.stream.destroy();
    });
    if (opened.sha256 !== file.sha256 || opened.length !== file.byteLength)
      fail(409, 'PACKAGE_MEDIA_CHANGED', '原件与交付清单不一致');
  }
  if (signal?.aborted) fail(409, 'PACKAGE_DOWNLOAD_ABORTED', '素材包下载已中断');
}

export async function streamVerifiedZip<T extends ZipSource>(input: {
  media: MediaService;
  user: CurrentUser;
  files: T[];
  manifestJson: string;
  documents?: ZipDocument[];
  authorize: (file: T) => void;
  signal?: AbortSignal;
}) {
  const { media, user, files, manifestJson, documents = [], authorize, signal } = input;
  if (signal?.aborted) fail(409, 'PACKAGE_DOWNLOAD_ABORTED', '素材包下载已中断');
  for (const document of documents)
    if (
      Buffer.byteLength(document.content) !== document.byteLength ||
      createHash('sha256').update(document.content).digest('hex') !== document.sha256
    )
      fail(409, 'PACKAGE_DOCUMENT_INVALID', '固定交付文档与清单不一致');
  const zip = new ZipFile(),
    output = zip.outputStream as Readable;
  let active: Readable | undefined;
  let closed = false;
  zip.on('error', (error) => output.destroy(error));
  const abort = () => output.destroy();
  signal?.addEventListener('abort', abort, { once: true });
  output.once('close', () => {
    closed = true;
    active?.destroy();
    signal?.removeEventListener('abort', abort);
  });
  const options = { compress: false, mtime: new Date(2000, 0, 1), mode: 0o100644, forceDosTimestamp: true };
  zip.addBuffer(Buffer.from(manifestJson), 'manifest.json', options);
  for (const document of documents)
    zip.addBuffer(Buffer.from(document.content, 'utf8'), document.path, options);
  for (const file of files) {
    zip.addReadStreamLazy(file.path, { ...options, size: file.byteLength }, (callback) => {
      void media
        .content(user, file.mediaVersionId, false)
        .then((source) => {
          if (closed) {
            source.stream.destroy();
            throw new Error('Download closed');
          }
          try {
            authorize(file);
          } catch (error) {
            source.stream.destroy();
            throw error;
          }
          const hash = createHash('sha256');
          let bytes = 0;
          const checked = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              bytes += chunk.length;
              hash.update(chunk);
              done(null, chunk);
            },
            flush(done) {
              try {
                authorize(file);
                if (bytes !== file.byteLength || hash.digest('hex') !== file.sha256)
                  throw new Error('Media integrity changed');
                done();
              } catch (error) {
                done(error as Error);
              }
            },
          });
          active = checked;
          checked.on('error', (error) => output.destroy(error));
          source.stream.on('error', (error) => checked.destroy(error));
          checked.once('close', () => source.stream.destroy());
          source.stream.pipe(checked);
          callback(null, checked);
        })
        .catch((error) => callback(error, Readable.from([])));
    });
  }
  const length = await new Promise<number>((resolve, reject) => {
    output.once('error', reject);
    zip.end(undefined, (size?: number) => {
      if (size === undefined || size < 0) {
        output.destroy();
        reject(new Error('ZIP length unavailable'));
      } else resolve(size);
    });
  });
  return { stream: output, length };
}
