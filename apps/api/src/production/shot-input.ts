import { z } from 'zod';
import { productionTechniques } from '../db/schema';
export const shotInput = z
  .object({
    sequence: z.number().int().min(0).max(100000).optional(),
    description: z.string().max(20000).optional(),
    camera: z.string().max(2000).optional(),
    dialogue: z.string().max(20000).optional(),
    durationHint: z.number().int().min(1).max(3600).optional(),
    technique: z.enum(productionTechniques).optional(),
  })
  .strict();
