import { z } from 'zod';
import { uploadInput } from './media-contract';
export const workspaceUploadInput = z
  .object({
    fileName: uploadInput.shape.fileName,
    byteLength: uploadInput.shape.byteLength,
    contentType: uploadInput.shape.contentType,
    folderId: z.uuid().nullable().default(null),
  })
  .strict();
export type WorkspaceUploadInput = z.infer<typeof workspaceUploadInput>;
