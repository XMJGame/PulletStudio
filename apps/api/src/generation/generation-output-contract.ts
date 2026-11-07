import { z } from 'zod';
import { resultDescriptor } from './generation-contract';

export const outputDescriptor = z
  .object({
    slotId: z.uuid(),
    index: z.number().int().min(0).max(7),
    label: z.string().min(1).max(120),
    role: z.enum(['preview', 'intermediate']),
    mediaType: z.enum(['image', 'video', 'audio']),
    result: resultDescriptor,
  })
  .strict();
export const outputManifest = z
  .object({
    version: z.literal('studio.generation-outputs.v1'),
    primary: resultDescriptor,
    outputs: z.array(outputDescriptor).min(1).max(32),
  })
  .strict();
export type OutputDescriptor = z.infer<typeof outputDescriptor>;
