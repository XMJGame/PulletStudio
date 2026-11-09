import { useState } from 'react';
import type { BoardInputPort, BoardResolved } from '../../../../packages/contracts/src/board';
import { Dialog } from '../components/Dialog';
import { StudioButton, StudioIcon } from '../shared/ui/StudioUI';
import './group-output-picker.css';

export type GroupOutputChoice = {
  id: string;
  title: string;
  media?: BoardResolved['media'];
  ports: { port: BoardInputPort; label: string }[];
};

export function GroupOutputPicker({
  choices,
  onClose,
  onConnect,
}: {
  choices: GroupOutputChoice[];
  onClose: () => void;
  onConnect: (id: string, mediaId: string, port: BoardInputPort) => void;
}) {
  const [selected, setSelected] = useState<{ id: string; mediaId: string }>();
  const [port, setPort] = useState<BoardInputPort | ''>('');
  const item = choices.find((row) => row.id === selected?.id);
  const current = item && item.media?.id === selected?.mediaId && item.ports.some((row) => row.port === port);
  return (
    <Dialog
      title="选择组内产物"
      description="选择一份固定结果及输入用途，再连接到生成节点。"
      onClose={onClose}
      className="creative-group-picker"
    >
      <div className="dialog-body">
        {!choices.length && <p role="status">组内暂无可连接的结果，请先生成并加入结果卡。</p>}
        <div className="creative-group-output-grid" role="group" aria-label="组内固定产物">
          {choices.map((choice) => {
            const type = choice.media?.mediaType;
            const available = !!choice.media && choice.ports.length > 0;
            const poster = type === 'image' ? choice.media?.contentUrl : choice.media?.posterUrl;
            return (
              <button
                key={choice.id}
                type="button"
                disabled={!available}
                aria-label={`选择产物 ${choice.title}`}
                aria-pressed={choice.id === selected?.id}
                onClick={() => {
                  setSelected({ id: choice.id, mediaId: choice.media!.id });
                  setPort(choice.ports.length === 1 ? choice.ports[0].port : '');
                }}
              >
                <div className="creative-group-output-preview">
                  {poster ? (
                    <img src={poster} alt="" loading="lazy" />
                  ) : (
                    <StudioIcon
                      name={type === 'audio' ? 'audio' : type === 'video' ? 'film' : 'image'}
                      size={30}
                    />
                  )}
                </div>
                <strong>{choice.title}</strong>
                <small>
                  {type ? ({ image: '图片', video: '视频', audio: '音频' } as const)[type] : '结果不可用'}
                </small>
                {!available && <small>{choice.media ? '没有匹配的空输入' : '尚未完成或无权读取'}</small>}
              </button>
            );
          })}
        </div>
        {item && (
          <label>
            输入用途
            <select
              aria-label="组内产物输入用途"
              value={port}
              onChange={(event) => setPort(event.target.value as BoardInputPort | '')}
            >
              <option value="">请选择用途</option>
              {item.ports.map((row) => (
                <option key={row.port} value={row.port}>
                  {row.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {selected && !current && <p role="status">请选择可用的产物和输入用途；已有来源不会被覆盖。</p>}
      </div>
      <div className="dialog-footer">
        <StudioButton onClick={onClose}>取消连接</StudioButton>
        <StudioButton
          variant="primary"
          disabled={!current || !port}
          onClick={() => {
            if (selected && current && port) onConnect(selected.id, selected.mediaId, port);
          }}
        >
          连接产物
        </StudioButton>
      </div>
    </Dialog>
  );
}
