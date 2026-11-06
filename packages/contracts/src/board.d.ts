export type BoardReference =
  | { kind: 'shot'; id: string; version: number }
  | { kind: 'entity'; id: string; revisionId: string }
  | { kind: 'media'; id: string };
export type BoardNode = {
  id: string;
  type: 'note' | 'brief' | 'reference' | 'group' | 'generation' | 'result';
  position: { x: number; y: number };
  width: number;
  height: number;
  parentId?: string;
  data: {
    text?: string;
    label?: string;
    collapsed?: boolean;
    ref?: BoardReference;
    jobId?: string;
    generation?: {
      workflowId?: string;
      parameterValues?: Partial<Record<'aspectRatio' | 'durationSeconds' | 'seed', string | number>>;
      fieldValues?: Record<string, string | number | boolean>;
    };
    prompt?: { negativePrompt: string; source: string; promptLibraryRevisionId?: string };
  };
};
export type BoardLayout = {
  schemaVersion: 'studio.board.v1';
  viewport: { x: number; y: number; zoom: number };
  nodes: BoardNode[];
  edges: BoardEdge[];
};
export type BoardInputPort = 'prompt' | 'first_frame' | `reference:${string}`;
export type BoardEdge = {
  id: string;
  source: string;
  target: string;
  kind?: 'annotation' | 'input_binding';
  sourcePort?: 'text' | 'image' | 'video' | 'audio';
  targetPort?: BoardInputPort;
};
export type BoardExecution = {
  boardId: string;
  revision: number;
  nodeId: string;
  bindings: { port: BoardInputPort; sourceNodeId: string }[];
};
export type BoardResolved = {
  status: 'current' | 'stale' | 'draft' | 'revoked' | 'unavailable';
  title: string;
  kind?: string;
  version?: number;
  currentVersion?: number;
  approval?: string;
  summary?: string;
  media?: {
    id: string;
    fileName: string;
    mediaType: 'image' | 'video' | 'audio';
    contentUrl: string;
    posterUrl: string | null;
    downloadUrl: string;
    metadata: { width: number | null; height: number | null; durationMs: number | null; hasAudio: boolean };
  };
  detail?: Record<string, unknown>;
};
export type BoardView = {
  id: string;
  projectId: string;
  unitId: string | null;
  unitTitle: string | null;
  title: string;
  revision: number;
  headRevision: number;
  canEdit: boolean;
  createdAt: string;
  layout: BoardLayout;
  resolved: Record<string, BoardResolved>;
};
export type BoardListItem = {
  id: string;
  title: string;
  unitId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type BoardSource = { ref: BoardReference; value: BoardResolved; ready: boolean };
