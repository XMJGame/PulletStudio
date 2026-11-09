import { api, uploadMediaContent } from './api';
import type { MediaUpload } from './media-types';

export type MediaStatus = {
  available: boolean;
  maxBytes: number;
  error?: { message: string };
  formats?: string;
};

export type UploadAttempt = { key: string; session?: MediaUpload };
export const mediaFileAccept = '.png,.jpg,.jpeg,.webp,.mp4,.mov,.m4a,.webm,.wav,.mp3,.ogg,.opus';

export async function uploadProjectMedia({
  projectId,
  file,
  attempt,
  signal,
  onSession,
  assetId = null,
  expectedAssetVersion = 0,
  reconcile = false,
  addToLibrary = true,
}: {
  projectId: string;
  file: File;
  attempt: UploadAttempt;
  signal: AbortSignal;
  onSession: (session: MediaUpload) => void;
  assetId?: string | null;
  expectedAssetVersion?: number;
  reconcile?: boolean;
  addToLibrary?: boolean;
}): Promise<MediaUpload> {
  const accept = (session: MediaUpload) => {
    attempt.session = session;
    onSession(session);
    return session;
  };
  let observing = true;
  const poll = setInterval(() => {
    if (attempt.session)
      void api<MediaUpload>(`/media-uploads/${attempt.session.id}`)
        .then((session) => {
          if (observing) onSession(session);
        })
        .catch(() => undefined);
  }, 2000);
  try {
    signal.throwIfAborted();
    if (!attempt.session)
      accept(
        await api<MediaUpload>(
          `/projects/${projectId}/media-uploads`,
          'POST',
          {
            fileName: file.name,
            byteLength: file.size,
            contentType: file.type,
            assetId,
            expectedAssetVersion,
            ...(addToLibrary ? {} : { addToLibrary: false }),
          },
          { 'Idempotency-Key': attempt.key },
        ),
      );
    signal.throwIfAborted();
    const session = accept(await api<MediaUpload>(`/media-uploads/${attempt.session!.id}`));
    if (session.state === 'complete') return session;
    if (session.state === 'needs_reconciliation' && reconcile)
      return accept(await api<MediaUpload>(`/media-uploads/${session.id}/reconcile`, 'POST', {}));
    if (!['created', 'failed'].includes(session.state))
      throw new Error(
        session.state === 'needs_reconciliation'
          ? '文件已归档但登记未完成，请重试登记。'
          : '此上传仍在执行，请查看状态后重试。',
      );
    signal.throwIfAborted();
    return accept(await uploadMediaContent<MediaUpload>(session.id, file, signal));
  } catch (reason) {
    if (attempt.session) {
      try {
        const latest = accept(await api<MediaUpload>(`/media-uploads/${attempt.session.id}`));
        if (latest.state === 'complete') return latest;
      } catch {
        // The next attempt reads the durable upload using the same request key.
      }
    }
    throw reason instanceof TypeError ? new Error('连接中断，重试将读取现有上传状态。') : reason;
  } finally {
    observing = false;
    clearInterval(poll);
  }
}
