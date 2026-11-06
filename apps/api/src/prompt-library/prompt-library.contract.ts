import { z } from 'zod';
export const promptLibraryBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    positivePrompt: z.string().trim().min(1).max(16000),
    negativePrompt: z.string().max(16000).default(''),
    tags: z
      .array(z.string().trim().min(1).max(40))
      .max(12)
      .default([])
      .transform((values) => [...new Set(values)].sort()),
    source: z.string().trim().max(300).default(''),
    workflowId: z.uuid().nullable().default(null),
  })
  .strict();
export const revisePromptLibrary = promptLibraryBody.extend({ expectedVersion: z.number().int().positive() });
export const promptLibraryQuery = z
  .object({
    q: z.string().trim().max(80).default(''),
    tag: z.string().trim().max(40).default(''),
    cursor: z.uuid().optional(),
  })
  .strict();
export type PromptLibraryBody = z.infer<typeof promptLibraryBody>;
