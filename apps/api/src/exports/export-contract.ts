import { z } from 'zod';
import { readShotCard } from '../production/shot-cards';
export const exportLimits = {
  shots: 200,
  units: 2000,
  snapshotBytes: 4 * 1024 * 1024,
  fileBytes: 8 * 1024 * 1024,
};
export const exportOptions = z
  .object({
    format: z.enum(['json', 'md', 'csv']),
    promptMode: z.enum(['saved', 'neutral']).default('saved'),
    scope: z.discriminatedUnion('type', [
      z.object({ type: z.literal('project') }).strict(),
      z.object({ type: z.literal('root') }).strict(),
      z
        .object({ type: z.literal('unit'), unitId: z.uuid(), includeDescendants: z.boolean().default(false) })
        .strict(),
      z
        .object({
          type: z.literal('shots'),
          shotIds: z
            .array(z.uuid())
            .min(1)
            .max(200)
            .refine((ids) => new Set(ids).size === ids.length, '镜头不能重复'),
        })
        .strict(),
    ]),
  })
  .strict();
export const createExportInput = exportOptions.extend({
  expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExportOptions = z.infer<typeof exportOptions>;
export type ExportUnit = {
  id: string;
  code: string;
  title: string;
  version: number;
  parentId: string | null;
  kind: string;
  orderIndex: number;
  outline: string;
  targetDurationSeconds: number | null;
};
export type ExportPrompt = {
  kind: 'saved' | 'neutral';
  id: string | null;
  snapshot: unknown;
  rendered: { positivePrompt: string; negativePrompt: string; warnings: string[] };
  freshness: { stale: boolean; reasons: string[] };
  checkedProfileRevisionId: string | null;
};
export type ExportShot = {
  id: string;
  code: string;
  version: number;
  sequence: number;
  unitId: string | null;
  unitPath: Pick<ExportUnit, 'id' | 'code' | 'title' | 'version'>[];
  basic: { description: string; camera: string; dialogue: string; durationHint: number; technique: string };
  card: Extract<ReturnType<typeof readShotCard>, { available: true }> | null;
  prompt: ExportPrompt | null;
  warnings: string[];
};
export type ExportSnapshot = {
  schemaVersion: 'studio.storyboard.v1';
  project: {
    id: string;
    code: string;
    title: string;
    version: number;
    aspectRatio: string;
    language: string;
    description: string;
    workFormat: string;
    narrativeMode: string;
    stylePreset: string;
    styleDescription: string;
    directorNotes: string;
    targetDurationSeconds: number | null;
  };
  scope: ExportOptions['scope'];
  promptMode: ExportOptions['promptMode'];
  observed: { scriptVersion: number };
  units: ExportUnit[];
  shots: ExportShot[];
  warnings: string[];
};
export type ExportDocument = ExportSnapshot & { exportId: string; exportedAt: string; snapshotHash: string };
