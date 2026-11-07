import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { MediaVersion } from '../media-types';
import { Dialog } from './Dialog';
import { StudioButton } from '../shared/ui/StudioUI';
import './video-frame-dialog.css';

export function VideoFrameButton({
  mediaId,
  onSaved,
  onAdd,
}: {
  mediaId: string;
  onSaved?: () => void;
  onAdd?: (media: MediaVersion) => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [initial, setInitial] = useState(0);
  return (
    <>
      <StudioButton
        variant="ghost"
        onClick={() => {
          let at = 0;
          document.querySelectorAll<HTMLMediaElement>('video,audio').forEach((player) => {
            if (player.getAttribute('src')?.includes(`/media-versions/${mediaId}/`)) at = player.currentTime;
            player.pause();
          });
          setInitial(at);
          setOpen(true);
        }}
      >
        提取视频画面
      </StudioButton>
      {open && (
        <VideoFrameDialog
          key={mediaId}
          mediaId={mediaId}
          initialSeconds={initial}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
          onAdd={onAdd}
        />
      )}
    </>
  );
}
export function VideoFrameDialog({
  mediaId,
  initialSeconds = 0,
  onClose,
  onSaved,
  onAdd,
}: {
  mediaId: string;
  initialSeconds?: number;
  onClose: () => void;
  onSaved?: () => void;
  onAdd?: (media: MediaVersion) => Promise<void>;
}) {
  const [media, setMedia] = useState<MediaVersion>(),
    [at, setAt] = useState(0),
    [duration, setDuration] = useState(0),
    [ready, setReady] = useState(false),
    [seeking, setSeeking] = useState(false),
    [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [broken, setBroken] = useState(false);
  const [frame, setFrame] = useState<{ url: string; sha256: string; atMs: number; key: string }>(),
    [saved, setSaved] = useState<MediaVersion>();
  const video = useRef<HTMLVideoElement>(null),
    url = useRef<string | undefined>(undefined),
    alive = useRef(true),
    request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    void api<MediaVersion>(`/media-versions/${mediaId}`)
      .then((value) => {
        if (alive.current) setMedia(value);
      })
      .catch((reason) => {
        if (alive.current) setError(reason.message);
      });
    return () => {
      alive.current = false;
      request.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, [mediaId]);
  useEffect(() => {
    const player = video.current;
    if (!player || !media) return;
    if (player.getAttribute('src') !== media.contentUrl) {
      player.src = media.contentUrl;
      player.load();
    }
    return () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
    };
  }, [media]);
  const max = Math.max(0, Math.round(duration * 1000) - 1);
  const fps = media?.metadata.frameRate?.split('/').map(Number),
    rate = fps?.length === 2 ? fps[0] / fps[1] : NaN;
  const step = Number.isFinite(rate) && rate > 0 ? Math.max(1, Math.round(1000 / rate)) : 40;
  function clearFrame() {
    if (url.current) {
      URL.revokeObjectURL(url.current);
      url.current = undefined;
    }
    setFrame(undefined);
    setSaved(undefined);
    setMessage('');
  }
  function seek(ms: number) {
    const player = video.current;
    if (!player || busy) return;
    player.pause();
    clearFrame();
    setError('');
    setAt(Math.max(0, Math.min(max, ms)));
    setSeeking(true);
    player.currentTime = Math.max(0, Math.min(max, ms)) / 1000;
    if (!player.seeking) setSeeking(false);
  }
  async function extract() {
    const player = video.current;
    if (!player || busy || !ready || seeking) return;
    player.pause();
    const atMs = Math.min(max, Math.max(0, Math.round(player.currentTime * 1000)));
    setAt(atMs);
    clearFrame();
    setBusy(true);
    setError('');
    const abort = new AbortController();
    request.current = abort;
    try {
      const response = await fetch(`/api/v1/media-versions/${mediaId}/frame?atMs=${atMs}`, {
        credentials: 'include',
        signal: abort.signal,
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || '提帧失败');
      }
      const hash = response.headers.get('X-Content-SHA256');
      if (!hash || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('提帧校验信息缺失，请重试');
      const bytes = await response.blob();
      if (!alive.current) return;
      const image = URL.createObjectURL(bytes);
      url.current = image;
      setFrame({ url: image, sha256: hash, atMs, key: crypto.randomUUID() });
      setMessage('已提取画面，确认后保存为参考图。');
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '提帧失败，请重试');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (!frame || busy) return;
    setBusy(true);
    setError('');
    try {
      const value = await api<MediaVersion>(
        `/media-versions/${mediaId}/frames`,
        'POST',
        { atMs: frame.atMs, expectedSha256: frame.sha256 },
        { 'Idempotency-Key': frame.key },
      );
      if (!alive.current) return;
      setSaved(value);
      setMessage('已保存到项目素材库，可作为首帧或参考图。');
      onSaved?.();
    } catch (reason) {
      if (alive.current)
        setError(`${reason instanceof Error ? reason.message : '保存未确认'}。画面已保留，可重试保存。`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Dialog
      title="视频提帧"
      description="拖动进度选画面，提取预览后再保存为参考图。原视频保持不变。"
      busy={busy}
      onClose={onClose}
      className={`video-frame-dialog${frame ? ' has-frame' : ''}`}
    >
      <div className="dialog-body">
        {media && <p className="field-hint">{media.fileName}</p>}
        {media && !broken && (
          <video
            ref={video}
            src={media.contentUrl}
            aria-label="选帧视频预览"
            preload="metadata"
            playsInline
            muted
            onLoadedMetadata={(event) => {
              const player = event.currentTarget;
              const length = player.duration;
              if (Number.isFinite(length) && length > 0) {
                setDuration(length);
                setReady(true);
                const time = Math.min(Math.max(0, initialSeconds), Math.max(0, length - 0.001));
                player.currentTime = time;
                setAt(Math.round(time * 1000));
              }
            }}
            onTimeUpdate={(event) => {
              const ms = Math.round(event.currentTarget.currentTime * 1000);
              setAt(Math.min(max, ms));
              if (frame && ms !== frame.atMs) clearFrame();
            }}
            onSeeking={() => setSeeking(true)}
            onSeeked={() => {
              setSeeking(false);
              setReady(true);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onError={() => {
              setBroken(true);
              setReady(false);
              setError('视频无法预览，请检查原件、权限或浏览器编码。');
            }}
          />
        )}
        <label>
          拖动选帧
          <input
            type="range"
            aria-label="视频选帧进度"
            aria-valuetext={time(at)}
            min={0}
            max={max}
            step={1}
            value={at}
            disabled={busy || !ready || broken}
            onChange={(event) => seek(Number(event.target.value))}
          />
        </label>
        <div className="video-frame-controls">
          <span aria-live="off">
            {time(at)} / {time(Math.round(duration * 1000))}
          </span>
          <StudioButton
            disabled={busy || !ready || broken}
            onClick={() => {
              const player = video.current;
              if (!player) return;
              if (player.paused) {
                clearFrame();
                void player.play().catch(() => setError('播放未启动，请重新选择位置。'));
              } else player.pause();
            }}
          >
            {playing ? '暂停' : '播放'}
          </StudioButton>
          <StudioButton disabled={busy || !ready || at <= 0} onClick={() => seek(at - step)}>
            向前微调
          </StudioButton>
          <StudioButton disabled={busy || !ready || at >= max} onClick={() => seek(at + step)}>
            向后微调
          </StudioButton>
        </div>
        <p className="field-hint">
          可拖动或用方向键定位，微调约 {step} 毫秒。先暂停再提取，实际保存以下提取画面。
        </p>
        <StudioButton disabled={busy || !ready || seeking || broken} onClick={() => void extract()}>
          {busy && !frame ? '正在提取…' : '提取画面'}
        </StudioButton>
        {frame && (
          <figure className="video-frame-still">
            <img src={frame.url} alt="提取画面预览" />
            <figcaption>
              {time(frame.atMs)} · {saved ? '已保存的画面' : '待保存的静态画面'}
            </figcaption>
          </figure>
        )}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <div className="dialog-footer">
        <StudioButton disabled={busy} onClick={onClose}>
          关闭
        </StudioButton>
        {saved && onAdd && (
          <StudioButton
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void onAdd(saved)
                .then(() => setMessage('已加入画布草稿，请保存画布。'))
                .catch((reason) => setError(reason.message || '图片已入库，可稍后从资源库添加。'))
                .finally(() => setBusy(false));
            }}
          >
            加入画布
          </StudioButton>
        )}
        <StudioButton
          variant="primary"
          disabled={busy || !frame || Boolean(saved)}
          onClick={() => void save()}
        >
          {saved ? '已保存参考图' : '保存为参考图'}
        </StudioButton>
      </div>
    </Dialog>
  );
}
function time(ms: number) {
  return `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, '0')}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;
}
