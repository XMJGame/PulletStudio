import { useEffect, useState, type ReactNode } from 'react';
import type { BoardNode, BoardResolved } from '../../../../packages/contracts/src/board';
import { Dialog } from '../components/Dialog';
import { kindLabels, statusLabels } from './board-types';
const fields: Record<string, string> = {
  code: '镜头编号',
  version: '固定版本',
  body: '制作卡',
  summary: '修订说明',
  kind: '资产类型',
  revision: '资产修订',
  metadata: '文件信息',
  origin: '来源',
  fileName: '原始文件名',
  name: '名称',
  title: '标题',
  description: '描述',
  intent: '创作意图',
  framing: '景别',
  angle: '角度',
  composition: '构图',
  cameraMovement: '运镜',
  action: '动作',
  lighting: '光线',
  mood: '情绪',
  dialogue: '对白',
  audioNotes: '声音说明',
  technique: '制作方式',
  durationSeconds: '计划时长（秒）',
  assets: '候选资产',
  riskNotes: '待核对',
  attributes: '创作属性',
  appearance: '外观',
  costume: '服装',
  state: '状态',
  continuityNotes: '连续性说明',
  layout: '空间布局',
  scale: '尺度',
  material: '材质',
  language: '语言',
  timbre: '音色',
  usageRights: '使用权说明',
  consentStatus: '授权确认',
  media: '媒体引用',
  role: '用途',
  mediaType: '媒体类型',
  width: '宽度',
  height: '高度',
  durationMs: '时长（毫秒）',
  hasAudio: '包含音频',
  status: '审批状态',
};
function ReadableDetails({ value }: { value: unknown }) {
  if (Array.isArray(value))
    return (
      <ul>
        {value.map((item, index) => (
          <li key={index}>
            <ReadableDetails value={item} />
          </li>
        ))}
      </ul>
    );
  if (value && typeof value === 'object')
    return (
      <dl className="creative-detail-fields">
        {Object.entries(value)
          .filter(([key]) => fields[key])
          .map(([key, raw]) => (
            <div key={key}>
              <dt>{fields[key]}</dt>
              <dd>
                <ReadableDetails value={raw} />
              </dd>
            </div>
          ))}
      </dl>
    );
  return (
    <span>
      {typeof value === 'boolean'
        ? value
          ? '是'
          : '否'
        : (kindLabels[String(value)] ?? String(value ?? '未填写'))}
    </span>
  );
}
export function BoardInspector({
  node,
  value,
  nodes,
  editable,
  update,
  remove,
  detail,
  onDetail,
  closeDetail,
  executionPanel,
}: {
  node?: BoardNode;
  value?: BoardResolved;
  nodes: BoardNode[];
  editable: boolean;
  update: (node: BoardNode) => void;
  remove: () => void;
  detail?: BoardResolved;
  onDetail: () => void;
  closeDetail: () => void;
  executionPanel?: ReactNode;
}) {
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => setMediaError(false), [node?.id, value?.media?.contentUrl]);
  return (
    <aside className="creative-inspector" aria-label="画布检查器">
      <h3>{node ? (kindLabels[value?.kind ?? node.type] ?? '业务引用') : '创作检查器'}</h3>
      {!node && (
        <p className="field-hint">
          从左侧选择正式项目资源，或添加便签。连线只记录创作关系，不修改镜头和资产。
        </p>
      )}
      {node && (
        <>
          {node.type === 'generation' ? (
            executionPanel
          ) : node.type === 'reference' || node.type === 'result' ? (
            <>
              <strong>{value?.title ?? '正在解析引用'}</strong>
              <p className={`creative-reference-state ${value?.status ?? ''}`}>
                {value &&
                  (node.type === 'result' && value.status === 'draft'
                    ? '尚未完成'
                    : statusLabels[value.status])}
                {value?.version ? ` · 固定v${value.version}` : ''}
              </p>
              {value?.currentVersion && value.currentVersion !== value.version && (
                <p className="field-hint">业务当前v{value.currentVersion}；画布继续引用固定版本。</p>
              )}
              <p className="creative-summary">{value?.summary}</p>
              {value?.status !== 'unavailable' && value?.detail && (
                <button onClick={onDetail}>查看固定版本详情</button>
              )}
              {value?.media && !mediaError && (
                <div className="creative-media">
                  {value.media.mediaType === 'image' ? (
                    <img src={value.media.contentUrl} alt={value.title} onError={() => setMediaError(true)} />
                  ) : value.media.mediaType === 'video' ? (
                    <video
                      key={value.media.id}
                      src={value.media.contentUrl}
                      poster={value.media.posterUrl ?? undefined}
                      preload="metadata"
                      controls
                      onError={() => setMediaError(true)}
                    />
                  ) : (
                    <audio
                      key={value.media.id}
                      src={value.media.contentUrl}
                      preload="metadata"
                      controls
                      onError={() => setMediaError(true)}
                    />
                  )}
                  <p className="field-hint">
                    {value.media.fileName}
                    {value.media.metadata.durationMs
                      ? ` · ${(value.media.metadata.durationMs / 1000).toFixed(2)}秒`
                      : ''}
                  </p>
                  <a href={value.media.downloadUrl} download>
                    下载固定媒体原件
                  </a>
                </div>
              )}
              {mediaError && (
                <p className="notice error" role="status">
                  媒体无法读取或播放，请核对文件、权限与浏览器编码。引用保持原版本。
                </p>
              )}
            </>
          ) : node.type === 'group' ? (
            <>
              <label>
                分组名称
                <input
                  aria-label="分组名称"
                  disabled={!editable}
                  maxLength={100}
                  value={node.data.label}
                  onChange={(e) => update({ ...node, data: { ...node.data, label: e.target.value } })}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={node.data.collapsed}
                  disabled={!editable}
                  onChange={(e) => update({ ...node, data: { ...node.data, collapsed: e.target.checked } })}
                />
                折叠分组
              </label>
            </>
          ) : (
            <label>
              {kindLabels[node.type]}
              <textarea
                aria-label="画布文字内容"
                rows={7}
                maxLength={node.type === 'note' ? 16000 : 4000}
                disabled={!editable}
                value={node.data.text}
                onChange={(e) =>
                  update({
                    ...node,
                    data: {
                      ...node.data,
                      text: e.target.value,
                      ...(node.data.prompt
                        ? { prompt: { ...node.data.prompt, promptLibraryRevisionId: undefined } }
                        : {}),
                    },
                  })
                }
              />
            </label>
          )}
          {node.type === 'note' && node.data.prompt && (
            <details>
              <summary>提示词附加信息</summary>
              <label>
                负向提示词
                <textarea
                  aria-label="便签负向提示词"
                  rows={2}
                  maxLength={16000}
                  disabled={!editable}
                  value={node.data.prompt.negativePrompt}
                  onChange={(event) =>
                    update({
                      ...node,
                      data: {
                        ...node.data,
                        prompt: {
                          ...node.data.prompt!,
                          negativePrompt: event.target.value,
                          promptLibraryRevisionId: undefined,
                        },
                      },
                    })
                  }
                />
              </label>
              <label>
                来源说明
                <input
                  aria-label="便签提示词来源"
                  maxLength={300}
                  disabled={!editable}
                  value={node.data.prompt.source}
                  onChange={(event) =>
                    update({
                      ...node,
                      data: {
                        ...node.data,
                        prompt: {
                          ...node.data.prompt!,
                          source: event.target.value,
                          promptLibraryRevisionId: undefined,
                        },
                      },
                    })
                  }
                />
              </label>
            </details>
          )}
          {node.type !== 'group' && (
            <label>
              所属分组
              <select
                aria-label="所属分组"
                disabled={!editable}
                value={node.parentId ?? ''}
                onChange={(e) =>
                  update({ ...node, parentId: e.target.value || undefined, position: { x: 30, y: 70 } })
                }
              >
                <option value="">画布根层</option>
                {nodes
                  .filter((n) => n.type === 'group')
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.label}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {editable && (
            <button className="creative-remove" onClick={remove}>
              移除画布节点
            </button>
          )}
        </>
      )}
      {detail && (
        <Dialog
          title="固定业务版本详情"
          description="重新授权后读取正式业务版本；此处只查看，不修改业务数据。"
          onClose={closeDetail}
        >
          <div className="dialog-body">
            <h3>
              {detail.title} · v{detail.version}
            </h3>
            <p>{detail.summary}</p>
            <ReadableDetails value={detail.detail} />
          </div>
          <div className="dialog-footer">
            <button onClick={closeDetail}>关闭详情</button>
          </div>
        </Dialog>
      )}
    </aside>
  );
}
