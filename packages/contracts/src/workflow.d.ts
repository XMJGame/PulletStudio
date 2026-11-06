export type FieldValue = string | number | boolean;
export type FieldValues = Record<string, FieldValue>;
export type FieldSpec =
  | { type: 'text'; maxLength: number }
  | { type: 'number'; min: number; max: number; step: number; integer: boolean }
  | { type: 'boolean' }
  | { type: 'enum'; options: string[] };
export type ExposedField = FieldSpec & { id: string; label: string; node: string; input: string };
export type AvailableField = FieldSpec & { id: string; label: string; defaultValue: FieldValue };
export type WorkflowMediaType = 'image' | 'video' | 'audio';
export type WorkflowMediaInput = {
  id: string;
  label: string;
  mediaType: WorkflowMediaType;
  role: 'reference' | 'last_frame' | 'source' | 'mask';
  node: string;
  input: string;
  required: boolean;
  onMissing: 'error' | 'empty';
};
export type WorkflowMediaOutput = {
  id: string;
  label: string;
  mediaType: WorkflowMediaType;
  role: 'preview' | 'intermediate';
  node: string;
  field: string;
  multiple: boolean;
};
export type WorkflowMediaSchema = {
  version: 'studio.workflow-media.v1';
  inputs: WorkflowMediaInput[];
  outputs: WorkflowMediaOutput[];
};
export type WorkflowMediaSummary = {
  inputs: Omit<WorkflowMediaInput, 'node' | 'input'>[];
  outputs: Omit<WorkflowMediaOutput, 'node' | 'field'>[];
};
