import { and, eq } from 'drizzle-orm';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { mediaFrameExtractions, mediaVersions } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { assertSampleAccess } from './entity-references';

export function frameSource(
  database: DatabaseService,
  authz: AuthorizationService,
  user: CurrentUser,
  id: string,
  atMs: number,
) {
  const source = database.db.select().from(mediaVersions).where(eq(mediaVersions.id, id)).get();
  if (!source) fail(404, 'NOT_FOUND', '视频不存在或无权访问');
  authz.project(user, source.projectId, 'edit');
  assertSampleAccess(database, user, source);
  if (source.origin === 'workflow_test') fail(409, 'FRAME_TEST_EVIDENCE', '试跑证据不能提帧为生产素材');
  const details = JSON.parse(source.metadataJson) as { durationMs?: number };
  if (source.mediaType !== 'video') fail(400, 'FRAME_VIDEO_REQUIRED', '请选择视频原件');
  if (!Number.isSafeInteger(atMs) || atMs < 0 || !details.durationMs || atMs >= details.durationMs)
    fail(400, 'FRAME_TIME_INVALID', '提帧位置不在视频范围内');
  return source;
}
export function frameUpload(database: DatabaseService, uploadId: string) {
  return database.db
    .select()
    .from(mediaFrameExtractions)
    .where(eq(mediaFrameExtractions.uploadId, uploadId))
    .get();
}
export function frameIntent(
  database: DatabaseService,
  authz: AuthorizationService,
  user: CurrentUser,
  id: string,
  projectId: string,
) {
  const row = database.db
    .select()
    .from(mediaFrameExtractions)
    .where(
      and(
        eq(mediaFrameExtractions.id, id),
        eq(mediaFrameExtractions.projectId, projectId),
        eq(mediaFrameExtractions.createdBy, user.id),
      ),
    )
    .get();
  if (!row) fail(403, 'FRAME_UPLOAD_RESERVED', '提帧上传由原操作管理');
  frameSource(database, authz, user, row.sourceVersionId, row.atMs);
  return row;
}
