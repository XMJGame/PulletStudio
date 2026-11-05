import { z } from 'zod';
export const promptConfigSchema = z
  .object({
    prefix: z.string().max(4000).default(''),
    suffix: z.string().max(4000).default(''),
    positiveRules: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    negativeRules: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
    negativeMode: z.enum(['separate', 'inline']).default('separate'),
  })
  .strict();
export type PromptConfig = z.infer<typeof promptConfigSchema>;
export const profileInput = z
  .object({ name: z.string().trim().min(1).max(100), config: promptConfigSchema })
  .strict();
export const compileInput = z
  .object({
    mode: z.enum(['preview', 'commit']),
    expectedShotVersion: z.number().int().positive(),
    expectedProjectVersion: z.number().int().positive(),
    profileRevisionId: z.uuid().nullable().default(null),
  })
  .strict();
export type CompileInput = z.infer<typeof compileInput>;
