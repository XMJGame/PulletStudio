import { useEffect, useRef, useState } from 'react';
import type { BoardSource } from '../../../../packages/contracts/src/board';
import { api, ApiError } from '../api';
import { approvalLabels } from '../entity-types';
import { StudioButton } from '../shared/ui/StudioUI';

type RevisionOption = { id: string; version: number; name: string; status: keyof typeof approvalLabels };
type History = { items: RevisionOption[]; nextCursor: number | null };

export function BoardEntityVersions({
  source,
  selected,
  change,
  onDenied,
}: {
  source: BoardSource;
  selected: string;
  change: (revisionId: string) => void;
  onDenied: (reason: unknown) => void;
}) {
  const [history, setHistory] = useState<History>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  const id = source.ref.id;
  function failed(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '无法读取资产历史');
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      setHistory({ items: [], nextCursor: null });
      denied.current(reason);
    }
  }
  useEffect(() => {
    const ticket = ++epoch.current;
    setHistory({ items: [], nextCursor: null });
    setError('');
    setLoading(true);
    void api<History>(`/entities/${id}/revisions`)
      .then((value) => {
        if (ticket === epoch.current) setHistory(value);
      })
      .catch((reason) => {
        if (ticket === epoch.current) failed(reason);
      })
      .finally(() => {
        if (ticket === epoch.current) setLoading(false);
      });
    return () => {
      epoch.current++;
    };
  }, [id, retry]);
  const options = history.items;
  return (
    <div className="v2-entity-versions">
      <label>
        资产版本
        <select aria-label="资产固定版本" value={selected} onChange={(e) => change(e.target.value)}>
          {!options.some((item) => item.id === selected) && (
            <option value={selected}>
              {selected === (source.ref.kind === 'entity' ? source.ref.revisionId : '')
                ? `v${source.value.version ?? 1} · ${source.value.title}`
                : '所选固定版本'}
            </option>
          )}
          {options.map((item) => (
            <option key={item.id} value={item.id}>
              v{item.version} · {item.name} · {approvalLabels[item.status]}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">只选用此版本，已有画布引用保持原样。</p>
      {loading && <p role="status">正在读取资产历史…</p>}
      {error && (
        <div role="alert" className="notice error">
          {error}
          <StudioButton variant="ghost" disabled={loading} onClick={() => setRetry((n) => n + 1)}>
            重新读取资产历史
          </StudioButton>
        </div>
      )}
      {history.nextCursor && !error && (
        <StudioButton
          variant="ghost"
          disabled={loading}
          onClick={() => {
            const ticket = epoch.current;
            setLoading(true);
            setError('');
            void api<History>(`/entities/${id}/revisions?before=${history.nextCursor}`)
              .then((more) => {
                if (ticket === epoch.current)
                  setHistory((old) => ({
                    ...more,
                    items: [
                      ...old.items,
                      ...more.items.filter((item) => !old.items.some((v) => v.id === item.id)),
                    ],
                  }));
              })
              .catch((reason) => {
                if (ticket === epoch.current) failed(reason);
              })
              .finally(() => {
                if (ticket === epoch.current) setLoading(false);
              });
          }}
        >
          更早的资产版本
        </StudioButton>
      )}
    </div>
  );
}
