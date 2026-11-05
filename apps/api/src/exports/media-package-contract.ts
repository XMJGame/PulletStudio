import { z } from 'zod';
import { exportOptions, ExportSnapshot, ExportShot } from './export-contract';
import type { MediaDetails } from '../assets/media-probe';

export const packageLimits = {
  shots: 100,
  mediaBytes: 2 * 1024 * 1024 * 1024,
  manifestBytes: 4 * 1024 * 1024,
};
export const packageOptions = z.object({ scope: exportOptions.shape.scope }).strict();
export const createPackageInput = packageOptions.extend({
  expectedSnapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PackageOptions = z.infer<typeof packageOptions>;
export type PackageFile = {
  mediaVersionId: string;
  path: string;
  fileName: string;
  mime: string;
  byteLength: number;
  sha256: string;
  metadata: MediaDetails['metadata'];
};
export type PackageSnapshot = {
  schemaVersion: 'studio.media-package.v1';
  project: ExportSnapshot['project'];
  scope: PackageOptions['scope'];
  units: ExportSnapshot['units'];
  shots: {
    id: string;
    code: string;
    version: number;
    sequence: number;
    unitPath: ExportShot['unitPath'];
    card: ExportShot['card'];
    selection: { id: string; version: number; approvalId: string };
    take: { id: string; takeNo: number; mediaVersionId: string };
    approval: {
      id: string;
      version: number;
      actorName: string;
      reason: string;
      createdAt: string;
      shotVersion: number;
      projectVersion: number;
    };
    source: {
      jobId: string;
      workflow: { id: string; name: string; capability: string; definitionHash: string };
      parameterValues: Record<string, string | number>;
      prompt: unknown;
    } | null;
  }[];
  files: PackageFile[];
};
export type PackageManifest = PackageSnapshot & {
  packageId: string;
  exportedAt: string;
  snapshotHash: string;
};
