import { z } from 'zod';

export const outputIds = z
  .array(z.uuid().nullable())
  .min(1)
  .max(40)
  .refine((ids) => new Set(ids).size === ids.length, '产物不能重复选择');
export const saveOutputsInput = z.object({ outputIds }).strict();
export const packageSelection = z
  .string()
  .min(1)
  .max(2000)
  .transform((value) => value.split(',').map((id) => (id === 'main' ? null : id)))
  .pipe(outputIds);
