import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { StudioIcon } from '../../shared/ui/StudioUI';
import type { RunState, StudioMedia } from './studio-canvas-types';
export type StudioNode = Node<
  {
    label: string;
    role: string;
    media?: StudioMedia;
    prompt?: string;
    state?: RunState;
    onPreview?: (media: StudioMedia) => void;
  },
  'studio'
>;
const stateText: Record<RunState, string> = {
  idle: '待生成',
  running: '正在生成',
  completed: '生成完成',
  failed: '生成失败',
};
export function StudioCanvasNode({ data, selected }: NodeProps<StudioNode>) {
  const frame = data.media;
  return (
    <article
      className={`v2-node ${frame ? 'v2-node-visual' : 'v2-node-info'} ${selected ? 'v2-node-selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} aria-label={`${data.label}输入`} />
      {frame ? (
        <>
          <div className="v2-node-art">
            <img src={frame.image} alt={frame.title} draggable={false} />
            {frame.kind === 'video' && (
              <button
                type="button"
                className="v2-node-play nodrag"
                aria-label={`播放 ${frame.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  data.onPreview?.(frame);
                }}
              >
                <StudioIcon name="play" size={17} />
              </button>
            )}
            <span className="v2-node-badge">
              <StudioIcon name={frame.kind === 'video' ? 'film' : 'image'} size={13} />
              {data.role}
            </span>
            {frame.duration && <span className="v2-node-duration">{frame.duration}</span>}
          </div>
          <div className="v2-node-caption">
            <strong>{data.label}</strong>
          </div>
        </>
      ) : (
        <>
          <div className="v2-node-info-heading">
            <span>
              <StudioIcon name={data.state ? 'spark' : 'note'} size={17} />
            </span>
            <div>
              <strong>{data.label}</strong>
              <small>{data.state ? stateText[data.state] : data.role}</small>
            </div>
          </div>
          {data.prompt && <p>{data.prompt}</p>}
          {data.state === 'running' && <div className="v2-node-progress" />}
        </>
      )}
      <Handle type="source" position={Position.Right} aria-label={`${data.label}输出`} />
    </article>
  );
}
