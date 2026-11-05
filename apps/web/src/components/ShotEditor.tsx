import { Shot } from '../api';
import { useState } from 'react';
import { ShotCardDialog } from './ShotCardDialog';
import { techniqueLabels } from '../project-settings';
import { FullCardEditorDialog } from './FullCardEditorDialog';
import { PromptDialog } from './PromptDialog';
import { MediaDialog } from './MediaDialog';
import { AssetBindingsDialog } from './AssetBindingsDialog';
import { GenerationDialog } from './GenerationDialog';
export function ShotEditor({
  shot,
  disabled,
  save,
  reload,
}: {
  shot: Shot;
  disabled: boolean;
  save: (data: Record<string, unknown>) => void;
  reload: () => void;
}) {
  const [showCard, setShowCard] = useState(false);
  const [editCard, setEditCard] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [showGeneration, setShowGeneration] = useState(false);
  return (
    <section className="editor panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">镜头详情</span>
          <h2>{shot.code}</h2>
        </div>
        <span className="badge">版本 {shot.version}</span>
        <button onClick={() => setShowCard(true)}>查看完整制作卡</button>
        <button disabled={disabled} onClick={() => setEditCard(true)}>
          编辑完整制作卡
        </button>
        <button onClick={() => setShowPrompt(true)}>镜头提示词</button>
        <button onClick={() => setShowMedia(true)}>镜头素材</button>
        <button onClick={() => setShowAssets(true)}>资产引用</button>
        <button onClick={() => setShowGeneration(true)}>媒体生成</button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
          save({
            ...data,
            durationHint: Number(data.durationHint),
            sequence: Number(data.sequence),
            expectedVersion: shot.version,
          });
        }}
      >
        <div className="form-row">
          <label>
            镜头编号
            <input readOnly value={shot.code} />
          </label>
          <label>
            排序
            <input name="sequence" type="number" defaultValue={shot.sequence} min={0} max={100000} required />
          </label>
          <label>
            时长（秒）
            <input
              name="durationHint"
              type="number"
              defaultValue={shot.durationHint}
              min={1}
              max={3600}
              required
            />
          </label>
        </div>
        <label>
          制作方式
          <select name="technique" aria-label="制作方式" defaultValue={shot.technique} disabled={disabled}>
            {Object.entries(techniqueLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          画面描述
          <textarea
            name="description"
            rows={5}
            defaultValue={shot.description}
            maxLength={20000}
            placeholder="这一镜，观众会看见什么？"
          />
        </label>
        <label>
          运镜与景别
          <input
            name="camera"
            defaultValue={shot.camera}
            maxLength={2000}
            placeholder="例如：中景，镜头缓慢推进"
          />
        </label>
        <label>
          对白 / 旁白
          <textarea
            name="dialogue"
            rows={3}
            defaultValue={shot.dialogue}
            maxLength={20000}
            placeholder="记录这个镜头的声音"
          />
        </label>
        <div className="form-actions">
          <button type="button" disabled={disabled} onClick={reload}>
            加载最新版本
          </button>
          <button className="primary" disabled={disabled}>
            保存镜头
          </button>
        </div>
      </form>
      {showCard && <ShotCardDialog shotId={shot.id} onClose={() => setShowCard(false)} />}
      {editCard && (
        <FullCardEditorDialog
          shotId={shot.id}
          onClose={() => setEditCard(false)}
          onSaved={() => {
            setEditCard(false);
            reload();
          }}
        />
      )}
      {showPrompt && <PromptDialog shotId={shot.id} onClose={() => setShowPrompt(false)} />}
      {showMedia && <MediaDialog shotId={shot.id} onClose={() => setShowMedia(false)} />}
      {showGeneration && <GenerationDialog shotId={shot.id} onClose={() => setShowGeneration(false)} />}
      {showAssets && (
        <AssetBindingsDialog
          shotId={shot.id}
          onClose={() => setShowAssets(false)}
          onSaved={() => {
            setShowAssets(false);
            reload();
          }}
        />
      )}
    </section>
  );
}
