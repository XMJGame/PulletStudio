import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { auditEvents, libraryFolders, libraryPlacements, mediaVersions } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { BoardReferencesService } from './board-references.service';
import type { BoardReference } from '../../../../packages/contracts/src/board';

@Injectable()
export class LibraryFoldersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly references: BoardReferencesService,
  ) {}
  private audit(user: CurrentUser, workspaceId: string, action: string, targetId: string) {
    this.database.db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId,
        actorId: user.id,
        action,
        targetId,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
  private folder(projectId: string, id: string) {
    const row = this.database.db
      .select()
      .from(libraryFolders)
      .where(and(eq(libraryFolders.id, id), eq(libraryFolders.projectId, projectId)))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '文件夹不存在或无权访问');
    return row;
  }
  list(user: CurrentUser, projectId: string) {
    this.authz.project(user, projectId);
    return this.database.db
      .select({ id: libraryFolders.id, name: libraryFolders.name, version: libraryFolders.version })
      .from(libraryFolders)
      .where(eq(libraryFolders.projectId, projectId))
      .orderBy(asc(libraryFolders.nameKey))
      .all();
  }
  create(user: CurrentUser, projectId: string, name: string, key: string) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId, 'edit');
        const replay = this.database.db
          .select()
          .from(libraryFolders)
          .where(
            and(
              eq(libraryFolders.projectId, projectId),
              eq(libraryFolders.createdBy, user.id),
              eq(libraryFolders.creationKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.nameKey !== name.toLowerCase())
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求已用于其他文件夹');
          return { id: replay.id, name: replay.name, version: replay.version };
        }
        if (this.list(user, projectId).length >= 100)
          fail(409, 'FOLDER_LIMIT', '每个项目最多创建 100 个文件夹');
        this.uniqueName(projectId, name);
        const id = randomUUID();
        this.database.db
          .insert(libraryFolders)
          .values({
            id,
            projectId,
            workspaceId: project.workspaceId,
            name,
            nameKey: name.toLowerCase(),
            createdBy: user.id,
            creationKey: key,
            createdAt: new Date().toISOString(),
          })
          .run();
        this.audit(user, project.workspaceId, 'library.folder.create', id);
        return { id, name, version: 1 };
      },
      { behavior: 'immediate' },
    );
  }
  private uniqueName(projectId: string, name: string, except?: string) {
    if (
      this.database.db
        .select({ id: libraryFolders.id })
        .from(libraryFolders)
        .where(
          and(
            eq(libraryFolders.projectId, projectId),
            eq(libraryFolders.nameKey, name.toLowerCase()),
            except ? ne(libraryFolders.id, except) : undefined,
          ),
        )
        .get()
    )
      fail(409, 'FOLDER_NAME_EXISTS', '项目中已有同名文件夹');
  }
  rename(user: CurrentUser, projectId: string, id: string, name: string, version: number) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId, 'edit');
        const row = this.folder(projectId, id);
        if (row.version !== version) fail(409, 'VERSION_CONFLICT', '文件夹已更新，请刷新后重试');
        this.uniqueName(projectId, name, id);
        this.database.db
          .update(libraryFolders)
          .set({ name, nameKey: name.toLowerCase(), version: version + 1 })
          .where(eq(libraryFolders.id, id))
          .run();
        this.audit(user, project.workspaceId, 'library.folder.rename', id);
        return { id, name, version: version + 1 };
      },
      { behavior: 'immediate' },
    );
  }
  remove(user: CurrentUser, projectId: string, id: string, version: number) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId, 'edit');
        const row = this.folder(projectId, id);
        if (row.version !== version) fail(409, 'VERSION_CONFLICT', '文件夹已更新，请刷新后重试');
        this.database.db
          .update(libraryPlacements)
          .set({ folderId: null, version: sql`${libraryPlacements.version}+1` })
          .where(eq(libraryPlacements.folderId, id))
          .run();
        this.database.db.delete(libraryFolders).where(eq(libraryFolders.id, id)).run();
        this.audit(user, project.workspaceId, 'library.folder.delete', id);
        return { removed: true };
      },
      { behavior: 'immediate' },
    );
  }
  move(
    user: CurrentUser,
    projectId: string,
    ref: BoardReference,
    folderId: string | null,
    expectedVersion: number,
  ) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId, 'edit');
        if (ref.kind === 'shot') fail(400, 'LIBRARY_RESOURCE_INVALID', '请选择项目媒体或资产');
        this.references.resolve(user, projectId, ref, true);
        if (folderId) this.folder(projectId, folderId);
        const mediaAssetId =
          ref.kind === 'media'
            ? this.database.db
                .select({ id: mediaVersions.assetId })
                .from(mediaVersions)
                .where(eq(mediaVersions.id, ref.id))
                .get()!.id
            : null;
        const entityId = ref.kind === 'entity' ? ref.id : null;
        const where = mediaAssetId
          ? eq(libraryPlacements.mediaAssetId, mediaAssetId)
          : eq(libraryPlacements.entityId, entityId!);
        const row = this.database.db.select().from(libraryPlacements).where(where).get();
        if ((row?.version ?? 0) !== expectedVersion) {
          if (row?.folderId === folderId) return { folderId, version: row.version };
          fail(409, 'VERSION_CONFLICT', '素材分类已更新，请刷新后再移动');
        }
        const version = expectedVersion + 1;
        if (row) this.database.db.update(libraryPlacements).set({ folderId, version }).where(where).run();
        else
          this.database.db
            .insert(libraryPlacements)
            .values({
              id: randomUUID(),
              projectId,
              workspaceId: project.workspaceId,
              mediaAssetId,
              entityId,
              folderId,
              version,
            })
            .run();
        this.audit(user, project.workspaceId, 'library.resource.move', ref.id);
        return { folderId, version };
      },
      { behavior: 'immediate' },
    );
  }
}
