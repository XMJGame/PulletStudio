import { useEffect, useState } from 'react';
import { api } from '../api';
import type { MediaVersion } from '../media-types';
import { Dialog } from '../components/Dialog';
import { StudioButton } from '../shared/ui/StudioUI';
import type { LibraryFolder } from './LibraryFolderControls';
import './save-media-to-library.css';

export function SaveMediaToLibrary({
  mediaId,
  projectId,
  onClose,
  onSaved,
}: {
  mediaId: string;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [media, setMedia] = useState<MediaVersion>(),
    [folders, setFolders] = useState<LibraryFolder[]>([]),
    [name, setName] = useState(''),
    [folderId, setFolderId] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setMedia(undefined);
    setError('');
    void Promise.all([
      api<MediaVersion>(`/media-versions/${mediaId}`),
      api<LibraryFolder[]>(`/projects/${projectId}/library-folders`),
    ])
      .then(([value, rows]) => {
        if (!active) return;
        if (value.projectId !== projectId) throw new Error('素材不属于当前项目。');
        setMedia(value);
        setName(value.libraryName ?? value.fileName);
        setFolders(rows);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : '无法读取素材');
      });
    return () => {
      active = false;
    };
  }, [mediaId, projectId, retry]);
  return (
    <Dialog
      title="保存到素材库"
      description="选择文件夹，为素材取一个便于查找的名称。"
      className="creative-library-save"
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!media || busy) return;
          setBusy(true);
          setError('');
          void api(`/projects/${projectId}/library-media`, 'POST', {
            mediaVersionId: media.id,
            name: name.trim(),
            folderId: folderId || null,
            expectedAssetVersion: media.assetVersion ?? media.version,
          })
            .then(() => {
              onSaved();
              onClose();
            })
            .catch((reason) => setError(reason instanceof Error ? reason.message : '保存失败，输入已保留。'))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {!media && !error && <p role="status">正在读取素材…</p>}
          {!media && error && (
            <StudioButton onClick={() => setRetry((value) => value + 1)}>重新读取</StudioButton>
          )}
          {media && (
            <div className="creative-library-save-layout">
              <div className="creative-library-save-preview">
                {media.mediaType === 'image' ? (
                  <img src={media.contentUrl} alt="待收藏素材预览" />
                ) : media.mediaType === 'video' ? (
                  <video
                    src={media.contentUrl}
                    poster={media.posterUrl ?? undefined}
                    controls
                    preload="metadata"
                  />
                ) : (
                  <audio src={media.contentUrl} controls preload="metadata" />
                )}
              </div>
              {media.inLibrary ? (
                <p role="status">已在当前项目素材库，可在资源库中调整分类。</p>
              ) : (
                <fieldset disabled={busy} className="plain-fieldset">
                  <label>
                    目标素材库
                    <input value="当前项目素材库" readOnly />
                  </label>
                  <label>
                    文件夹
                    <select
                      aria-label="收藏文件夹"
                      value={folderId}
                      onChange={(event) => setFolderId(event.target.value)}
                    >
                      <option value="">未分组</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    名称
                    <input
                      aria-label="收藏名称"
                      required
                      maxLength={180}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                </fieldset>
              )}
            </div>
          )}
        </div>
        <div className="dialog-footer">
          <StudioButton disabled={busy} onClick={onClose}>
            取消
          </StudioButton>
          {media && !media.inLibrary && (
            <StudioButton type="submit" variant="primary" disabled={busy || !name.trim()}>
              {busy ? '保存中…' : '保存'}
            </StudioButton>
          )}
        </div>
      </form>
    </Dialog>
  );
}
