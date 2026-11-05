import { z } from 'zod';
export const entityKinds = ['character', 'environment', 'prop', 'voice'] as const;
export const mediaRoles = [
  'front',
  'side',
  'back',
  'closeup',
  'overview',
  'floorplan',
  'detail',
  'reference',
  'voice_sample',
] as const;
const text = z.string().max(4000).default('');
const continuity = { state: text, continuityNotes: text };
export const attributesByKind = {
  character: z.object({ appearance: text, costume: text, ...continuity }).strict(),
  environment: z.object({ layout: text, lighting: text, ...continuity }).strict(),
  prop: z
    .object({ appearance: text, scale: z.string().max(200).default(''), material: text, ...continuity })
    .strict(),
  voice: z
    .object({
      language: z.string().max(80).default(''),
      timbre: text,
      usageRights: text,
      consentStatus: z.enum(['unknown', 'owned', 'licensed', 'consented']).default('unknown'),
    })
    .strict(),
};
export const entityBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(8000).default(''),
    attributes: z.record(z.string(), z.string()).default({}),
    media: z
      .array(z.object({ role: z.enum(mediaRoles), mediaVersionId: z.uuid() }).strict())
      .max(10)
      .default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.media.map((ref) => ref.role + ':' + ref.mediaVersionId)).size !== value.media.length)
      ctx.addIssue({ code: 'custom', message: '媒体参考不能重复' });
  });
export const createEntity = z.object({ kind: z.enum(entityKinds), body: entityBody }).strict();
export const reviseEntity = z
  .object({ expectedVersion: z.number().int().positive(), body: entityBody })
  .strict();
export const assetReferenceSchema = z
  .object({ revisionId: z.uuid(), purpose: z.string().trim().max(1000).default('') })
  .strict();
export const assetReferencesSchema = z
  .array(assetReferenceSchema)
  .max(20)
  .superRefine((value, ctx) => {
    if (new Set(value.map((ref) => ref.revisionId)).size !== value.length)
      ctx.addIssue({ code: 'custom', message: '实体修订不能重复' });
  });
export type EntityBody = z.infer<typeof entityBody>;
export type AssetReference = z.infer<typeof assetReferenceSchema>;
