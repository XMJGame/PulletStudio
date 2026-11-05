import { useState } from 'react';
import { Project } from '../api';
import { formatLabels, narrativeLabels } from '../project-settings';

const templates: Record<string, { title: string; format: string; narrative: string; seconds: string }> = {
  blank: { title: '空白项目', format: 'custom', narrative: 'none', seconds: '' },
  dialogue: { title: '对白短片', format: 'short', narrative: 'dialogue', seconds: '180' },
  narration: { title: '旁白长视频', format: 'longform', narrative: 'narration', seconds: '600' },
  ad: { title: '产品广告', format: 'ad', narrative: 'none', seconds: '30' },
  series: { title: '连续剧 / 系列', format: 'series', narrative: 'dialogue', seconds: '' },
};
export function ProjectSetupFields({ initial, creating = false }: { initial?: Project; creating?: boolean }) {
  const [format, setFormat] = useState(initial?.workFormat || 'custom');
  const [narrative, setNarrative] = useState(initial?.narrativeMode || 'none');
  const [seconds, setSeconds] = useState(initial?.targetDurationSeconds?.toString() || '');
  const [expanded, setExpanded] = useState(!creating);
  return (
    <div className="project-setup-fields">
      {creating && (
        <label>
          项目起始模板
          <select
            defaultValue="blank"
            onChange={(event) => {
              const template = templates[event.target.value];
              setFormat(template.format);
              setNarrative(template.narrative);
              setSeconds(template.seconds);
              setExpanded(true);
            }}
          >
            {Object.entries(templates).map(([key, template]) => (
              <option key={key} value={key}>
                {template.title}
              </option>
            ))}
          </select>
          <small className="field-hint">提供可调整的起始设定，不限定风格、模型或工作流。</small>
        </label>
      )}
      <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary>格式、叙事与导演设定</summary>
        <div className="dialog-field-row">
          <label>
            作品格式
            <select name="workFormat" value={format} onChange={(event) => setFormat(event.target.value)}>
              {Object.entries(formatLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            叙事方式
            <select
              name="narrativeMode"
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
            >
              {Object.entries(narrativeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          项目目标时长（秒）
          <input
            name="targetDurationSeconds"
            type="number"
            min={1}
            max={28800}
            step={1}
            value={seconds}
            onChange={(event) => setSeconds(event.target.value)}
            placeholder="可选，如 30、180 或 4800"
          />
        </label>
        <label>
          导演创作说明
          <textarea
            name="directorNotes"
            rows={3}
            maxLength={4000}
            defaultValue={initial?.directorNotes || ''}
            placeholder="叙事节奏、表演或镜头偏好；与视觉风格和模型配置分开。"
          />
        </label>
      </details>
    </div>
  );
}
