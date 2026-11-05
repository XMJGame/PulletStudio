export type TextModel = {
  id: string;
  name: string;
  model: string;
  outputMode: string;
  tokenParameter: string;
  maxOutputTokens: number;
  timeoutSeconds: number;
  enabled: boolean;
  version: number;
};
export type TextConnection = {
  id: string;
  name: string;
  baseUrl: string;
  trustedPrivate: boolean;
  hasApiKey: boolean;
  enabled: boolean;
  version: number;
  profiles: TextModel[];
};
export type TextConnectionList = { encryptionReady: boolean; items: TextConnection[] };
export type AnalysisChunk = {
  index: number;
  startOffset: number;
  endOffset: number;
  blockCount: number;
  preview: string;
  analyzable: boolean;
};
export type AnalysisSource = {
  id: string;
  revisionId: string;
  startOffset: number;
  endOffset: number;
  textHash: string;
  text: string;
};
export type DraftShot = {
  title: string;
  intent: string;
  description: string;
  framing: string;
  angle: string;
  composition: string;
  cameraMovement: string;
  action: string;
  lighting: string;
  mood: string;
  dialogue: string;
  audioNotes: string;
  durationSeconds: number | null;
  technique: string;
  assets: string[];
  riskNotes: string[];
  sourceSpanIds: string[];
  sources: Omit<AnalysisSource, 'text'>[];
};
export type AnalysisRun = {
  id: string;
  projectId: string;
  state: string;
  version: number;
  attempts: number;
  nextRunAt: number;
  errorCode: string | null;
  errorMessage: string | null;
  model: string;
  profileName: string;
  connectionName: string;
  revisionVersion: number;
  chunkIndex: number;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  updatedAt: string;
};
export type AnalysisDetail = AnalysisRun & {
  traceId: string;
  providerTaskId: string | null;
  contextSummary: string;
  settings: { version: number; workFormat: string; narrativeMode: string; directorNotes: string };
  sources: AnalysisSource[];
  proposal: ProposalReview | null;
};
export type ProposalReview = {
  id: string;
  projectId: string;
  runId: string;
  version: number;
  status: 'draft' | 'rejected' | 'accepted';
  body: { title: string; summary: string; shots: DraftShot[] };
  canEdit: boolean;
  canReview: boolean;
  summary: string;
  updatedAt: string;
  sources: AnalysisSource[];
  adoptedShots: {
    id: string;
    code: string;
    version: number;
    unitId: string | null;
    candidateIndex: number;
  }[];
  inputChanges: {
    projectChanged: boolean;
    scriptChanged: boolean;
    currentProjectVersion: number;
    currentScriptVersion: number;
    sourceRevisionVersion: number;
  };
};
export const stateLabels: Record<string, string> = {
  queued: '排队中',
  preparing: '准备提交',
  submitted: '已提交，等待模型',
  retry_waiting: '限流等待重试',
  needs_reconciliation: '待人工核实',
  failed: '分析失败',
  cancelled: '已停止跟踪',
  completed: '草案已生成',
};
