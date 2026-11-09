import { HttpException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, like, ne, or, sql } from 'drizzle-orm';
import type { BoardReference, BoardResolved, BoardSource } from '../../../../packages/contracts/src/board';
import { DatabaseService } from '../db/database.service';
import { CurrentUser, fail } from '../common/http';
import {
  assetEntities,
  assetEntityRevisions,
  entityMediaBindings,
  mediaVersions,
  mediaAssets,
  shots,
  generationJobs,
  generationOutputs,
  libraryFolders,
  libraryPlacements,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { cardRecord } from '../production/shot-cards';
import { EntitiesService } from '../assets/entities.service';
import { MediaService } from '../assets/media.service';
import { assertSampleAccess } from '../assets/entity-references';

@Injectable()
export class BoardReferencesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly entities: EntitiesService,
    private readonly media: MediaService,
  ) {}
  private mediaValue(user: CurrentUser, projectId: string, id: string) {
    const row = this.database.db
      .select()
      .from(mediaVersions)
      .where(and(eq(mediaVersions.id, id), eq(mediaVersions.projectId, projectId)))
      .get();
    if (!row || row.origin === 'workflow_test')
      fail(404, 'BOARD_REFERENCE_UNAVAILABLE', '引用不存在或无权访问');
    assertSampleAccess(this.database, user, row);
    const value = this.media.version(user, id);
    return { row, value };
  }
  resolveMany(user: CurrentUser, projectId: string, references: { nodeId: string; ref: BoardReference }[]) {
    this.authz.project(user, projectId);
    return Object.fromEntries(
      references.map((item) => [item.nodeId, this.resolve(user, projectId, item.ref)]),
    );
  }
  result(user: CurrentUser, projectId: string, id: string, strict = false, outputId?: string): BoardResolved {
    this.authz.project(user, projectId);
    const row = this.database.db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.id, id), eq(generationJobs.projectId, projectId)))
      .get();
    if (!row || row.purpose !== 'production' || row.shotId) {
      if (strict) fail(404, 'BOARD_REFERENCE_UNAVAILABLE', '生成结果不存在或无权访问');
      return { status: 'unavailable', title: '结果不可用' };
    }
    const output = outputId
      ? this.database.db
          .select()
          .from(generationOutputs)
          .where(
            and(
              eq(generationOutputs.id, outputId),
              eq(generationOutputs.jobId, row.id),
              eq(generationOutputs.projectId, projectId),
            ),
          )
          .get()
      : undefined;
    if (outputId && !output) {
      if (strict) fail(404, 'BOARD_REFERENCE_UNAVAILABLE', '生成产物不存在或无权访问');
      return { status: 'unavailable', title: '产物不可用' };
    }
    if (row.state !== 'completed' || !row.mediaVersionId) {
      const states: Record<string, string> = {
        queued: '排队中',
        preparing: '准备生成',
        submitting: '正在提交',
        submitted: '正在生成',
        fetching: '正在保存结果',
        failed: '任务失败，请查看任务记录',
        canceled: '已取消',
        needs_reconciliation: '需要核对远端任务',
      };
      return { status: 'draft', title: '生成结果', summary: states[row.state] ?? '请查看生成任务记录' };
    }
    const value = this.resolve(
      user,
      projectId,
      { kind: 'media', id: output?.mediaVersionId ?? row.mediaVersionId },
      strict,
    );
    return { ...value, title: value.status === 'unavailable' ? value.title : `生成结果 · ${value.title}` };
  }
  resolve(user: CurrentUser, projectId: string, ref: BoardReference, strict = false): BoardResolved {
    this.authz.project(user, projectId);
    try {
      if (ref.kind === 'shot') {
        const shot = this.database.db
          .select()
          .from(shots)
          .where(and(eq(shots.id, ref.id), eq(shots.projectId, projectId)))
          .get();
        const card = shot && cardRecord(this.database, shot.id, ref.version);
        if (!shot || !card) fail(404, 'BOARD_REFERENCE_UNAVAILABLE', '完整制作卡版本不存在或无权访问');
        const body = JSON.parse(card.bodyJson) as Record<string, unknown>;
        return {
          status: shot.version === ref.version ? 'current' : 'stale',
          title: `${shot.code} · ${body.title || '镜头'}`,
          kind: 'shot',
          version: ref.version,
          currentVersion: shot.version,
          summary: String(body.description ?? ''),
          detail: { code: shot.code, version: ref.version, body, summary: card.summary },
        };
      }
      if (ref.kind === 'entity') {
        const revision = this.database.db
          .select()
          .from(assetEntityRevisions)
          .where(
            and(
              eq(assetEntityRevisions.id, ref.revisionId),
              eq(assetEntityRevisions.entityId, ref.id),
              eq(assetEntityRevisions.projectId, projectId),
            ),
          )
          .get();
        if (!revision) fail(404, 'BOARD_REFERENCE_UNAVAILABLE', '引用不存在或无权访问');
        const bindings = this.database.db
          .select()
          .from(entityMediaBindings)
          .where(eq(entityMediaBindings.revisionId, ref.revisionId))
          .all();
        for (const binding of bindings) this.mediaValue(user, projectId, binding.mediaVersionId);
        const entity = this.entities.read(user, ref.id, revision.version),
          data = entity.revision;
        const preview = data.media.find((item) => item.mediaType === 'image') ?? data.media[0];
        return {
          status:
            data.status === 'revoked'
              ? 'revoked'
              : entity.currentVersion !== data.version
                ? 'stale'
                : data.status === 'draft'
                  ? 'draft'
                  : 'current',
          title: data.name,
          kind: entity.kind,
          version: data.version,
          currentVersion: entity.currentVersion,
          approval: data.status,
          summary: data.description,
          detail: { kind: entity.kind, revision: data },
          ...(preview ? { media: this.mediaValue(user, projectId, preview.mediaVersionId).value } : {}),
        };
      }
      const { row, value } = this.mediaValue(user, projectId, ref.id);
      const head = this.database.db.select().from(mediaAssets).where(eq(mediaAssets.id, row.assetId)).get();
      return {
        status: head?.version === row.version ? 'current' : 'stale',
        title: head?.inLibrary ? value.libraryName : row.fileName,
        kind: row.mediaType,
        version: row.version,
        currentVersion: head?.version,
        summary: `${row.mime}`,
        media: value,
        detail: {
          fileName: row.fileName,
          version: row.version,
          metadata: value.metadata,
          origin: row.origin,
        },
      };
    } catch (error) {
      if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error;
      if (strict) fail(404, 'BOARD_REFERENCE_UNAVAILABLE', '引用不存在、跨项目或无权访问');
      return { status: 'unavailable', title: '引用不可用' };
    }
  }
  sources(
    user: CurrentUser,
    projectId: string,
    kind: 'shots' | 'entities' | 'media',
    cursor?: string,
    query?: string,
    mediaType?: 'image' | 'video' | 'audio',
    folderId?: string,
  ) {
    this.authz.project(user, projectId);
    if (
      folderId &&
      folderId !== 'root' &&
      !this.database.db
        .select({ id: libraryFolders.id })
        .from(libraryFolders)
        .where(and(eq(libraryFolders.id, folderId), eq(libraryFolders.projectId, projectId)))
        .get()
    )
      fail(400, 'LIBRARY_FOLDER_UNAVAILABLE', '文件夹已移除或不可用，请切换到全部资源');
    const folderFilter =
      folderId === 'root'
        ? isNull(libraryPlacements.folderId)
        : folderId
          ? eq(libraryPlacements.folderId, folderId)
          : undefined;
    const q = query?.trim();
    const items: BoardSource[] = [];
    let refs: { id: string; ref: BoardReference; fallback?: string; placement?: BoardSource['placement'] }[];
    if (kind === 'shots')
      refs = this.database.db
        .select()
        .from(shots)
        .where(
          and(
            eq(shots.projectId, projectId),
            cursor ? gt(shots.id, cursor) : undefined,
            q ? or(like(shots.code, `%${q}%`), like(shots.description, `%${q}%`)) : undefined,
          ),
        )
        .orderBy(asc(shots.id))
        .limit(21)
        .all()
        .map((row) => ({
          id: row.id,
          ref: { kind: 'shot', id: row.id, version: row.version },
          fallback: row.code,
        }));
    else if (kind === 'entities')
      refs = this.database.db
        .select({
          id: assetEntities.id,
          revisionId: assetEntityRevisions.id,
          folderId: libraryPlacements.folderId,
          placementVersion: libraryPlacements.version,
        })
        .from(assetEntities)
        .innerJoin(
          assetEntityRevisions,
          and(
            eq(assetEntityRevisions.entityId, assetEntities.id),
            eq(assetEntityRevisions.version, assetEntities.version),
          ),
        )
        .leftJoin(libraryPlacements, eq(libraryPlacements.entityId, assetEntities.id))
        .where(
          and(
            eq(assetEntities.projectId, projectId),
            folderFilter,
            cursor ? gt(assetEntities.id, cursor) : undefined,
            q ? sql`instr(lower(${assetEntityRevisions.name}), lower(${q}))>0` : undefined,
          ),
        )
        .orderBy(asc(assetEntities.id))
        .limit(21)
        .all()
        .map((row) => ({
          id: row.id,
          ref: { kind: 'entity', id: row.id, revisionId: row.revisionId },
          placement: { folderId: row.folderId, version: row.placementVersion ?? 0 },
        }));
    else
      refs = this.database.db
        .select({
          id: mediaVersions.id,
          folderId: libraryPlacements.folderId,
          placementVersion: libraryPlacements.version,
        })
        .from(mediaVersions)
        .innerJoin(mediaAssets, eq(mediaAssets.id, mediaVersions.assetId))
        .leftJoin(libraryPlacements, eq(libraryPlacements.mediaAssetId, mediaAssets.id))
        .where(
          and(
            eq(mediaVersions.projectId, projectId),
            folderFilter,
            ne(mediaVersions.origin, 'workflow_test'),
            eq(mediaAssets.inLibrary, true),
            mediaType ? eq(mediaVersions.mediaType, mediaType) : undefined,
            cursor ? gt(mediaVersions.id, cursor) : undefined,
            q
              ? or(
                  like(mediaVersions.fileName, `%${q}%`),
                  like(mediaAssets.name, `%${q}%`),
                  like(libraryPlacements.displayName, `%${q}%`),
                )
              : undefined,
          ),
        )
        .orderBy(asc(mediaVersions.id))
        .limit(21)
        .all()
        .map((row) => ({
          id: row.id,
          ref: { kind: 'media', id: row.id },
          placement: { folderId: row.folderId, version: row.placementVersion ?? 0 },
        }));
    for (const item of refs.slice(0, 20)) {
      const value = this.resolve(user, projectId, item.ref);
      if (value.status !== 'unavailable')
        items.push({ ref: item.ref, value, ready: true, placement: item.placement });
      else if (kind === 'shots' && item.fallback)
        items.push({
          ref: item.ref,
          value: { status: 'unavailable', title: item.fallback, summary: '请先保存完整制作卡，再固定引用' },
          ready: false,
        });
    }
    return { items, nextCursor: refs.length > 20 ? refs[19].id : null };
  }
}
