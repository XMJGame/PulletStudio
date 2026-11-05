export type FieldValue = string | number | boolean;
export type FieldValues = Record<string, FieldValue>;
export type FieldSpec =
  | { type: 'text'; maxLength: number }
  | { type: 'number'; min: number; max: number; step: number; integer: boolean }
  | { type: 'boolean' }
  | { type: 'enum'; options: string[] };
export type ExposedField = FieldSpec & { id: string; label: string; node: string; input: string };
export type AvailableField = FieldSpec & { id: string; label: string; defaultValue: FieldValue };
