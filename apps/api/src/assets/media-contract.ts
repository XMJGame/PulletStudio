import { z } from 'zod';
export const uploadInput = z
  .object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine(
        (value) =>
          !/[\\/<>:"|?*\u0000-\u001f\u007f]/u.test(value) &&
          value !== '.' &&
          value !== '..' &&
          !/[. ]$/.test(value),
        '文件名不能包含路径或控制字符',
      ),
    byteLength: z.number().int().positive().max(2147483648),
    contentType: z.string().trim().toLowerCase().max(100).default(''),
    assetId: z.uuid().nullable().default(null),
    expectedAssetVersion: z.number().int().min(0).default(0),
    addToLibrary: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => (value.assetId ? value.expectedAssetVersion > 0 : value.expectedAssetVersion === 0),
    '已有素材须提供当前版本，新素材期望版本为0',
  );
export type UploadInput = z.infer<typeof uploadInput>;
export const takeInput = z
  .object({ mediaVersionId: z.uuid(), expectedShotVersion: z.number().int().positive() })
  .strict();
