import { useEffect, useState } from 'react';
import { api } from '../api';
import { AnalysisSource, DraftShot } from '../analysis-types';
import { Dialog } from './Dialog';
import { ShotDraftDetails } from './ShotDraftDetails';
type Card = {
  available: boolean;
  version: number;
  body?: Omit<DraftShot, 'sources'> & { sourceAudioPolicy?: string };
  sources?: (AnalysisSource & { revisionVersion: number })[];
  summary?: string;
  authorName?: string;
  origin?: { proposalId: string; proposalVersion: number; model: string; adoptedAt: string };
};
type History = {
  items: { version: number; summary: string; authorName: string }[];
  nextCursor: number | null;
};
export function ShotCardDialog({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const [card, setCard] = useState<Card>();
  const [history, setHistory] = useState<History>({ items: [], nextCursor: null });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = `/shots/${shotId}/card`;
  useEffect(() => {
    let active = true;
    void Promise.all([api<Card>(path), api<History>(`${path}/versions`)])
      .then(([value, versions]) => {
        if (active) {
          setCard(value);
          setHistory(versions);
        }
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '读取失败');
      });
    return () => {
      active = false;
    };
  }, [shotId]);
  return (
    <Dialog
      title="完整镜头制作卡"
      description="查看已保存制作卡及来源，历史版本不会随新修改被覆盖。"
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {!card && !error && <p role="status">正在读取制作卡…</p>}
        {card &&
          (card.available && card.body ? (
            <div className="proposal-shot">
              <h3>
                {card.body.title} · 制作卡 v{card.version}
              </h3>
              <p className="field-hint">
                {card.authorName} · {card.summary}
              </p>
              {card.origin && (
                <p className="field-hint">
                  采纳自草案 v{card.origin.proposalVersion} · 模型 {card.origin.model}
                </p>
              )}
              <ShotDraftDetails shot={card.body} sources={card.sources || []} />
              <p className="field-hint">
                原声处理计划：
                {
                  (
                    { keep: '保留', mute: '静音', inspect: '先检查再决定', replace: '替换' } as Record<
                      string,
                      string
                    >
                  )[card.body.sourceAudioPolicy || 'inspect']
                }
                （尚未应用到媒体）
              </p>
              <h3>制作卡版本</h3>
              {history.items.map((item) => (
                <button
                  className="revision-item"
                  key={item.version}
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError('');
                    void api<Card>(`${path}/versions/${item.version}`)
                      .then(setCard)
                      .catch((reason) => setError(reason instanceof Error ? reason.message : '读取失败'))
                      .finally(() => setBusy(false));
                  }}
                >
                  预览制作卡 v{item.version} · {item.summary} · {item.authorName}
                </button>
              ))}
              {history.nextCursor && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void api<History>(`${path}/versions?before=${history.nextCursor}`)
                      .then((value) =>
                        setHistory((current) => ({
                          items: [...current.items, ...value.items],
                          nextCursor: value.nextCursor,
                        })),
                      )
                      .catch((reason) => setError(reason instanceof Error ? reason.message : '读取失败'))
                      .finally(() => setBusy(false));
                  }}
                >
                  更多制作卡版本
                </button>
              )}
            </div>
          ) : (
            <p>此镜头尚无完整制作卡，已有镜头资料保持原样。</p>
          ))}
      </div>
    </Dialog>
  );
}
