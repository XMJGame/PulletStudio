import { memo } from 'react';
import { LabData, labels, thumbnail } from './model';

export const NodeCard = memo(function NodeCard({ data }: { data: LabData }) {
  return (
    <article className={`lab-card kind-${data.kind}`}>
      <header>
        <span className="lab-kind">{labels[data.kind]}</span>
        <span className="lab-node-menu" aria-hidden="true">
          •••
        </span>
      </header>
      <strong>{data.title}</strong>
      {data.kind === 'text' ? (
        <p className="lab-prompt">{data.text}</p>
      ) : data.kind === 'generation' ? (
        <div className="lab-config">
          <span>视觉方案探索</span>
          <p>
            16:9 <b>·</b> 3个变体
          </p>
          <small>
            连接参考与提示词
            <br />
            这里只编排，不调用模型
          </small>
        </div>
      ) : data.kind === 'audio' ? (
        <div className="lab-wave" aria-label="声音示意波形">
          {Array.from({ length: 30 }, (_, i) => (
            <i key={i} style={{ height: `${12 + ((i * 17) % 55)}%` }} />
          ))}
        </div>
      ) : data.kind === 'result' ? (
        <div className="lab-variants">
          {[0, 1, 2].map((i) => (
            <img
              key={i}
              src={thumbnail(i)}
              alt={`方案${i + 1}示意图`}
              className={data.primary === i ? 'primary-variant' : ''}
              draggable={false}
            />
          ))}
        </div>
      ) : (
        <div className="lab-preview">
          <img src={thumbnail(data.variant)} alt="海边小站合成示意图" draggable={false} />
          {data.kind === 'video' && <span aria-hidden="true">▶</span>}
        </div>
      )}
      <footer>
        {data.kind === 'result'
          ? `主方案 ${data.primary + 1} · 仅演示比较`
          : data.kind === 'video' || data.kind === 'audio'
            ? '选中后，可在右侧试听本地文件'
            : data.kind === 'generation'
              ? '演示配置 · 尚未接入生成'
              : '演示资料 · 不属于正式项目'}
      </footer>
    </article>
  );
});
