import { z } from 'zod';
import { packageOptions, PackageSnapshot } from '../exports/media-package-contract';
export const profiles = {
  landscape: { width: 640, height: 360 },
  portrait: { width: 360, height: 640 },
  square: { width: 480, height: 480 },
  classic: { width: 640, height: 480 },
  cinema: { width: 640, height: 272 },
} as const;
export const timelineInput = z
  .object({
    scope: packageOptions.shape.scope,
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    profile: z.enum(['landscape', 'portrait', 'square', 'classic', 'cinema']),
    clips: z
      .array(
        z
          .object({
            shotId: z.uuid(),
            inMs: z.number().int().nonnegative().max(86400000),
            durationMs: z.number().int().min(40).max(300000),
            audioPolicy: z.enum(['keep', 'mute']),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict();
export const saveTimelineInput = timelineInput.extend({
  expectedVersion: z.number().int().nonnegative(),
  expectedPreviewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type TimelineInput = z.infer<typeof timelineInput>;
export type TimelineSnapshot = {
  schemaVersion: 'studio.timeline.v1';
  sourceHash: string;
  sources: PackageSnapshot;
  profile: keyof typeof profiles;
  width: number;
  height: number;
  fps: 25;
  durationMs: number;
  clips: {
    shotId: string;
    code: string;
    takeId: string;
    mediaVersionId: string;
    mediaType: 'image' | 'video';
    inMs: number;
    requestedDurationMs: number;
    durationMs: number;
    positionMs: number;
    frames: number;
    audioPolicy: 'keep' | 'mute';
    hasAudio: boolean;
  }[];
};
