import { HttpException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, like, or } from 'drizzle-orm';
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
    if (!row) fail(404, 'BOARD_REFERENCE_UNAVAILABLE', '引用不存在或无权访问');
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
        title: row.fileName,
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
  ) {
    this.authz.project(user, projectId);
    const q = query?.trim();
    const items: BoardSource[] = [];
    let refs: { id: string; ref: BoardReference; fallback?: string }[];
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
        .select()
        .from(assetEntities)
        .where(and(eq(assetEntities.projectId, projectId), cursor ? gt(assetEntities.id, cursor) : undefined))
        .orderBy(asc(assetEntities.id))
        .limit(21)
        .all()
        .map((row) => {
          const revision = this.database.db
            .select()
            .from(assetEntityRevisions)
            .where(
              and(eq(assetEntityRevisions.entityId, row.id), eq(assetEntityRevisions.version, row.version)),
            )
            .get()!;
          return { id: row.id, ref: { kind: 'entity', id: row.id, revisionId: revision.id } };
        });
    else
      refs = this.database.db
        .select()
        .from(mediaVersions)
        .where(
          and(
            eq(mediaVersions.projectId, projectId),
            cursor ? gt(mediaVersions.id, cursor) : undefined,
            q ? like(mediaVersions.fileName, `%${q}%`) : undefined,
          ),
        )
        .orderBy(asc(mediaVersions.id))
        .limit(21)
        .all()
        .map((row) => ({ id: row.id, ref: { kind: 'media', id: row.id } }));
    for (const item of refs.slice(0, 20)) {
      const value = this.resolve(user, projectId, item.ref);
      if (value.status !== 'unavailable' && (!q || kind !== 'entities' || value.title.includes(q)))
        items.push({ ref: item.ref, value, ready: true });
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
