import { StudioButton, StudioIcon } from '../shared/ui/StudioUI';
import type { GenerationEngine, GenerationOutputFilter } from './workflow-types';
import './generation-type-picker.css';

export function GenerationTypePicker({
  engine,
  output,
  onEngine,
  onOutput,
  empty,
}: {
  engine: GenerationEngine;
  output: GenerationOutputFilter;
  onEngine: (engine: GenerationEngine) => void;
  onOutput: (output: GenerationOutputFilter) => void;
  empty: boolean;
}) {
  return (
    <div className="generation-type-picker">
      <label>
        生成引擎
        <select
          aria-label="生成引擎"
          value={engine}
          onChange={(e) => onEngine(e.target.value as GenerationEngine)}
        >
          <option value="comfyui">ComfyUI</option>
          <option value="api">API</option>
        </select>
      </label>
      {engine === 'api' && (
        <div className="generation-output-field">
          <span>生成类型</span>
          <div className="generation-output-options" role="group" aria-label="生成输出类型">
            {(
              [
                ['image', '图片', 'image'],
                ['video', '视频', 'film'],
                ['audio', '音频', 'audio'],
              ] as const
            ).map(([id, label, icon]) => (
              <StudioButton
                key={id}
                aria-label={`生成${label}`}
                aria-pressed={output === id}
                onClick={() => onOutput(id)}
              >
                <StudioIcon name={icon} size={15} />
                {label}
              </StudioButton>
            ))}
          </div>
        </div>
      )}
      {empty && (
        <p className="field-hint generation-type-empty" role="status">
          {engine === 'api'
            ? '当前 API 仅接入 ModelScope 文生图。视频和音频请使用已配置的 ComfyUI 工作流。'
            : '还没有可用工作流，请在全局设置的 ComfyUI 工作流中配置。'}
        </p>
      )}
    </div>
  );
}
