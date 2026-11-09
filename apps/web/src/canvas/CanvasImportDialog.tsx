import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Dialog } from '../components/Dialog';
import { StudioButton } from '../shared/ui/StudioUI';
import { uploadProjectMedia, mediaFileAccept, type MediaStatus, type UploadAttempt } from '../media-upload';
import type { MediaVersion } from '../media-types';
import type { BoardNode } from '../../../../packages/contracts/src/board';
import '../features/canvas/studio-import.css';

type Item = {
  id: string;
  file: File;
  attempt: UploadAttempt;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
  message: string;
};

export function CanvasImportDialog({
  projectId,
  files,
  position,
  onImported,
  onComplete,
  onClose,
}: {
  projectId: string;
  files: File[];
  position?: BoardNode['position'];
  onImported: (media: MediaVersion, position?: BoardNode['position']) => Promise<void>;
  onComplete: () => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      attempt: { key: crypto.randomUUID() },
      state: 'waiting',
      message: '等待导入',
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const live = useRef(true);
  const abort = useRef<AbortController | undefined>(undefined);
  const callbacks = useRef({ onImported, onComplete });
  callbacks.current = { onImported, onComplete };
  function patch(id: string, state: Item['state'], message: string) {
    if (live.current)
      setItems((current) => current.map((item) => (item.id === id ? { ...item, state, message } : item)));
  }
  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    let complete = true;
    try {
      const [access, status] = await Promise.all([
        api<{ canEdit: boolean }>(`/projects/${projectId}/access`),
        api<MediaStatus>(`/projects/${projectId}/media-status`),
      ]);
      if (!access.canEdit) throw new Error('当前项目不可编辑。');
      if (!status.available) throw new Error(status.error?.message || '媒体处理暂不可用，请稍后重试。');
      for (const [index, item] of items.entries()) {
        if (item.state === 'done') continue;
        controller.signal.throwIfAborted();
        try {
          const extension = item.file.name.slice(item.file.name.lastIndexOf('.')).toLowerCase();
          if (!mediaFileAccept.split(',').includes(extension))
            throw new Error('不支持此文件格式，请导入图片、视频或音频。');
          if (item.file.size === 0 || item.file.size > status.maxBytes)
            throw new Error(`文件为空或超过 ${Math.round(status.maxBytes / 1048576)} MiB 限制。`);
          patch(item.id, 'uploading', '正在上传、检测和归档…');
          const upload = await uploadProjectMedia({
            projectId,
            file: item.file,
            attempt: item.attempt,
            signal: controller.signal,
            reconcile: true,
            addToLibrary: false,
            onSession: (session) =>
              patch(
                item.id,
                'uploading',
                session.state === 'complete' ? '正在加入画布…' : '正在上传、检测和归档…',
              ),
          });
          if (!live.current) return;
          if (!upload.mediaVersion) throw new Error('归档尚未完成，请重试读取状态。');
          await callbacks.current.onImported(
            upload.mediaVersion,
            position && {
              x: position.x + (index % 2) * 450,
              y: position.y + Math.floor(index / 2) * 500,
            },
          );
          patch(item.id, 'done', '已加入画布');
        } catch (reason) {
          complete = false;
          patch(
            item.id,
            'failed',
            controller.signal.aborted
              ? '已停止等待，可继续导入。'
              : reason instanceof Error
                ? reason.message
                : '导入失败，请重试。',
          );
        }
      }
      if (complete && live.current) callbacks.current.onComplete();
    } catch (reason) {
      if (live.current)
        setError(
          controller.signal.aborted
            ? '已停止等待，已保存文件保留，可继续导入到画布。'
            : reason instanceof Error
              ? reason.message
              : '导入失败',
        );
    } finally {
      running.current = false;
      if (live.current) setBusy(false);
    }
  }
  useEffect(() => {
    live.current = true;
    const timer = setTimeout(() => void run(), 0);
    return () => {
      live.current = false;
      clearTimeout(timer);
      abort.current?.abort();
    };
  }, []);
  return (
    <Dialog
      title="导入到画布"
      description="文件保存后加入画布草稿；需要收藏时，再从节点顶部的素材库主动保存。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <div className="v2-import-list" aria-live="polite">
          {items.map((item) => (
            <article key={item.id} data-state={item.state}>
              <strong>{item.file.name}</strong>
              <span>{(item.file.size / 1048576).toFixed(2)} MiB</span>
              <p role={item.state === 'failed' ? 'alert' : 'status'}>{item.message}</p>
            </article>
          ))}
        </div>
      </div>
      <div className="dialog-footer">
        {busy ? (
          <StudioButton onClick={() => abort.current?.abort()}>停止等待</StudioButton>
        ) : (
          <>
            <StudioButton onClick={onClose}>关闭导入</StudioButton>
            <StudioButton variant="primary" onClick={() => void run()}>
              重试未完成
            </StudioButton>
          </>
        )}
      </div>
    </Dialog>
  );
}
