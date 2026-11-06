import { useState } from 'react';
import { StudioButton, StudioIcon } from '../../shared/ui/StudioUI';
import type { RunState, StudioMedia, StudioRunInput } from './studio-canvas-types';

export function StudioComposer({
  frame,
  initialPrompt,
  state,
  onRun,
  onDismiss,
  onClearFrame,
  onChooseFrame,
  onApplyPrompt,
  reviewMode,
}: {
  frame?: StudioMedia;
  initialPrompt: string;
  state: RunState;
  onRun: (input: StudioRunInput) => void;
  onDismiss: () => void;
  onClearFrame: () => void;
  onChooseFrame: () => void;
  onApplyPrompt: () => string;
  reviewMode: boolean;
}) {
  const [workflow, setWorkflow] = useState(frame ? 'i2v' : 't2v');
  const [prompt, setPrompt] = useState(initialPrompt);
  const [seconds, setSeconds] = useState(5);
  const [ratio, setRatio] = useState('16:9');
  const [failure, setFailure] = useState(false);
  const running = state === 'running';
  const needsImage = workflow === 'i2v';
  return (
    <section className="v2-composer" aria-label="创作面板">
      <header className="v2-composer-top">
        <div className="v2-composer-title">
          <span>
            <StudioIcon name="spark" size={18} />
          </span>
          <div>
            <h2>视频生成</h2>
            <small>ComfyUI · {needsImage ? '图生视频' : '文生视频'}</small>
          </div>
        </div>
        <StudioButton
          variant="ghost"
          icon="close"
          aria-label="关闭创作面板"
          title="关闭创作面板"
          onClick={onDismiss}
        />
      </header>
      <div className="v2-composer-body">
        <div className="v2-composer-frame-row">
          {frame ? (
            <div className="v2-composer-frame">
              <img src={frame.image} alt="" />
              <div>
                <small>{needsImage ? '首帧参考' : '已选图片'}</small>
                <strong>{frame.title}</strong>
              </div>
              <StudioButton
                variant="ghost"
                icon="close"
                aria-label="移除首帧"
                title="移除首帧"
                onClick={onClearFrame}
                disabled={running}
              />
            </div>
          ) : (
            <StudioButton variant="ghost" icon="image" onClick={onChooseFrame} disabled={running}>
              选一张首帧
            </StudioButton>
          )}
          <StudioButton
            variant="ghost"
            icon="book"
            onClick={() => setPrompt(onApplyPrompt())}
            disabled={running}
          >
            用示例提示词
          </StudioButton>
        </div>
        <textarea
          className="v2-input v2-prompt-box"
          aria-label="生成提示词"
          placeholder="描述你想生成的画面与镜头变化…"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={2}
          disabled={running}
        />
        {state === 'failed' && (
          <p className="v2-feedback v2-feedback-error" role="alert">
            <StudioIcon name="alert" size={15} /> 模拟任务失败。提示词和参考图已保留。
          </p>
        )}
        {state === 'completed' && (
          <p className="v2-feedback" role="status">
            <StudioIcon name="check" size={15} /> 候选已加入画布，可以继续创作。
          </p>
        )}
        {running && (
          <p className="v2-feedback" role="status">
            <span className="v2-spinner" /> 正在生成示例视频…
          </p>
        )}
      </div>
      <footer className="v2-composer-footer">
        <label className="v2-workflow-picker">
          <span className="v2-sr">工作流</span>
          <StudioIcon name="layers" size={16} />
          <select
            aria-label="工作流"
            value={workflow}
            disabled={running}
            onChange={(event) => setWorkflow(event.target.value)}
          >
            <option value="i2v">首帧图生视频</option>
            <option value="t2v">文字生成视频</option>
          </select>
        </label>
        <details className="v2-parameter-menu">
          <summary>
            <StudioIcon name="sliders" size={16} />
            <span>
              {ratio} · {seconds}s
            </span>
          </summary>
          <div className="v2-parameter-content">
            <strong>生成参数</strong>
            <label>
              画幅
              <select
                className="v2-input"
                value={ratio}
                onChange={(event) => setRatio(event.target.value)}
                disabled={running}
              >
                <option>16:9</option>
                <option>9:16</option>
                <option>1:1</option>
              </select>
            </label>
            <label>
              时长
              <select
                className="v2-input"
                value={seconds}
                onChange={(event) => setSeconds(Number(event.target.value))}
                disabled={running}
              >
                <option value="5">5 秒</option>
                <option value="8">8 秒</option>
              </select>
            </label>
            {reviewMode && (
              <label className="v2-failure-toggle">
                <input
                  type="checkbox"
                  checked={failure}
                  disabled={running}
                  onChange={(event) => setFailure(event.target.checked)}
                />
                模拟失败
              </label>
            )}
          </div>
        </details>
        <StudioButton
          variant="primary"
          icon="spark"
          disabled={running || !prompt.trim() || (needsImage && !frame)}
          onClick={() =>
            onRun({
              workflow,
              prompt,
              frame: needsImage ? frame : undefined,
              seconds,
              ratio,
              previewFailure: failure,
            })
          }
        >
          {running ? '生成中' : state === 'failed' ? '重试' : '生成'}
        </StudioButton>
      </footer>
    </section>
  );
}
