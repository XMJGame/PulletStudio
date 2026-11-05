import type { AvailableParameter } from '../components/GenerationParameters';
import type { AvailableField, ExposedField } from '../../../../packages/contracts/src/workflow';
import type { WorkflowGraph } from './workflow-graph';
export type Workflow = {
  id: string;
  name: string;
  capability: string;
  enabled: boolean;
  createdAt: string;
  parameters: AvailableParameter[];
  fields?: AvailableField[];
  familyId?: string;
  revision?: number;
  catalogVersion?: number;
  archived?: boolean;
};
export type Connection = { id: string; name: string; version: number; enabled: boolean };
export type GenerationConfig = {
  canConfigure: boolean;
  canEdit: boolean;
  workflows: Workflow[];
  connections: Connection[];
};
export const capabilityLabels: Record<string, string> = {
  'image.text_to_image': '文字生图',
  'video.text_to_video': '文字生视频',
  'video.image_to_video': '图生视频',
};
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
