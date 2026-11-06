import { useState } from 'react';
import { GenerationDialog } from './GenerationDialog';
import { MediaDialog } from './MediaDialog';
import { EntityLibraryDialog } from './EntityLibraryDialog';

export function CreationWorkspace({
  projectId,
  canEdit,
  onCanvas,
  onWorkflows,
}: {
  projectId: string;
  canEdit: boolean;
  onCanvas: () => void;
  onWorkflows: () => void;
}) {
  const [tool, setTool] = useState<'generation' | 'media' | 'entities'>();
  return (
    <section className="creation-home" aria-label="项目创作">
      <div className="panel creation-intro">
        <span className="eyebrow">CREATE & REUSE</span>
        <h2>从一个想法开始</h2>
        <p className="muted">粘贴提示词，生成图片或视频。把满意的结果存为素材，在画布中继续创作。</p>
        <button className="primary" onClick={() => setTool('generation')}>
          {canEdit ? '开始生成' : '查看生成结果'}
        </button>
      </div>
      <div className="creation-actions">
        <article className="panel">
          <h3>项目素材</h3>
          <p className="muted">导入参考文件，浏览保存的生成结果与素材版本。</p>
          <button onClick={() => setTool('media')}>打开素材库</button>
        </article>
        <article className="panel">
          <h3>创作画布</h3>
          <p className="muted">整理参考、提示词与结果，在同一处探索和生成。</p>
          <button onClick={onCanvas}>打开画布</button>
        </article>
        <article className="panel">
          <h3>工作流</h3>
          <p className="muted">选择可用的生成能力，管理工作流配置与测试。</p>
          <button onClick={onWorkflows}>管理工作流</button>
        </article>
      </div>
      <details>
        <summary>角色、场景与其他语义资产</summary>
        <p className="muted">需要跨画面保持设定时，可按需整理命名、描述和参考素材。</p>
        <button onClick={() => setTool('entities')}>管理语义资产</button>
      </details>
      {tool === 'generation' && (
        <GenerationDialog creation={{ projectId }} onClose={() => setTool(undefined)} />
      )}
      {tool === 'media' && <MediaDialog projectId={projectId} onClose={() => setTool(undefined)} />}
      {tool === 'entities' && (
        <EntityLibraryDialog projectId={projectId} onClose={() => setTool(undefined)} />
      )}
    </section>
  );
}
