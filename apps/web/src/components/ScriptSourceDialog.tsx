import { useEffect, useRef, useState } from 'react';
import { api, ApiError, ScriptVersion } from '../api';
import { Dialog } from './Dialog';

type Span = {
  id: string;
  revisionId: string;
  startOffset: number;
  endOffset: number;
  text: string;
  textHash: string;
};
type Page = {
  revisionId: string;
  offsetUnit: 'utf16';
  checksum: string;
  items: Span[];
  nextCursor: number | null;
};
const kinds: Record<string, string> = {
  novel: '小说',
  script: '剧本',
  narration: '旁白',
  brief: '广告 Brief',
};
export function ScriptSourceDialog({
  projectId,
  revision,
  onClose,
  onUnauthorized,
}: {
  projectId: string;
  revision: ScriptVersion;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [page, setPage] = useState<Page>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Span>();
  const content = useRef<HTMLTextAreaElement>(null);
  const path = `/projects/${projectId}/script/versions/${revision.version}`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '无法读取原文定位');
  }
  useEffect(() => {
    let active = true;
    setBusy(true);
    void api<Page>(`${path}/spans`)
      .then((value) => {
        if (value.checksum !== revision.checksum) throw new Error('版本校验不一致，请关闭后重新加载剧本。');
        if (active) setPage(value);
      })
      .catch((reason) => {
        if (active) report(reason);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, revision.id]);
  return (
    <Dialog
      title={`原文与段落 · v${revision.version}`}
      description="定位基于此已保存版本，后续修订不会改变这里的原文。"
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {revision.source ? (
          <div className="source-evidence">
            <strong>{revision.source.fileName}</strong>
            <p>
              {kinds[revision.source.kind]} · UTF-8 · {revision.source.byteLength.toLocaleString()} 字节
            </p>
            <small>原文件 SHA256：{revision.source.sha256}</small>
            <a className="source-download" href={`/api/v1${path}/source`} download>
              下载导入原文
            </a>
          </div>
        ) : (
          <p className="field-hint">
            此版本由编辑或历史恢复创建，没有独立导入文件；完整正文仍保存在此历史版本中。
          </p>
        )}
        <label>
          已保存原文
          <textarea ref={content} readOnly rows={9} value={revision.content} />
        </label>
        {selected && (
          <p role="status" className="field-hint">
            已定位原文 {selected.startOffset}–{selected.endOffset}；偏移单位为 UTF-16，区间左闭右开。
          </p>
        )}
        <h3>段落定位</h3>
        <p className="field-hint">包括空行和换行符；点选段落，在上方原文中选中对应文字。</p>
        <div className="source-spans">
          {page?.items.map((span, index) => (
            <button
              key={span.id}
              aria-label={`定位段落 ${index + 1}`}
              onClick={() => {
                setSelected(span);
                content.current?.focus();
                // Browsers normalize textarea CR/CRLF to LF; evidence offsets stay unchanged.
                const domOffset = (offset: number) =>
                  revision.content.slice(0, offset).replace(/\r\n?/g, '\n').length;
                content.current?.setSelectionRange(domOffset(span.startOffset), domOffset(span.endOffset));
                content.current?.scrollIntoView({ block: 'nearest' });
              }}
            >
              <span>
                {index + 1} · {span.startOffset}–{span.endOffset}
              </span>
              <p>{span.text.trim() || '（空行）'}</p>
            </button>
          ))}
        </div>
        {busy && <p role="status">正在读取原文段落…</p>}
        {page?.nextCursor !== null && page?.nextCursor !== undefined && (
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void api<Page>(`${path}/spans?after=${page.nextCursor}`)
                .then((value) =>
                  setPage((current) => ({ ...value, items: [...(current?.items || []), ...value.items] })),
                )
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            加载更多段落
          </button>
        )}
      </div>
    </Dialog>
  );
}
