import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
export type LibraryFolder = { id: string; name: string; version: number };
export function LibraryFolderControls({
  projectId,
  editable,
  folders,
  onFolders,
  value,
  onChange,
  apiPath,
}: {
  projectId: string;
  editable: boolean;
  folders: LibraryFolder[];
  onFolders: (folders: LibraryFolder[]) => void;
  value: string;
  onChange: (id: string) => void;
  apiPath?: string;
}) {
  const [action, setAction] = useState<'create' | 'rename' | 'delete'>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef({ name: '', key: '' });
  const selection = useRef(value);
  selection.current = value;
  const selected = folders.find((folder) => folder.id === value);
  const path = apiPath ?? `/projects/${projectId}/library-folders`;
  useEffect(() => {
    let active = true;
    api<LibraryFolder[]>(path).then(
      (rows) => {
        if (active) {
          onFolders(rows);
          setLoadError('');
          if (
            selection.current &&
            selection.current !== 'root' &&
            !rows.some((row) => row.id === selection.current)
          )
            onChange('root');
        }
      },
      (reason) => {
        if (active) setLoadError(reason.message || '文件夹读取失败');
      },
    );
    return () => {
      active = false;
    };
  }, [path, retry, onFolders, onChange]);
  function open(next: typeof action) {
    setAction(next);
    setName(next === 'rename' ? (selected?.name ?? '') : '');
    setError('');
  }
  async function submit() {
    if (busy || !action) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'create') {
        const title = name.trim();
        if (request.current.name !== title) request.current = { name: title, key: crypto.randomUUID() };
        const folder = await api<LibraryFolder>(
          path,
          'POST',
          { name: title },
          { 'Idempotency-Key': request.current.key },
        );
        onFolders(await api<LibraryFolder[]>(path));
        onChange(folder.id);
      } else if (selected) {
        await api(`${path}/${selected.id}`, action === 'rename' ? 'PATCH' : 'DELETE', {
          expectedVersion: selected.version,
          ...(action === 'rename' ? { name: name.trim() } : {}),
        });
        onFolders(await api<LibraryFolder[]>(path));
        if (action === 'delete') onChange('root');
      } else throw new Error('文件夹已移除，请选择其他文件夹');
      setAction(undefined);
      setName('');
      request.current = { name: '', key: '' };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文件夹操作失败');
      setRetry((current) => current + 1);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="creative-library-folders" aria-label="资源文件夹">
      <label>
        文件夹
        <select
          aria-label="资源文件夹"
          disabled={busy}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setAction(undefined);
          }}
        >
          <option value="">全部资源</option>
          <option value="root">未分类</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>
      {editable && (
        <div className="creative-folder-actions">
          <button aria-label="新建文件夹" disabled={busy} onClick={() => open('create')}>
            ＋ 新建
          </button>
          {selected && (
            <>
              <button aria-label="重命名文件夹" disabled={busy} onClick={() => open('rename')}>
                改名
              </button>
              <button aria-label="删除文件夹" disabled={busy} onClick={() => open('delete')}>
                删除
              </button>
            </>
          )}
        </div>
      )}
      {action && (
        <form
          className="creative-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {action === 'delete' ? (
            <p className="field-hint">删除「{selected?.name}」后，内容归入未分类。</p>
          ) : (
            <label>
              文件夹名称
              <input
                aria-label="文件夹名称"
                autoFocus
                required
                maxLength={80}
                value={name}
                disabled={busy}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          <div className="creative-folder-actions">
            <button disabled={busy || (action !== 'delete' && !name.trim())} type="submit">
              {action === 'delete' ? '确认删除文件夹' : '保存文件夹'}
            </button>
            <button disabled={busy} type="button" onClick={() => setAction(undefined)}>
              取消
            </button>
          </div>
        </form>
      )}
      {(error || loadError) && (
        <p role="alert">
          {error || loadError}
          <button disabled={busy} onClick={() => setRetry((current) => current + 1)}>
            刷新文件夹
          </button>
        </p>
      )}
    </section>
  );
}
