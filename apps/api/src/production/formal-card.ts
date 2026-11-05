import { z } from 'zod';
import { manualShotSchema } from '../analysis/analysis-contract';

export const formalCardSchema = manualShotSchema.extend({
  durationSeconds: z.number().int().min(1).max(3600),
  sourceSpanIds: z.array(z.string().length(64)).max(20),
  sourceAudioPolicy: z.enum(['keep', 'mute', 'inspect', 'replace']).default('inspect'),
});
export type FormalCard = z.infer<typeof formalCardSchema>;
