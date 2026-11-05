import { useState } from 'react';

export const parameterLabels = { aspectRatio: '画幅', durationSeconds: '时长（秒）', seed: 'Seed' };
type ParameterKey = keyof typeof parameterLabels;
type Target = { node: string; input: string };
export type WorkflowParameter =
  | (Target & { key: 'aspectRatio'; options: { label: string; value: string }[] })
  | (Target & { key: 'durationSeconds' | 'seed'; min: number; max: number; step: number });
export type ParameterValues = Partial<Record<ParameterKey, string | number>>;
export type AvailableParameter = WorkflowParameter & { defaultValue: string | number };

export function describeParameters(values: ParameterValues) {
  return Object.entries(values)
    .map(([key, value]) => `${parameterLabels[key as ParameterKey]} ${value}`)
    .join(' · ');
}

export function readParameterBindings(data: FormData): WorkflowParameter[] {
  return (Object.keys(parameterLabels) as ParameterKey[])
    .filter((key) => data.has(`parameter-${key}`))
    .map((key) => {
      const target = {
        node: String(data.get(`${key}-node`) ?? '').trim(),
        input: String(data.get(`${key}-input`) ?? '').trim(),
      };
      if (key === 'aspectRatio') {
        const options = String(data.get('aspectRatio-options') ?? '')
          .trim()
          .split('\n')
          .map((line) => {
            const separator = line.indexOf('=');
            if (separator < 1 || !line.slice(separator + 1).trim())
              throw new Error('每行画幅选项请填写显示名称=工作流实际值。');
            return { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
          });
        return { key, ...target, options };
      }
      return {
        key,
        ...target,
        min: Number(data.get(`${key}-min`)),
        max: Number(data.get(`${key}-max`)),
        step: key === 'seed' ? 1 : Number(data.get(`${key}-step`)),
      };
    });
}

export function WorkflowParameterFields({
  nodeListId,
  capability,
  initial = [],
}: {
  nodeListId: string;
  capability: string;
  initial?: WorkflowParameter[];
}) {
  const [enabled, setEnabled] = useState<ParameterKey[]>(initial.map((item) => item.key));
  const keys = (Object.keys(parameterLabels) as ParameterKey[]).filter(
    (key) => key !== 'durationSeconds' || capability !== 'image.text_to_image',
  );
  return (
    <details>
      <summary>可调生成参数（可选）</summary>
      <p className="field-hint">绑定图中已有的常量输入，默认值取自导入的工作流。时长请绑定上游秒数输入。</p>
      {keys.map((key) => (
        <div key={key}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              name={`parameter-${key}`}
              checked={enabled.includes(key)}
              onChange={(event) =>
                setEnabled(event.target.checked ? [...enabled, key] : enabled.filter((item) => item !== key))
              }
            />
            允许调整{parameterLabels[key]}
          </label>
          {enabled.includes(key) && (
            <>
              <div className="dialog-field-row">
                <label>
                  {parameterLabels[key]}绑定节点
                  <input
                    name={`${key}-node`}
                    list={nodeListId}
                    required
                    defaultValue={initial.find((item) => item.key === key)?.node}
                  />
                </label>
                <label>
                  {parameterLabels[key]}绑定输入
                  <input
                    name={`${key}-input`}
                    required
                    defaultValue={initial.find((item) => item.key === key)?.input}
                  />
                </label>
              </div>
              {key === 'aspectRatio' ? (
                <label>
                  画幅选项
                  <textarea
                    name="aspectRatio-options"
                    rows={4}
                    required
                    placeholder={'横屏=16:9\n方形=1:1\n请使用节点接受的完整值'}
                    defaultValue={initial
                      .filter((item) => item.key === 'aspectRatio')
                      .map((item) =>
                        item.options.map((option) => `${option.label}=${option.value}`).join('\n'),
                      )
                      .join('')}
                  />
                  <span className="field-hint">每行填写显示名称=实际值，实际值须与节点选项完全一致。</span>
                </label>
              ) : (
                <div className="dialog-field-row">
                  <label>
                    {parameterLabels[key]}最小值
                    <input
                      name={`${key}-min`}
                      type="number"
                      required
                      step={key === 'seed' ? 1 : 'any'}
                      min={key === 'seed' ? 0 : undefined}
                      defaultValue={
                        initial.filter((item) => item.key !== 'aspectRatio').find((item) => item.key === key)
                          ?.min ?? (key === 'seed' ? 0 : 1)
                      }
                    />
                  </label>
                  <label>
                    {parameterLabels[key]}最大值
                    <input
                      name={`${key}-max`}
                      type="number"
                      required
                      step={key === 'seed' ? 1 : 'any'}
                      max={key === 'seed' ? Number.MAX_SAFE_INTEGER : 3600}
                      defaultValue={
                        initial.filter((item) => item.key !== 'aspectRatio').find((item) => item.key === key)
                          ?.max ?? (key === 'seed' ? Number.MAX_SAFE_INTEGER : 30)
                      }
                    />
                  </label>
                  {key === 'durationSeconds' && (
                    <label>
                      时长步长
                      <input
                        name="durationSeconds-step"
                        type="number"
                        step="any"
                        required
                        defaultValue={
                          initial
                            .filter((item) => item.key !== 'aspectRatio')
                            .find((item) => item.key === 'durationSeconds')?.step ?? 1
                        }
                      />
                    </label>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </details>
  );
}
