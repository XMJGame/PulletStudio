import { useEffect, useRef, useState } from 'react';
import type { BoardSource } from '../../../../packages/contracts/src/board';
import { api, ApiError, type CursorPage } from '../api';

export function useBoardSources(path: string, refresh: number, report: (reason: unknown) => void) {
  const [rows, setRows] = useState<BoardSource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const scope = `${path}:${refresh}:${retry}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const reporter = useRef(report);
  reporter.current = report;
  function failed(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '无法读取项目资源');
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      setRows([]);
      setCursor(null);
    }
    reporter.current(reason);
  }
  useEffect(() => {
    const ticket = ++epoch.current;
    setRows([]);
    setCursor(null);
    setError('');
    setLoading(true);
    const live = () => ticket === epoch.current && scope === currentScope.current;
    const timer = window.setTimeout(
      () =>
        void api<CursorPage<BoardSource>>(path)
          .then((value) => {
            if (live()) {
              setRows(value.items);
              setCursor(value.nextCursor);
            }
          })
          .catch((reason) => {
            if (live()) failed(reason);
          })
          .finally(() => {
            if (live()) setLoading(false);
          }),
      180,
    );
    return () => {
      epoch.current++;
      window.clearTimeout(timer);
    };
  }, [path, refresh, retry]);
  async function loadMore() {
    if (loading || !cursor) return;
    const ticket = epoch.current;
    setLoading(true);
    setError('');
    const live = () => ticket === epoch.current && scope === currentScope.current;
    try {
      const value = await api<CursorPage<BoardSource>>(`${path}&cursor=${encodeURIComponent(cursor)}`);
      if (live()) {
        setRows((old) => [
          ...old,
          ...value.items.filter(
            (item) => !old.some((row) => JSON.stringify(row.ref) === JSON.stringify(item.ref)),
          ),
        ]);
        setCursor(value.nextCursor);
      }
    } catch (reason) {
      if (live()) failed(reason);
    } finally {
      if (live()) setLoading(false);
    }
  }
  return { rows, cursor, loading, error, loadMore, reload: () => setRetry((value) => value + 1) };
}
