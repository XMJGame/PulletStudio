import { useEffect, useState } from 'react';
import { api, ApiError, CursorPage, ProductionUnit, Shot } from '../api';
import { MediaVersion } from '../media-types';
import { Dialog } from './Dialog';
type SourceClip = {
  shotId: string;
  code: string;
  fileName: string;
  mediaType: string;
  hasAudio: boolean;
  sourceDurationMs: number | null;
  inMs: number;
  durationMs: number;
  audioPolicy: string;
};
type Editor = {
  version: number;
  sourceHash: string;
  ready: boolean;
  profile: string;
  clips: SourceClip[];
  items: { id: string; code: string; ready: boolean; reason: string }[];
};
type Clip = SourceClip & { inText: string; durationText: string };
type Timeline = {
  id: string;
  version: number;
  durationMs: number;
  createdAt: string;
  snapshot?: {
    clips: {
      shotId: string;
      code: string;
      positionMs: number;
      inMs: number;
      durationMs: number;
      audioPolicy: string;
    }[];
  };
};
type Preview = {
  snapshotHash: string;
  snapshot: {
    width: number;
    height: number;
    durationMs: number;
    clips: { shotId: string; code: string; positionMs: number; durationMs: number }[];
  };
};
type Job = {
  id: string;
  state: string;
  errorCode: string | null;
  canControl: boolean;
  media: MediaVersion | null;
};
const states: Record<string, string> = {
  queued: '等待预演 Worker',
  rendering: '正在渲染',
  archiving: '正在归档和登记',
  completed: '预演已归档',
  failed: '预演失败',
  canceled: '已取消',
};
const errors: Record<string, string> = {
  ANIMATIC_INPUT_CHANGED: '源选片或制作内容已变化，请载入当前选片并保存新版本。',
  ANIMATIC_RENDER_FAILED: '渲染未完成，请检查FFmpeg、源文件或重试。',
  ANIMATIC_OUTPUT_INVALID: '预演实际尺寸、时长或音轨校验未通过。',
  MEDIA_INTEGRITY_FAILED: '原件完整性校验失败，请核对媒体存储。',
  MEDIA_DATABASE_CONFLICT: '归档现场已保留，Worker会重试登记。',
};
export function AnimaticDialog({
  projectId,
  units,
  currentUnit,
  selectedShot,
  canEdit,
  onClose,
}: {
  projectId: string;
  units: ProductionUnit[];
  currentUnit?: ProductionUnit;
  selectedShot?: Shot;
  canEdit: boolean;
  onClose: () => void;
}) {
  const [scope, setScope] = useState(selectedShot ? 'shots' : currentUnit ? 'unit' : 'root');
  const [unitId, setUnitId] = useState(currentUnit?.id ?? '');
  const [descendants, setDescendants] = useState(false);
  const [choices, setChoices] = useState<CursorPage<ProductionUnit>>({ items: units, nextCursor: null });
  const [editor, setEditor] = useState<Editor>();
  const [clips, setClips] = useState<Clip[]>([]);
  const [profile, setProfile] = useState('landscape');
  const [preview, setPreview] = useState<Preview>();
  const [history, setHistory] = useState<{ items: Timeline[]; nextCursor: number | null }>({
    items: [],
    nextCursor: null,
  });
  const [revision, setRevision] = useState<Timeline>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [queueKey, setQueueKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const path = `/projects/${projectId}`;
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<typeof history>(path + '/timelines'),
      api<CursorPage<ProductionUnit>>(path + '/units'),
    ])
      .then(([saved, available]) => {
        if (active) {
          setHistory(saved);
          setChoices({
            ...available,
            items: [...new Map([...units, ...available.items].map((unit) => [unit.id, unit])).values()],
          });
        }
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : '读取时间线失败');
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!revision) return;
    let active = true,
      polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void api<Job[]>(`/timelines/${revision.id}/animatics`)
        .then((value) => {
          if (active) setJobs(value);
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [revision?.id]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '时间线操作失败');
      if (failure instanceof ApiError && failure.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  function invalidate() {
    setPreview(undefined);
    setRevision(undefined);
    setJobs([]);
    setError('');
    setConflict(false);
    setKey(crypto.randomUUID());
  }
  function scopeValue() {
    return scope === 'unit'
      ? { type: 'unit', unitId, includeDescendants: descendants }
      : scope === 'shots'
        ? { type: 'shots', shotIds: [selectedShot!.id] }
        : { type: scope };
  }
  function options() {
    return {
      scope: scopeValue(),
      sourceHash: editor!.sourceHash,
      profile,
      clips: clips.map((clip) => ({
        shotId: clip.shotId,
        inMs: Math.round(Number(clip.inText) * 1000),
        durationMs: Math.round(Number(clip.durationText) * 1000),
        audioPolicy: clip.audioPolicy,
      })),
    };
  }
  function change(index: number, values: Partial<Clip>) {
    setClips(clips.map((clip, position) => (position === index ? { ...clip, ...values } : clip)));
    invalidate();
  }
  function move(index: number, direction: number) {
    const reordered = [...clips];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    setClips(reordered);
    invalidate();
  }
  function resetScope() {
    invalidate();
    setEditor(undefined);
    setClips([]);
  }
  return (
    <Dialog
      title="时间线与预演"
      description="按有效选片编排顺序，核对片段和原声后生成低清预演。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <fieldset className="plain-fieldset" disabled={busy}>
          <label>
            预演范围
            <select
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
                resetScope();
              }}
            >
              <option value="project">整个项目</option>
              <option value="root">项目直属镜头</option>
              <option value="unit">指定制作单元</option>
              {selectedShot && <option value="shots">当前镜头 {selectedShot.code}</option>}
            </select>
          </label>
          {scope === 'unit' && (
            <>
              <label>
                预演制作单元
                <select
                  value={unitId}
                  onChange={(event) => {
                    setUnitId(event.target.value);
                    resetScope();
                  }}
                >
                  <option value="">选择制作单元</option>
                  {choices.items.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} · {unit.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={descendants}
                  onChange={(event) => {
                    setDescendants(event.target.checked);
                    resetScope();
                  }}
                />
                包含下级单元
              </label>
              {choices.nextCursor && (
                <button
                  onClick={() =>
                    void run(async () => {
                      const more = await api<CursorPage<ProductionUnit>>(
                        `${path}/units?cursor=${choices.nextCursor}`,
                      );
                      setChoices({
                        ...more,
                        items: [
                          ...new Map(
                            [...choices.items, ...more.items].map((unit) => [unit.id, unit]),
                          ).values(),
                        ],
                      });
                    })
                  }
                >
                  更多预演单元
                </button>
              )}
            </>
          )}
          <button
            disabled={scope === 'unit' && !unitId}
            onClick={() =>
              void run(async () => {
                const value = await api<Editor>(path + '/timeline-editor', 'POST', { scope: scopeValue() });
                setEditor(value);
                setProfile(value.profile);
                setClips(
                  value.clips.map((clip) => ({
                    ...clip,
                    inText: String(clip.inMs / 1000),
                    durationText: String(clip.durationMs / 1000),
                  })),
                );
                invalidate();
              })
            }
          >
            按当前选片载入
          </button>
          <p className="field-hint">载入会替换未保存的片段编辑。首版最多24片段、300秒，按25 fps对齐时长。</p>
        </fieldset>
        {editor && (
          <>
            {editor.items
              .filter((item) => !item.ready)
              .map((item) => (
                <p className="notice" key={item.id}>
                  {item.code} · {item.reason}
                </p>
              ))}
            {clips.some((clip) => clip.mediaType === 'audio') && (
              <p className="notice">画面轨需要图片或视频，请调整声音候选的选片范围。</p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  setPreview(await api<Preview>(path + '/timelines/preview', 'POST', options()));
                  setConflict(false);
                });
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy || !canEdit}>
                <label>
                  预演画幅
                  <select
                    value={profile}
                    onChange={(event) => {
                      setProfile(event.target.value);
                      invalidate();
                    }}
                  >
                    <option value="landscape">16:9 · 640×360</option>
                    <option value="portrait">9:16 · 360×640</option>
                    <option value="square">1:1 · 480×480</option>
                    <option value="classic">4:3 · 640×480</option>
                    <option value="cinema">宽银幕 · 640×272</option>
                  </select>
                </label>
                {clips.map((clip, index) => (
                  <article className="revision-item" key={clip.shotId}>
                    <strong>
                      {index + 1}. {clip.code} · {clip.fileName}
                    </strong>
                    <p className="field-hint">
                      {clip.mediaType === 'image'
                        ? '静帧图片'
                        : `原件 ${((clip.sourceDurationMs ?? 0) / 1000).toFixed(3)} 秒`}{' '}
                      · {clip.hasAudio ? '含原声音轨' : '无原声音轨'}
                    </p>
                    <div className="dialog-field-row">
                      <label>
                        入点（秒）
                        <input
                          aria-label={`${clip.code} 入点（秒）`}
                          type="number"
                          min="0"
                          step="0.001"
                          required
                          disabled={clip.mediaType === 'image'}
                          value={clip.inText}
                          onChange={(event) => change(index, { inText: event.target.value })}
                        />
                      </label>
                      <label>
                        片段时长（秒）
                        <input
                          aria-label={`${clip.code} 片段时长（秒）`}
                          type="number"
                          min="0.04"
                          max="300"
                          step="0.001"
                          required
                          value={clip.durationText}
                          onChange={(event) => change(index, { durationText: event.target.value })}
                        />
                      </label>
                    </div>
                    <label>
                      预演原声
                      <select
                        aria-label={`${clip.code} 预演原声`}
                        required
                        disabled={!clip.hasAudio}
                        value={clip.audioPolicy}
                        onChange={(event) => change(index, { audioPolicy: event.target.value })}
                      >
                        <option value="">请明确选择原声处理</option>
                        <option value="keep">保留原声</option>
                        <option value="mute">静音</option>
                      </select>
                    </label>
                    <div className="review-actions">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        aria-label={`上移 ${clip.code}`}
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        disabled={index === clips.length - 1}
                        onClick={() => move(index, 1)}
                        aria-label={`下移 ${clip.code}`}
                      >
                        下移
                      </button>
                    </div>
                  </article>
                ))}
                <button disabled={!editor.ready || !clips.length}>预览时间线</button>
                {preview && (
                  <section aria-label="时间线预览">
                    <p>
                      {preview.snapshot.width}×{preview.snapshot.height} · 25 fps ·{' '}
                      {(preview.snapshot.durationMs / 1000).toFixed(2)} 秒
                    </p>
                    {preview.snapshot.clips.map((clip) => (
                      <p className="field-hint" key={clip.shotId}>
                        {clip.code} · 起始 {(clip.positionMs / 1000).toFixed(2)} 秒 · 预演时长{' '}
                        {(clip.durationMs / 1000).toFixed(2)} 秒
                      </p>
                    ))}
                    <button
                      type="button"
                      className="primary"
                      disabled={conflict || Boolean(revision)}
                      onClick={() =>
                        void run(async () => {
                          const value = await api<Timeline>(
                            path + '/timelines',
                            'POST',
                            {
                              ...options(),
                              expectedVersion: editor.version,
                              expectedPreviewHash: preview.snapshotHash,
                            },
                            { 'Idempotency-Key': key },
                          );
                          setRevision(value);
                          setEditor({ ...editor, version: value.version });
                          setQueueKey(crypto.randomUUID());
                          setJobs(await api<Job[]>(`/timelines/${value.id}/animatics`));
                          setHistory(await api<typeof history>(path + '/timelines'));
                        })
                      }
                    >
                      保存时间线版本
                    </button>
                  </section>
                )}
              </fieldset>
            </form>
          </>
        )}
        {conflict && <p className="notice">输入已保留。请核对错误后重新预览，或按当前选片载入新基线。</p>}
        {revision && (
          <section aria-label="已保存时间线">
            <h3>
              时间线 v{revision.version} · {(revision.durationMs / 1000).toFixed(2)} 秒
            </h3>
            <details>
              <summary>已保存片段</summary>
              {revision.snapshot?.clips.map((clip) => (
                <p className="field-hint" key={clip.shotId}>
                  {clip.code} · 起始 {(clip.positionMs / 1000).toFixed(2)} 秒 · 入点{' '}
                  {(clip.inMs / 1000).toFixed(3)} 秒 · 时长 {(clip.durationMs / 1000).toFixed(2)} 秒 ·{' '}
                  {clip.audioPolicy === 'keep' ? '保留原声' : '静音'}
                </p>
              ))}
            </details>
            {canEdit && (
              <button
                disabled={
                  busy || jobs.some((job) => ['queued', 'rendering', 'archiving'].includes(job.state))
                }
                onClick={() =>
                  void run(async () => {
                    const value = await api<Job>(
                      `/timelines/${revision.id}/animatics`,
                      'POST',
                      {},
                      { 'Idempotency-Key': queueKey },
                    );
                    setJobs([value, ...jobs.filter((job) => job.id !== value.id)]);
                    setQueueKey(crypto.randomUUID());
                  })
                }
              >
                生成低清预演
              </button>
            )}
            {jobs.map((job) => (
              <article className="revision-item" key={job.id}>
                <p>{states[job.state] ?? job.state}</p>
                {job.errorCode && (
                  <p className="field-hint">
                    {errors[job.errorCode] ?? '任务未完成，请检查权限、工具或媒体后重试。'}
                  </p>
                )}
                {job.canControl && ['queued', 'rendering', 'archiving'].includes(job.state) && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const value = await api<Job>(`/animatic-jobs/${job.id}/cancel`, 'POST', {});
                        setJobs(jobs.map((item) => (item.id === value.id ? value : item)));
                      })
                    }
                  >
                    取消预演任务
                  </button>
                )}
                {job.media && (
                  <>
                    <div className="media-preview">
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        src={job.media.contentUrl}
                        poster={job.media.posterUrl ?? undefined}
                        onError={() => setError('预演暂不能播放，请检查访问权限或下载原件核对。')}
                      />
                    </div>
                    <p className="field-hint">
                      {job.media.metadata.width}×{job.media.metadata.height} ·{' '}
                      {((job.media.metadata.durationMs ?? 0) / 1000).toFixed(2)} 秒
                    </p>
                    <a href={job.media.downloadUrl} download>
                      下载预演原件
                    </a>
                  </>
                )}
              </article>
            ))}
          </section>
        )}
        <h3>时间线历史</h3>
        {history.items.map((item) => (
          <button
            className="revision-item"
            disabled={busy}
            key={item.id}
            onClick={() =>
              void run(async () => {
                const value = await api<Timeline>(`/timelines/${item.id}`);
                setRevision(value);
                setJobs(await api<Job[]>(`/timelines/${value.id}/animatics`));
                setQueueKey(crypto.randomUUID());
              })
            }
          >
            查看时间线 v{item.version} · {(item.durationMs / 1000).toFixed(2)} 秒
          </button>
        ))}
        {history.nextCursor && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const more = await api<typeof history>(`${path}/timelines?before=${history.nextCursor}`);
                setHistory({ ...more, items: [...history.items, ...more.items] });
              })
            }
          >
            更多时间线版本
          </button>
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
    </Dialog>
  );
}
