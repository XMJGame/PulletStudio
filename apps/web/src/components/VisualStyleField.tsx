import { useId, useState } from 'react';
import { VisualStyle, visualStyles } from '../visual-style';

export function VisualStyleField({
  preset = 'unspecified',
  description = '',
}: {
  preset?: VisualStyle;
  description?: string;
}) {
  const [selected, setSelected] = useState(preset);
  const [text, setText] = useState(description);
  const [expanded, setExpanded] = useState(description.length > 0);
  const descriptionId = useId();
  const inputId = useId();
  const hintId = useId();
  const showDescription = selected === 'custom' || expanded;
  return (
    <fieldset className="visual-style-field">
      <legend>
        视觉风格 <small>可选</small>
      </legend>
      <div className="visual-style-options">
        {visualStyles.map((item) => (
          <label className="visual-style-option" key={item.value}>
            <input
              type="radio"
              name="stylePreset"
              value={item.value}
              checked={selected === item.value}
              onChange={() => setSelected(item.value)}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </div>
      <p className="field-hint">统一项目的视觉方向，也可以稍后在项目设置中完善。</p>
      {selected !== 'custom' && (
        <button
          className="text-button style-description-toggle"
          type="button"
          aria-expanded={showDescription}
          aria-controls={showDescription ? descriptionId : undefined}
          onClick={() => setExpanded(!expanded)}
        >
          {showDescription ? '收起补充说明' : '补充风格描述（可选）'}{' '}
          <span aria-hidden="true">{showDescription ? '−' : '＋'}</span>
        </button>
      )}
      {showDescription ? (
        <div className="style-description" id={descriptionId}>
          <label htmlFor={inputId}>{selected === 'custom' ? '自定义视觉风格描述' : '风格补充说明'}</label>
          <textarea
            id={inputId}
            aria-describedby={hintId}
            name="styleDescription"
            value={text}
            onChange={(event) => setText(event.target.value)}
            required={selected === 'custom'}
            maxLength={2000}
            rows={3}
            placeholder="例如：低饱和暖色、柔和侧光、写实材质。"
          />
          <small className="field-hint" id={hintId}>
            描述色彩、光影与材质；题材和剧情写在项目简介中。
          </small>
        </div>
      ) : (
        <input type="hidden" name="styleDescription" value={text} />
      )}
    </fieldset>
  );
}
