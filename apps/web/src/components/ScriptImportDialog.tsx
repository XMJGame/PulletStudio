import { useState } from 'react';
import { api, ApiError, ScriptVersion } from '../api';
import { Dialog } from './Dialog';

type FileSource = { type: 'file'; fileName: string; base64: string };
export function ScriptImportDialog({
  projectId,
  baseline,
  onClose,
  onImported,
  onUnauthorized,
}: {
  projectId: string;
  baseline: ScriptVersion;
  onClose: () => void;
  onImported: (value: ScriptVersion) => void;
  onUnauthorized: () => void;
}) {
  const [mode, setMode] = useState('file');
  const [title, setTitle] = useState(baseline.version ? baseline.title : '');
  const [kind, setKind] = useState('script');
  const [text, setText] = useState('');
  const [source, setSource] = useState<FileSource>();
  const [fileText, setFileText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [expectedVersion, setExpectedVersion] = useState(baseline.version);
  const [conflict, setConflict] = useState(false);
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '导入失败');
    setConflict(reason instanceof ApiError && reason.code === 'VERSION_CONFLICT');
  }
  async function read(file?: File) {
    setSource(undefined);
    setFileText('');
    setError('');
    if (!file) return;
    setReading(true);
    try {
      if (!/\.(txt|md|markdown)$/i.test(file.name))
        throw new Error('请选择 TXT 或 Markdown 文件。DOCX/PDF 将在后续支持。');
      if (file.size > 180000 || !file.size) throw new Error('原文件须在 1–180,000 字节以内。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let content: string;
      try {
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        throw new Error('文件不是 UTF-8 编码，请另存为 UTF-8 后重试。');
      }
      if (content.startsWith('\uFEFF')) content = content.slice(1);
      if (
        content.length > 60000 ||
        !content.trim() ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)
      )
        throw new Error('正文须非空、最多 60,000 字符，且不能包含二进制控制字符。');
      let binary = '';
      for (let index = 0; index < bytes.length; index += 4096)
        binary += String.fromCharCode(...bytes.subarray(index, index + 4096));
      setSource({ type: 'file', fileName: file.name, base64: btoa(binary) });
      setFileText(content);
      if (!title.trim()) setTitle(file.name.replace(/\.(txt|md|markdown)$/i, '').slice(0, 200));
    } catch (reason) {
      report(reason);
    } finally {
      setReading(false);
    }
  }
  const preview = mode === 'file' ? fileText : text;
  return (
    <Dialog
      title="导入剧本"
      description="预览并确认原文，导入会新增版本，保留现有历史。"
      busy={busy || reading}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || reading || !preview.trim()) return;
          setBusy(true);
          setError('');
          void api<ScriptVersion>(`/projects/${projectId}/script/import`, 'POST', {
            expectedVersion,
            title,
            kind,
            source: mode === 'file' ? source : { type: 'paste', text },
          })
            .then(onImported)
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          <fieldset className="plain-fieldset" disabled={busy || reading}>
            {error && (
              <div role="alert" className="notice error">
                {error}
                {conflict && '。当前预览已保留，可刷新版本后再次确认导入。'}
              </div>
            )}
            <div className="dialog-field-row">
              <label>
                导入方式
                <select value={mode} onChange={(event) => setMode(event.target.value)}>
                  <option value="file">TXT / Markdown 文件</option>
                  <option value="paste">粘贴文本</option>
                </select>
              </label>
              <label>
                原文类型
                <select value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="novel">小说</option>
                  <option value="script">剧本</option>
                  <option value="narration">旁白</option>
                  <option value="brief">广告 Brief</option>
                </select>
              </label>
            </div>
            <label>
              导入后的剧本标题
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                data-autofocus
              />
            </label>
            {mode === 'file' ? (
              <>
                <label>
                  选择原文文件
                  <input
                    type="file"
                    accept=".txt,.md,.markdown,text/plain,text/markdown"
                    onChange={(event) => void read(event.target.files?.[0])}
                  />
                </label>
                <p className="field-hint">
                  仅支持 UTF-8，最大 180,000 字节 / 60,000 字符；原文件独立保留，正文仅去除开头 BOM。
                </p>
                <label>
                  导入内容预览
                  <textarea rows={10} readOnly value={fileText} placeholder="选择文件后，在这里核对原文。" />
                </label>
              </>
            ) : (
              <label>
                粘贴原文
                <textarea
                  rows={10}
                  required
                  maxLength={60000}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="粘贴小说、剧本、旁白或广告 Brief；系统不会自动改写。"
                />
              </label>
            )}
            <p className="field-hint">
              {preview.length.toLocaleString()} / 60,000 字符 · 将在 v{expectedVersion}{' '}
              后新增版本。请核对缺字、顺序和换行；导入不会调用模型或自动创建镜头。
            </p>
          </fieldset>
        </div>
        <div className="dialog-footer">
          {conflict && (
            <button
              type="button"
              disabled={busy || reading}
              onClick={() => {
                setBusy(true);
                void api<ScriptVersion>(`/projects/${projectId}/script`)
                  .then((value) => {
                    if (value.locked) throw new Error('最新剧本已锁定，请关闭后由管理员解锁。');
                    setExpectedVersion(value.version);
                    setConflict(false);
                    setError('');
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              刷新版本后重试
            </button>
          )}
          <button type="button" disabled={busy || reading} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy || reading || conflict || !preview.trim() || (mode === 'file' && !source)}
          >
            导入为新版本
          </button>
        </div>
      </form>
    </Dialog>
  );
}
