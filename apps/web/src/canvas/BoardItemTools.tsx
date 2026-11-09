import { useState, type ReactNode } from 'react';
import type { BoardResolved } from '../../../../packages/contracts/src/board';
import { Dialog } from '../components/Dialog';
import { StudioIcon } from '../shared/ui/StudioUI';
export function BoardItemTools({
  children,
  value,
  editable,
  onRemove,
  onUseImage,
  onDetach,
}: {
  children: ReactNode;
  value?: BoardResolved;
  editable: boolean;
  onRemove: () => void;
  onUseImage?: () => void;
  onDetach?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>{value?.media ? '预览与详情' : '更多设置'}</button>
      {onUseImage && <button onClick={onUseImage}>以此图生成</button>}
      {editable && onDetach && <button onClick={onDetach}>移出分组</button>}
      {value?.media && (
        <a href={value.media.downloadUrl} download>
          下载原件
        </a>
      )}
      {editable && (
        <button onClick={onRemove} title="删除节点，保留素材原件">
          <StudioIcon name="trash" size={15} />
          删除
        </button>
      )}
      {open && (
        <Dialog
          title="节点详情与设置"
          description="查看固定引用、附加信息及分组；关闭后继续创作。"
          onClose={() => setOpen(false)}
          className="creative-item-dialog"
        >
          <div className="dialog-body">{children}</div>
          <div className="dialog-footer">
            <button onClick={() => setOpen(false)}>返回画布</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
