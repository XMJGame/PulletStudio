export type User = { id: string; name: string; email: string; instanceAdmin: boolean };
export type Workspace = { id: string; name: string; role: string };
export type Project = {
  id: string;
  workspaceId: string;
  code: string;
  title: string;
  aspectRatio: string;
  language: string;
  description: string;
  stylePreset: VisualStyle;
  styleDescription: string;
  workFormat: string;
  narrativeMode: string;
  targetDurationSeconds: number | null;
  directorNotes: string;
  version: number;
  deletedAt: string | null;
  deletedBy: string | null;
};
export type Episode = { id: string; code: string; title: string; orderIndex: number; version: number };
export type Shot = {
  id: string;
  code: string;
  sequence: number;
  description: string;
  camera: string;
  dialogue: string;
  durationHint: number;
  technique: string;
  version: number;
};
export type ProductionUnit = {
  id: string;
  projectId: string;
  kind: string;
  parentId: string | null;
  code: string;
  title: string;
  orderIndex: number;
  outline: string;
  targetDurationSeconds: number | null;
  version: number;
};
export type CursorPage<T> = { items: T[]; nextCursor: string | null };
export type Member = { id: string; name: string; email: string; role: string; workspaceRole?: string };
export type ScriptVersion = {
  id: string | null;
  projectId: string;
  version: number;
  title: string;
  content: string;
  summary: string;
  createdAt: string | null;
  authorName: string | null;
  restoredFromVersion: number | null;
  checksum: string;
  locked: boolean;
  lockVersion: number;
  lockedAt: string | null;
  lockedBy: string | null;
  source: {
    id: string;
    fileName: string;
    kind: string;
    origin: string;
    encoding: string;
    sha256: string;
    byteLength: number;
  } | null;
};
export type ScriptHistory = {
  items: Pick<
    ScriptVersion,
    'id' | 'version' | 'title' | 'summary' | 'createdAt' | 'authorName' | 'restoredFromVersion'
  >[];
  nextCursor: number | null;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
let csrfToken = '';
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Studio-Request': '1',
      'X-CSRF-Token': csrfToken,
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.code, data.message || '请求失败');
  if (typeof data.csrfToken === 'string') csrfToken = data.csrfToken;
  return data as T;
}
import type { VisualStyle } from './visual-style';
export async function uploadMediaContent<T>(id: string, file: File, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/media-uploads/${id}/content`, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Studio-Request': '1',
      'X-CSRF-Token': csrfToken,
    },
    body: file,
    signal,
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.code, data.message || '上传未完成');
  return data as T;
}
