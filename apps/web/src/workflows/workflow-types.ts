import type { AvailableParameter } from '../components/GenerationParameters';
import type { AvailableField, ExposedField } from '../../../../packages/contracts/src/workflow';
import type { WorkflowGraph } from './workflow-graph';
import type { WorkflowMediaSchema, WorkflowMediaSummary } from '../../../../packages/contracts/src/workflow';
export type Workflow = {
  id: string;
  name: string;
  capability: string;
  enabled: boolean;
  provider?: 'comfyui' | 'modelscope';
  createdAt: string;
  parameters: AvailableParameter[];
  fields?: AvailableField[];
  familyId?: string;
  revision?: number;
  catalogVersion?: number;
  archived?: boolean;
  reviewRequired?: boolean;
  releaseState?: 'compatible' | 'published' | 'draft';
  publishedWorkflowId?: string | null;
  mediaSchema?: WorkflowMediaSummary;
  executable?: boolean;
  executionBlocker?: string | null;
};
export type Connection = {
  id: string;
  name: string;
  version: number;
  enabled: boolean;
  poolEnabled: boolean;
  poolVersion: number;
  maxRunning: number;
  maxPending: number;
};
export type GenerationConfig = {
  canConfigure: boolean;
  canEdit: boolean;
  canReview: boolean;
  poolConfigured: boolean;
  workflows: Workflow[];
  pinnedWorkflow?: Workflow;
  productionWorkflows: Workflow[];
  connections: Connection[];
};
export const capabilityLabels: Record<string, string> = {
  'image.text_to_image': '文字生图',
  'video.text_to_video': '文字生视频',
  'video.image_to_video': '图生视频',
};
export const referenceMediaLabels = { image: '图片', video: '视频', audio: '音频' };
export type WorkflowDefinition = {
  name: string;
  connectionId: string;
  capability: string;
  graph: WorkflowGraph;
  positive: { node: string; input: string };
  negative?: { node: string; input: string };
  image?: { node: string; input: string };
  output: { node: string; field: string };
  parameters?: import('../components/GenerationParameters').WorkflowParameter[];
  fields?: ExposedField[];
  mediaSchema?: WorkflowMediaSchema;
};
export type WorkflowEditing = {
  id: string;
  definition: WorkflowDefinition;
  catalog: {
    familyId: string;
    version: number;
    revision: number;
    headRevision: number;
    headWorkflowId: string;
    archived: boolean;
  };
};
