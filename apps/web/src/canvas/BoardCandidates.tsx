import { useState } from 'react';
import type { BoardLayout } from '../../../../packages/contracts/src/board';
import type { CursorPage } from '../api';
import { generationStates, generationErrors, type GenerationJob } from '../components/GenerationDialog';
import { StudioButton, StudioIcon } from '../shared/ui/StudioUI';
import './board-candidates.css';

export function BoardCandidates({
  jobs,
  layout,
  editable,
  busy,
  onResult,
  onArchive,
  onReuse,
  onMore,
}: {
  jobs: CursorPage<GenerationJob>;
  layout: BoardLayout;
  editable: boolean;
  busy: boolean;
  onResult: (job: GenerationJob) => void;
  onArchive: (job: GenerationJob) => void;
  onReuse: (job: GenerationJob) => void;
  onMore: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState('');
  const primary = jobs.items.find((job) => job.id === selected) ?? jobs.items[0];
  const alternatives = jobs.items.filter((job) => job.result && job.id !== primary?.id);
  const secondary =
    comparing && primary?.result
      ? (alternatives.find((job) => job.id === comparison) ?? alternatives[0])
      : undefined;
  if (!primary) return null;
  return (
    <div className="v2-candidate-review">
      <div className="v2-candidate-heading">
        <h4>任务与候选</h4>
        <div className="v2-live-inline">
          {primary.id !== jobs.items[0].id && (
            <StudioButton variant="ghost" onClick={() => setSelected(undefined)}>
              查看最新任务
            </StudioButton>
          )}
          {!!primary.result && alternatives.length > 0 && (
            <StudioButton
              variant="ghost"
              aria-pressed={comparing}
              onClick={() => {
                if (!comparing) {
                  setSelected(primary.id);
                  setComparison(alternatives[0]?.id ?? '');
                }
                setComparing((value) => !value);
              }}
            >
              {comparing ? '结束对照' : '对照结果'}
            </StudioButton>
          )}
        </div>
      </div>
      {secondary && (
        <label className="v2-candidate-compare-label">
          对照候选
          <select
            aria-label="对照候选"
            value={secondary.id}
            onChange={(event) => setComparison(event.target.value)}
          >
            {alternatives.map((job) => (
              <option key={job.id} value={job.id}>
                {new Date(job.createdAt).toLocaleTimeString()} · {job.workflowName} · 画布 v
                {job.boardExecution?.revision}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="v2-candidate-previews" data-comparing={Boolean(secondary)}>
        {card(primary, false)}
        {secondary && card(secondary, true)}
      </div>
      {(jobs.items.length > 1 || jobs.nextCursor) && (
        <details className="creative-advanced">
          <summary>历史任务 · {jobs.items.length}</summary>
          <div className="v2-candidate-history" aria-label="候选历史">
            {jobs.items.map((job) => (
              <button
                key={job.id}
                aria-label={`查看候选 ${job.id}`}
                aria-pressed={primary.id === job.id}
                onClick={() => setSelected(job.id)}
              >
                {job.result?.posterUrl || job.result?.mediaType === 'image' ? (
                  <img src={job.result.posterUrl ?? job.result.contentUrl} alt="" loading="lazy" />
                ) : (
                  <StudioIcon name={job.result?.mediaType === 'video' ? 'film' : 'clock'} />
                )}
                <span>
                  <strong>{job.workflowName}</strong>
                  <small>
                    {generationStates[job.state] ?? job.state} ·{' '}
                    {new Date(job.createdAt).toLocaleTimeString()}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {jobs.nextCursor && (
            <StudioButton variant="ghost" disabled={busy} onClick={onMore}>
              更多节点任务
            </StudioButton>
          )}
        </details>
      )}
    </div>
  );

  function card(job: GenerationJob, secondary: boolean) {
    return (
      <article
        className="v2-live-candidate"
        key={job.id}
        data-job-id={job.id}
        aria-label={secondary ? '对照结果' : '当前候选'}
      >
        <header>
          <strong data-state={job.state} aria-live="polite">
            {generationStates[job.state] ?? job.state}
          </strong>
          <small>
            画布 v{job.boardExecution?.revision} · {new Date(job.createdAt).toLocaleTimeString()}
          </small>
        </header>
        {job.errorCode && (
          <p role="status">
            {generationErrors[job.errorCode] ?? '生成遇到问题，请检查工作流、参考素材或实例连接。'}
          </p>
        )}
        {job.result && (
          <CandidatePreview key={job.mediaVersionId ?? job.id} job={job} secondary={secondary} />
        )}
        <div className="v2-candidate-caption">
          <strong>{job.workflowName}</strong>
          {job.result && (
            <small>
              {[
                job.result.metadata.width && job.result.metadata.height
                  ? `${job.result.metadata.width}×${job.result.metadata.height}`
                  : '',
                job.result.metadata.durationMs !== null
                  ? `${Number((job.result.metadata.durationMs / 1000).toFixed(2))} 秒`
                  : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </small>
          )}
        </div>
        <div className="v2-live-inline">
          {editable && (
            <StudioButton
              icon="plus"
              disabled={
                busy ||
                layout.nodes.some((n) => n.type === 'result' && n.data.jobId === job.id) ||
                layout.nodes.length >= 100
              }
              onClick={() => onResult(job)}
            >
              加入画布结果
            </StudioButton>
          )}
          {editable && job.state === 'completed' && !job.inLibrary && (
            <StudioButton icon="folder" disabled={busy} onClick={() => onArchive(job)}>
              存入素材库
            </StudioButton>
          )}
          {job.inLibrary && <small className="v2-candidate-filed">已存入素材库</small>}
          {editable && job.prompt && (
            <StudioButton variant="ghost" disabled={busy} onClick={() => onReuse(job)}>
              复用此次提示词
            </StudioButton>
          )}
          {job.result && job.mediaVersionId && (
            <a href={`/api/v1/media-versions/${job.mediaVersionId}/content?download=1`} download>
              下载原件
            </a>
          )}
        </div>
        <details className="v2-candidate-snapshot">
          <summary>此次生成记录</summary>
          <p>
            工作流 v{job.workflowRevision} · {new Date(job.createdAt).toLocaleString()}
          </p>
          {job.image && (
            <p>
              首帧：{job.image.fileName} · v{job.image.version}
            </p>
          )}
          {!!(job.referenceMedia ?? job.referenceImages)?.length && (
            <ul aria-label={job.referenceMedia ? '采用的参考素材' : '采用的参考图片'}>
              {(job.referenceMedia ?? job.referenceImages)?.map((item) => (
                <li key={item.slotId}>
                  {item.label} · {item.fileName} · v{item.version}
                </li>
              ))}
            </ul>
          )}
          {job.promptLibrary && (
            <p>
              提示词库：{job.promptLibrary.title} · v{job.promptLibrary.version}
            </p>
          )}
          {job.prompt && (
            <>
              <p className="preserve-space">{job.prompt.positivePrompt}</p>
              {job.prompt.negativePrompt && (
                <p className="preserve-space">负向：{job.prompt.negativePrompt}</p>
              )}
              {job.prompt.source && <p>来源：{job.prompt.source}</p>}
            </>
          )}
        </details>
      </article>
    );
  }
}

function CandidatePreview({ job, secondary }: { job: GenerationJob; secondary: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!job.result) return null;
  if (failed)
    return (
      <p role="status" className="v2-candidate-media-error">
        预览无法读取，请检查文件或权限。固定结果已保留。
      </p>
    );
  return job.result.mediaType === 'image' ? (
    <img
      src={job.result.contentUrl}
      alt={secondary ? '对照生成结果' : '节点生成结果'}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : job.result.mediaType === 'audio' ? (
    <audio
      src={job.result.contentUrl}
      aria-label={secondary ? '对照生成音频' : '节点生成音频'}
      controls
      preload="metadata"
      onError={() => setFailed(true)}
    />
  ) : (
    <video
      src={job.result.contentUrl}
      poster={job.result.posterUrl ?? undefined}
      aria-label={secondary ? '对照生成视频' : '节点生成视频'}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}
