import { Dialog } from '../components/Dialog';
import type { WorkflowGraph } from './workflow-graph';
import type { ExposedField, WorkflowMediaSchema } from '../../../../packages/contracts/src/workflow';
import type { WorkflowParameter } from '../components/GenerationParameters';
import { parameterLabels } from '../components/GenerationParameters';
import { CreativeParameters } from './CreativeParameters';
import { previewFields, previewParameters } from './workflow-draft';

export type WorkflowPreviewDraft = {
  name: string;
  capability: string;
  graph: WorkflowGraph;
  bindings: Record<string, string>;
  fields: ExposedField[];
  parameters: WorkflowParameter[];
  mediaSchema?: WorkflowMediaSchema;
  primaryBatch: boolean;
};
const mediaLabels = { image: '图片', video: '视频', audio: '音频' };
export function WorkflowFormPreview({
  draft,
  onClose,
  theme,
}: {
  draft: WorkflowPreviewDraft;
  onClose: () => void;
  theme: 'light' | 'dark';
}) {
  let fields: ReturnType<typeof previewFields> = [],
    parameters: ReturnType<typeof previewParameters> = [],
    error = '';
  try {
    fields = previewFields(draft.fields, draft.graph);
  } catch (reason) {
    error = reason instanceof Error ? reason.message : '创作参数尚未配置完整';
  }
  let parameterError = '';
  try {
    parameters = previewParameters(draft.parameters, draft.graph);
  } catch (reason) {
    parameterError = reason instanceof Error ? reason.message : '生成参数映射不完整';
  }
  const primary = draft.capability.startsWith('video.')
    ? '视频'
    : draft.capability.startsWith('audio.')
      ? '音频'
      : '图片';
  return (
    <Dialog
      title="创作者表单预览"
      description="查看创作者将看到的输入与参数。预览不会运行工作流。"
      onClose={onClose}
      theme={theme}
      className="workflow-form-preview"
    >
      <div className="workflow-form-preview-body">
        <h3>{draft.name || '未命名工作流'}</h3>
        {(!draft.graph[draft.bindings.positiveNode] ||
          !draft.bindings.positiveInput ||
          !draft.graph[draft.bindings.outputNode] ||
          !draft.bindings.outputField) && (
          <p role="status" className="notice error">
            提示词或主输出映射尚未完整，当前仅展示表单草稿。
          </p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {parameterError && (
          <p role="alert" className="notice error">
            {parameterError}
          </p>
        )}
        <fieldset disabled className="plain-fieldset">
          <label>
            提示词
            <textarea aria-label="预览提示词" placeholder="生成时填写提示词" rows={3} />
          </label>
          {draft.bindings.negativeNode && (
            <label>
              负向提示词
              <textarea placeholder="生成时按需填写" rows={2} />
            </label>
          )}
          {draft.capability === 'video.image_to_video' && (
            <label>
              首帧图片 · 必填
              <select defaultValue="">
                <option value="">选择画布中的首帧图片</option>
              </select>
            </label>
          )}
          {(draft.mediaSchema?.inputs ?? []).map((slot, index) => (
            <label key={slot.id}>
              {index + 1} · {slot.label || '未命名素材'} · {mediaLabels[slot.mediaType]} ·{' '}
              {slot.required ? '必填' : '可选'}
              <select defaultValue="">
                <option value="">连接或选择{mediaLabels[slot.mediaType]}素材</option>
              </select>
              <span className="field-hint">
                {
                  ({ reference: '参考素材', source: '源素材', last_frame: '尾帧', mask: '遮罩' } as const)[
                    slot.role
                  ]
                }{' '}
                ·{' '}
                {slot.required
                  ? '缺失时阻止生成'
                  : slot.onMissing === 'disconnect'
                    ? '留空时断开可省略的参考连接'
                    : '旧版空值声明，尚不能执行'}
              </span>
            </label>
          ))}
          {parameters.length > 0 && (
            <div className="v2-workflow-columns">
              {parameters.map((parameter) => {
                const value = parameter.defaultValue;
                return (
                  <label key={parameter.key}>
                    {parameterLabels[parameter.key]}
                    {parameter.key === 'aspectRatio' ? (
                      <select
                        aria-label={`预览${parameterLabels[parameter.key]}`}
                        value={typeof value === 'string' ? value : ''}
                        onChange={() => {}}
                      >
                        {!parameter.options.some((o) => o.value === value) && (
                          <option value="">默认值不在选项内</option>
                        )}
                        {parameter.options.map((option, index) => (
                          <option key={index} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={`预览${parameterLabels[parameter.key]}`}
                        type="number"
                        value={typeof value === 'number' ? value : ''}
                        readOnly
                        min={parameter.min}
                        max={parameter.max}
                        step={parameter.step}
                      />
                    )}
                    <span className="field-hint">
                      {parameter.key === 'aspectRatio'
                        ? '默认选项取自工作流'
                        : `${parameter.min}–${parameter.max}，步长 ${parameter.step}`}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          <CreativeParameters fields={fields} overrides={{}} change={() => {}} />
        </fieldset>
        <section aria-label="预览输出清单" className="workflow-preview-outputs">
          <h4>输出结果</h4>
          <p>
            主结果 · {primary} · {draft.primaryBatch ? '最多 8 份' : '1 份'}
          </p>
          {(draft.mediaSchema?.outputs ?? []).map((slot) => (
            <p key={slot.id}>
              {slot.label || '未命名附加输出'} · {mediaLabels[slot.mediaType]} ·{' '}
              {slot.role === 'preview' ? '预览' : '中间结果'} · {slot.multiple ? '最多 8 份' : '1 份'}
            </p>
          ))}
        </section>
        <p className="field-hint">默认值来自当前未保存配置；实际输出以工作流验证结果为准。</p>
      </div>
    </Dialog>
  );
}
