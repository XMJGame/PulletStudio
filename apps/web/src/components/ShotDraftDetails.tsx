import { AnalysisSource, DraftShot } from '../analysis-types';
import { techniqueLabels } from '../project-settings';
export function ShotDraftDetails({
  shot,
  sources,
  revisionVersion,
}: {
  shot: Omit<DraftShot, 'sources'>;
  sources: (AnalysisSource & { revisionVersion?: number })[];
  revisionVersion?: number;
}) {
  return (
    <>
      <p>{shot.description}</p>
      <dl>
        <dt>创作意图</dt>
        <dd>{shot.intent}</dd>
        <dt>镜头与动作</dt>
        <dd>
          {[shot.framing, shot.angle, shot.composition, shot.cameraMovement, shot.action]
            .filter(Boolean)
            .join(' · ')}
        </dd>
        <dt>光线与情绪</dt>
        <dd>{[shot.lighting, shot.mood].filter(Boolean).join(' · ')}</dd>
        <dt>对白 / 声音</dt>
        <dd>
          {shot.dialogue || '无对白'} · {shot.audioNotes}
        </dd>
        <dt>计划制作</dt>
        <dd>
          {techniqueLabels[shot.technique]} ·{' '}
          {shot.durationSeconds === null ? '时长待实际声音 / 节奏确认' : `${shot.durationSeconds} 秒（计划）`}
        </dd>
        <dt>候选资产</dt>
        <dd>{shot.assets.join('、') || '未列出'}</dd>
      </dl>
      {shot.riskNotes.map((note, index) => (
        <p className="field-hint" key={index}>
          待核对：{note}
        </p>
      ))}
      <details>
        <summary>查看引用原文</summary>
        {shot.sourceSpanIds.map((id) => {
          const source = sources.find((block) => block.id === id);
          return (
            source && (
              <blockquote key={id}>
                <small>
                  v{source.revisionVersion ?? revisionVersion} · 原文 {source.startOffset}–{source.endOffset}
                </small>
                <p>{source.text}</p>
              </blockquote>
            )
          );
        })}
      </details>
    </>
  );
}
