import { useEffect, useRef, useState } from 'react';
import type { BoardLayout } from '../../../../packages/contracts/src/board';
import type { CursorPage } from '../api';
import { generationStates, generationErrors, type GenerationJob } from '../components/GenerationDialog';
import { StudioButton, StudioIcon } from '../shared/ui/StudioUI';
import './board-candidates.css';
import { GenerationOutputPicker, selectedGenerationOutput } from '../components/GenerationOutputPicker';
import { referenceMediaLabels } from '../workflows/workflow-types';
import { GenerationOutputBatchDialog } from '../components/GenerationOutputBatchDialog';

export function BoardCandidates({
  jobs,
  layout,
  editable,
  busy,
  onResult,
  onArchive,
  onReuse,
  onMore,
  onLibrarySaved,
}: {
  jobs: CursorPage<GenerationJob>;
  layout: BoardLayout;
  editable: boolean;
  busy: boolean;
  onResult: (job: GenerationJob) => void;
  onArchive: (job: GenerationJob) => void;
  onReuse: (job: GenerationJob) => void;
  onMore: () => void;
  onLibrarySaved: (job: GenerationJob) => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState('');
  const [batch, setBatch] = useState<GenerationJob>();
  const current = selected ? jobs.items.find((job) => job.id === selected) : jobs.items[0];
  const outputId = current ? outputs[current.id] : undefined;
  const primary =
    current && (!outputId || current.outputs?.some((output) => output.id === outputId))
      ? selectedGenerationOutput(current, outputId)
      : undefined;
  const candidates = jobs.items
    .flatMap((job) => [job, ...(job.outputs ?? []).map((output) => selectedGenerationOutput(job, output.id))])
    .filter((job) => job.result && job.mediaVersionId);
  const alternatives = candidates.filter((job) => job.mediaVersionId !== primary?.mediaVersionId);
  const comparisonCandidate = candidates.find((job) => resultId(job) === comparison);
  const secondary =
    comparing && primary?.result ? alternatives.find((job) => resultId(job) === comparison) : undefined;
  if (!primary)
    return (
      <div className="v2-candidate-review">
        <p role="status">原候选已不可用。已有画布引用保持不变。</p>
        {jobs.items.length > 0 && (
          <StudioButton variant="ghost" onClick={showLatest}>
            查看最新任务
          </StudioButton>
        )}
      </div>
    );
  return (
    <div className="v2-candidate-review">
      <div className="v2-candidate-heading">
        <h4>任务与候选</h4>
        <div className="v2-live-inline">
          {current && !current.shotId && current.state === 'completed' && !!current.outputs?.length && (
            <StudioButton variant="ghost" disabled={busy} onClick={() => setBatch(current)}>
              批量处理产物
            </StudioButton>
          )}
          {primary.id !== jobs.items[0].id && (
            <StudioButton variant="ghost" onClick={showLatest}>
              查看最新任务
            </StudioButton>
          )}
          {(comparing || (!!primary.result && alternatives.length > 0)) && (
            <StudioButton
              variant="ghost"
              aria-pressed={comparing}
              onClick={() => {
                if (!comparing) {
                  setSelected(primary.id);
                  if (!alternatives.some((job) => resultId(job) === comparison))
                    setComparison(
                      resultId(alternatives.find((job) => job.id === primary.id) ?? alternatives[0]),
                    );
                }
                setComparing((value) => !value);
              }}
            >
              {comparing ? '结束对照' : '对照结果'}
            </StudioButton>
          )}
        </div>
      </div>
      {comparing && primary.result && (
        <label className="v2-candidate-compare-label">
          对照候选
          <select
            aria-label="对照候选"
            value={secondary ? resultId(secondary) : ''}
            onChange={(event) => setComparison(event.target.value)}
          >
            {!secondary && <option value="">请选择另一份产物</option>}
            {alternatives.map((job) => (
              <option key={resultId(job)} value={resultId(job)}>
                {job.id === primary.id ? '同一任务 · ' : ''}
                {new Date(job.createdAt).toLocaleTimeString()} · {job.workflowName} · {resultLabel(job)} ·{' '}
                {job.result && referenceMediaLabels[job.result.mediaType]} · 画布 v
                {job.boardExecution?.revision}
              </option>
            ))}
          </select>
        </label>
      )}
      {comparing && primary.result && !secondary && (
        <p role="status">原对照产物已不可用或与当前候选相同，请重新选择对照候选。</p>
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
      {batch && (
        <GenerationOutputBatchDialog
          key={batch.id}
          job={batch}
          editable={editable}
          onSaved={onLibrarySaved}
          onClose={() => setBatch(undefined)}
        />
      )}
    </div>
  );

  function showLatest() {
    setSelected(undefined);
    setComparing(false);
    if (jobs.items[0]) setOutputs((old) => ({ ...old, [jobs.items[0].id]: '' }));
  }

  function card(job: GenerationJob, secondary: boolean) {
    const otherVersionId = secondary
      ? primary?.mediaVersionId
      : comparing
        ? comparisonCandidate?.mediaVersionId
        : undefined;
    return (
      <article
        className="v2-live-candidate"
        key={secondary ? 'comparison' : 'primary'}
        data-job-id={job.id}
        data-result-id={resultId(job)}
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
        <GenerationOutputPicker
          job={job}
          disabledOutputIds={candidates
            .filter((candidate) => candidate.mediaVersionId === otherVersionId)
            .map(resultId)}
          onChange={(id) => {
            const target = candidates.find(
              (candidate) => candidate.id === job.id && (candidate.selectedOutputId ?? '') === id,
            );
            if (!target || target.mediaVersionId === otherVersionId) return;
            if (secondary) setComparison(resultId(target));
            else {
              setSelected(job.id);
              setOutputs((old) => ({ ...old, [job.id]: id }));
            }
          }}
        />
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
          {Boolean(job.outputs?.length) && <small>{resultLabel(job)}</small>}
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
                layout.nodes.some((n) => n.type === 'result' && n.id === (job.selectedOutputId ?? job.id)) ||
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

function resultId(job: GenerationJob) {
  return job.selectedOutputId ?? job.id;
}
function resultLabel(job: GenerationJob) {
  const output = job.outputs?.find((output) => output.id === job.selectedOutputId);
  return output
    ? `${output.label} · ${output.index + 1}${output.role === 'primary' ? '' : output.role === 'preview' ? ' · 预览' : ' · 中间结果'}`
    : `主结果${job.outputs?.some((output) => output.role === 'primary') ? ' · 1' : ''}`;
}

function CandidatePreview({ job, secondary }: { job: GenerationJob; secondary: boolean }) {
  const [failed, setFailed] = useState(false);
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    const element = media.current;
    if (!element || failed || !job.result) return;
    if (element.getAttribute('src') !== job.result.contentUrl) {
      element.setAttribute('src', job.result.contentUrl);
      element.load();
    }
    return () => {
      element.pause();
      element.removeAttribute('src');
      element.load();
    };
  }, [failed, job.result?.contentUrl]);
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
      ref={(element) => {
        media.current = element;
      }}
      src={job.result.contentUrl}
      aria-label={secondary ? '对照生成音频' : '节点生成音频'}
      controls
      preload="metadata"
      onError={() => setFailed(true)}
    />
  ) : (
    <video
      ref={(element) => {
        media.current = element;
      }}
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
