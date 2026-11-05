import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { readParameterBindings, WorkflowParameterFields } from '../components/GenerationParameters';
import type { GenerationConfig, WorkflowEditing } from './workflow-types';
import { ExposedFieldsEditor } from './ExposedFieldsEditor';
import type { ExposedField } from '../../../../packages/contracts/src/workflow';
import { readWorkflowGraph } from './workflow-graph';
const WorkflowGraphPreview = lazy(() => import('./WorkflowGraphPreview'));
const initialBindings: Record<string, string> = {
  positiveNode: '',
  positiveInput: 'text',
  negativeNode: '',
  negativeInput: '',
  imageNode: '',
  imageInput: 'image',
  outputNode: '',
  outputField: 'images',
};
export function GenerationSettings({
  config,
  projectPath,
  busy,
  run,
  refreshConfig,
  setMessage,
  expanded = false,
  onDraftChange,
  editing,
  onSaved,
}: {
  config: GenerationConfig;
  projectPath: string;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  refreshConfig: () => Promise<void>;
  setMessage: (value: string) => void;
  expanded?: boolean;
  onDraftChange?: (dirty: boolean) => void;
  editing?: WorkflowEditing;
  onSaved?: (id: string) => void | Promise<void>;
}) {
  const [dirtyForms, setDirtyForms] = useState({ connection: false, workflow: false });
  const definition = editing?.definition;
  const initial = {
    ...initialBindings,
    ...(definition
      ? {
          positiveNode: definition.positive.node,
          positiveInput: definition.positive.input,
          negativeNode: definition.negative?.node ?? '',
          negativeInput: definition.negative?.input ?? '',
          imageNode: definition.image?.node ?? '',
          imageInput: definition.image?.input ?? 'image',
          outputNode: definition.output.node,
          outputField: definition.output.field,
        }
      : {}),
  };
  const [bindings, setBindings] = useState(initial);
  const [fields, setFields] = useState<ExposedField[]>(definition?.fields ?? []);
  const attempt = useRef({ body: '', key: '' });
  const [showGraph, setShowGraph] = useState(false);
  useEffect(() => onDraftChange?.(dirtyForms.connection || dirtyForms.workflow), [dirtyForms, onDraftChange]);
  const [bindingFormVersion, setBindingFormVersion] = useState(0);
  const [capability, setCapability] = useState(definition?.capability ?? 'image.text_to_image');
  const [graphText, setGraphText] = useState(definition ? JSON.stringify(definition.graph, null, 2) : '');
  const nodeListId = useId();
  const workflowNodes = useMemo(() => {
    try {
      return Object.entries(readWorkflowGraph(graphText));
    } catch {
      return [];
    }
  }, [graphText]);

  return (
    <>
      {config?.canConfigure && (
        <details open={expanded || undefined}>
          <summary>配置 ComfyUI 连接与工作流</summary>
          <h3>生成连接</h3>
          {config.connections.map((item) => (
            <div className="entity-reference" key={item.id}>
              <span>
                {item.name} · {item.enabled ? '启用' : '停用'}
              </span>
              <div className="review-actions">
                <button
                  disabled={busy || !item.enabled}
                  onClick={() =>
                    void run(async () => {
                      await api(`/generation-connections/${item.id}/test`, 'POST', {});
                      setMessage('ComfyUI 可达。');
                    })
                  }
                >
                  测试连接
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/generation-connections/${item.id}`, 'PATCH', {
                        enabled: !item.enabled,
                        expectedVersion: item.version,
                      });
                      await refreshConfig();
                    })
                  }
                >
                  {item.enabled ? '停用' : '启用'}
                </button>
              </div>
            </div>
          ))}
          <form
            onChangeCapture={() => setDirtyForms((value) => ({ ...value, connection: true }))}
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              void run(async () => {
                await api(`${projectPath}/generation-connections`, 'POST', {
                  name: data.get('name'),
                  baseUrl: data.get('baseUrl'),
                  token: data.get('token'),
                  trustedPrivate: data.has('trustedPrivate'),
                });
                form.reset();
                setDirtyForms((value) => ({ ...value, connection: false }));
                await refreshConfig();
                setMessage('已添加生成连接。');
              });
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <label>
                连接名称
                <input name="name" required maxLength={120} />
              </label>
              <label>
                ComfyUI 基础地址
                <input name="baseUrl" type="url" placeholder="http://192.168.x.x:8188" required />
              </label>
              <label>
                Bearer 凭据（可选）
                <input name="token" type="password" autoComplete="off" />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="trustedPrivate" />
                批准自部署 HTTP 或私有网络地址
              </label>
              <button>添加连接</button>
            </fieldset>
          </form>
          <h3>工作流</h3>
          <form
            onChangeCapture={() => setDirtyForms((value) => ({ ...value, workflow: true }))}
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              void run(async () => {
                let graph: unknown;
                try {
                  graph = readWorkflowGraph(graphText);
                } catch {
                  throw new Error('请输入有效的 API 格式 JSON。');
                }
                const negativeNode = data.get('negativeNode'),
                  negativeInput = data.get('negativeInput');
                if (Boolean(negativeNode) !== Boolean(negativeInput))
                  throw new Error('负向绑定须同时填写节点和输入。');
                const definition = {
                  name: data.get('name'),
                  connectionId: data.get('connectionId'),
                  capability: data.get('capability'),
                  graph,
                  positive: { node: data.get('positiveNode'), input: data.get('positiveInput') },
                  ...(negativeNode ? { negative: { node: negativeNode, input: negativeInput } } : {}),
                  ...(data.get('capability') === 'video.image_to_video'
                    ? { image: { node: data.get('imageNode'), input: data.get('imageInput') } }
                    : {}),
                  output: { node: data.get('outputNode'), field: data.get('outputField') },
                  parameters: readParameterBindings(data),
                  fields,
                  ...(fields.length ? { fieldSchemaVersion: 'studio.workflow-fields.v1' } : {}),
                };
                const body = editing
                  ? {
                      expectedVersion: editing.catalog.version,
                      summary: String(data.get('revisionSummary')),
                      definition,
                    }
                  : definition;
                const serialized = JSON.stringify(body);
                if (attempt.current.body !== serialized)
                  attempt.current = { body: serialized, key: crypto.randomUUID() };
                const result = await api<{ id: string; revision: number }>(
                  editing
                    ? `/workflow-catalogs/${editing.catalog.familyId}/revisions`
                    : `${projectPath}/generation-workflows`,
                  'POST',
                  body,
                  { 'Idempotency-Key': attempt.current.key },
                );
                form.reset();
                setDirtyForms((value) => ({ ...value, workflow: false }));
                setBindings(initialBindings);
                setShowGraph(false);
                setCapability('image.text_to_image');
                setGraphText('');
                setFields([]);
                attempt.current = { body: '', key: '' };
                setBindingFormVersion((value) => value + 1);
                await refreshConfig();
                setMessage(`工作流的绑定节点已验证并保存。修订 v${result.revision ?? 1}`);
                await onSaved?.(result.id);
              });
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <label>
                工作流名称
                <input name="name" required maxLength={120} defaultValue={definition?.name} />
              </label>
              <label>
                工作流连接
                <select
                  name="connectionId"
                  aria-label="工作流连接"
                  required
                  defaultValue={definition?.connectionId}
                >
                  <option value="">选择连接</option>
                  {config.connections
                    .filter((item) => item.enabled)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                生成方式
                <select
                  aria-label="生成方式"
                  name="capability"
                  value={capability}
                  onChange={(event) => setCapability(event.target.value)}
                >
                  <option value="image.text_to_image">文字生图</option>
                  <option value="video.text_to_video">文字生视频</option>
                  <option value="video.image_to_video">图生视频</option>
                </select>
              </label>
              {capability === 'video.image_to_video' && (
                <div className="dialog-field-row">
                  <label>
                    首帧图片节点
                    <input
                      name="imageNode"
                      list={nodeListId}
                      required
                      value={bindings.imageNode}
                      onChange={(event) =>
                        setBindings((value) => ({ ...value, imageNode: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    首帧图片输入
                    <input
                      name="imageInput"
                      required
                      value={bindings.imageInput}
                      onChange={(event) =>
                        setBindings((value) => ({ ...value, imageInput: event.target.value }))
                      }
                    />
                  </label>
                </div>
              )}
              <label>
                选择 API 格式 JSON 文件
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (!file) return;
                    void run(async () => {
                      if (file.size > 160000) throw new Error('工作流文件不能超过 160 KB。');
                      const content = await file.text();
                      try {
                        readWorkflowGraph(content);
                      } catch {
                        throw new Error('请选择从 ComfyUI 导出的 API 格式 JSON。');
                      }
                      setGraphText(content);
                    });
                  }}
                />
              </label>
              <label>
                API 格式工作流 JSON
                <textarea
                  aria-label="API 格式工作流 JSON"
                  rows={5}
                  required
                  maxLength={160000}
                  value={graphText}
                  onChange={(event) => setGraphText(event.target.value)}
                />
              </label>
              {workflowNodes.length > 0 && (
                <div className="workflow-graph-controls">
                  <button type="button" onClick={() => setShowGraph((value) => !value)}>
                    {showGraph ? '收起节点图' : '预览节点图'}
                  </button>
                  {showGraph && (
                    <Suspense fallback={<p role="status">正在打开技术图…</p>}>
                      <WorkflowGraphPreview
                        graph={readWorkflowGraph(graphText)}
                        capability={capability}
                        bindings={bindings}
                        disabled={busy}
                        onBind={(role, node, input) => {
                          setBindings((value) => ({
                            ...value,
                            [role + 'Node']: node,
                            ...(input ? { [role + 'Input']: input } : {}),
                          }));
                          setDirtyForms((value) => ({ ...value, workflow: true }));
                        }}
                      />
                    </Suspense>
                  )}
                </div>
              )}
              {graphText.trim() && !workflowNodes.length && (
                <p className="notice error" role="status">
                  无法预览：请使用1–200节点、160KB以内的API格式JSON。原输入已保留。
                </p>
              )}
              <datalist id={nodeListId}>
                {workflowNodes.map(([id, node]) => (
                  <option key={id} value={id} label={node.class_type} />
                ))}
              </datalist>
              <p className="field-hint">
                使用你已验证并信任的工作流。节点可能访问该 ComfyUI 主机上的文件或外部服务。
              </p>
              <div className="dialog-field-row">
                <label>
                  正向文本节点
                  <input
                    name="positiveNode"
                    list={nodeListId}
                    required
                    value={bindings.positiveNode}
                    onChange={(event) =>
                      setBindings((value) => ({ ...value, positiveNode: event.target.value }))
                    }
                  />
                </label>
                <label>
                  正向文本输入
                  <input
                    name="positiveInput"
                    required
                    value={bindings.positiveInput}
                    onChange={(event) =>
                      setBindings((value) => ({ ...value, positiveInput: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="dialog-field-row">
                <label>
                  负向文本节点（可选）
                  <input
                    name="negativeNode"
                    list={nodeListId}
                    value={bindings.negativeNode}
                    onChange={(event) =>
                      setBindings((value) => ({ ...value, negativeNode: event.target.value }))
                    }
                  />
                </label>
                <label>
                  负向文本输入（可选）
                  <input
                    name="negativeInput"
                    value={bindings.negativeInput}
                    onChange={(event) =>
                      setBindings((value) => ({ ...value, negativeInput: event.target.value }))
                    }
                  />
                </label>
              </div>
              <div className="dialog-field-row">
                <label>
                  输出节点
                  <input
                    name="outputNode"
                    list={nodeListId}
                    required
                    value={bindings.outputNode}
                    onChange={(event) =>
                      setBindings((value) => ({ ...value, outputNode: event.target.value }))
                    }
                  />
                </label>
                <label>
                  历史输出字段
                  <input
                    name="outputField"
                    required
                    value={bindings.outputField}
                    onChange={(event) =>
                      setBindings((value) => ({ ...value, outputField: event.target.value }))
                    }
                  />
                </label>
              </div>
              <WorkflowParameterFields
                key={bindingFormVersion}
                nodeListId={nodeListId}
                capability={capability}
                initial={definition?.parameters}
              />
              <ExposedFieldsEditor
                fields={fields}
                graph={workflowNodes.length ? readWorkflowGraph(graphText) : undefined}
                change={(value) => {
                  setFields(value);
                  setDirtyForms((current) => ({ ...current, workflow: true }));
                }}
              />
              {editing && (
                <>
                  <p className="field-hint">
                    正在基于固定 v{editing.catalog.revision} 创建新修订；目录当前 v
                    {editing.catalog.headRevision}。旧定义与历史任务保持原样。
                  </p>
                  <label>
                    修订说明
                    <input
                      name="revisionSummary"
                      aria-label="工作流修订说明"
                      maxLength={1000}
                      required
                      defaultValue="更新工作流配置"
                    />
                  </label>
                </>
              )}
              <button>验证绑定并保存</button>
            </fieldset>
          </form>
        </details>
      )}
    </>
  );
}
