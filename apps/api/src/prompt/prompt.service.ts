import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, lt, notExists, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { auditEvents, promptArtifacts, promptProfiles, scripts } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { formalCardSchema } from '../production/formal-card';
import { compilePrompt, compilerVersion } from './compiler';
import { CompileInput, PromptConfig, promptConfigSchema } from './prompt-contract';
import { resolveAssetReferences, entityFreshness } from '../assets/entity-references';
import { assetApproval } from '../assets/asset-approval-state';

@Injectable()
export class PromptService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
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
  private profileView(row: typeof promptProfiles.$inferSelect) {
    const { configJson, ...fields } = row;
    return { ...fields, config: JSON.parse(configJson) as PromptConfig };
  }
  private profile(user: CurrentUser, id: string) {
    const row = this.database.db.select().from(promptProfiles).where(eq(promptProfiles.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '提示词 Profile 不存在或无权访问');
    this.authz.project(user, row.projectId);
    return row;
  }
  private head(profileId: string) {
    return this.database.db
      .select()
      .from(promptProfiles)
      .where(eq(promptProfiles.profileId, profileId))
      .orderBy(desc(promptProfiles.version))
      .get()!;
  }
  profiles(user: CurrentUser, projectId: string, cursor?: string) {
    this.authz.project(user, projectId);
    const next = alias(promptProfiles, 'next_profile');
    const rows = this.database.db
      .select()
      .from(promptProfiles)
      .where(
        and(
          eq(promptProfiles.projectId, projectId),
          cursor ? gt(promptProfiles.profileId, cursor) : undefined,
          notExists(
            this.database.db
              .select({ id: next.id })
              .from(next)
              .where(
                and(eq(next.profileId, promptProfiles.profileId), gt(next.version, promptProfiles.version)),
              ),
          ),
        ),
      )
      .orderBy(asc(promptProfiles.profileId))
      .limit(31)
      .all();
    return {
      items: rows.slice(0, 30).map((row) => this.profileView(row)),
      nextCursor: rows.length > 30 ? rows[29].profileId : null,
    };
  }
  saveProfile(
    user: CurrentUser,
    projectId: string | null,
    revisionId: string | null,
    input: { name: string; config: PromptConfig },
    expectedVersion?: number,
  ) {
    return this.database.db.transaction(
      () => {
        const old = revisionId ? this.profile(user, revisionId) : null;
        const project = this.authz.project(user, old?.projectId ?? projectId!, 'manage');
        const head = old ? this.head(old.profileId) : null;
        if (head && head.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', 'Profile 已有新修订，请刷新后重试');
        const row = this.database.db
          .insert(promptProfiles)
          .values({
            id: randomUUID(),
            profileId: head?.profileId ?? randomUUID(),
            projectId: project.id,
            workspaceId: project.workspaceId,
            version: (head?.version ?? 0) + 1,
            name: input.name,
            configJson: JSON.stringify(input.config),
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          })
          .returning()
          .get()!;
        this.audit(user, project.workspaceId, 'prompt.profile.revise', row.id);
        return this.profileView(row);
      },
      { behavior: 'immediate' },
    );
  }
  compile(user: CurrentUser, shotId: string, input: CompileInput) {
    return this.database.db.transaction(
      () => {
        const shot = this.production.shot(user, shotId, input.mode === 'commit' ? 'edit' : 'read');
        const project = this.authz.project(user, shot.projectId);
        if (shot.version !== input.expectedShotVersion || project.version !== input.expectedProjectVersion)
          fail(409, 'VERSION_CONFLICT', '镜头或项目设定已修改，请刷新制作卡后重新预览');
        const card = this.production.card(user, shotId);
        if (!card.available || !('body' in card)) fail(409, 'CARD_REQUIRED', '请先保存完整制作卡');
        const profile = input.profileRevisionId ? this.profile(user, input.profileRevisionId) : null;
        if (profile && profile.projectId !== project.id) fail(404, 'NOT_FOUND', 'Profile 不属于当前项目');
        const config = profile
          ? promptConfigSchema.parse(JSON.parse(profile.configJson))
          : promptConfigSchema.parse({});
        const body = formalCardSchema.parse(card.body);
        const references = resolveAssetReferences(this.database, project.id, body.assetBindings);
        const referenceWarnings = entityFreshness(this.database, references);
        const rendered = compilePrompt(body, project, config, references);
        rendered.warnings.push(...referenceWarnings);
        const script = this.database.db.select().from(scripts).where(eq(scripts.projectId, project.id)).get();
        if (card.sources.some((source) => source.revisionVersion !== script?.version))
          rendered.warnings.push('引用原文已有新版本；本次仍使用卡中固定的旧来源。');
        if (profile && this.head(profile.profileId).id !== profile.id)
          rendered.warnings.push('使用的是历史 Profile 修订，非当前最新版本。');
        const snapshot = {
          card: { id: card.id, version: card.version, body, sources: card.sources, origin: card.origin },
          project: {
            id: project.id,
            version: project.version,
            title: project.title,
            aspectRatio: project.aspectRatio,
            language: project.language,
            stylePreset: project.stylePreset,
            styleDescription: project.styleDescription,
            directorNotes: project.directorNotes,
            workFormat: project.workFormat,
            narrativeMode: project.narrativeMode,
          },
          profile: profile
            ? this.profileView(profile)
            : { id: null, version: 'builtin-neutral-1', name: '中立手工交付', config },
          compilerVersion,
          entityRevisions: references,
          modelProfile: null,
        };
        if (input.mode === 'preview') {
          const reasons: string[] = [...referenceWarnings];
          if (card.sources.some((source) => source.revisionVersion !== script?.version))
            reasons.push('引用原文已有新版本');
          if (profile && this.head(profile.profileId).id !== profile.id) reasons.push('Profile 已有新修订');
          return { id: null, rendered, snapshot, freshness: { stale: reasons.length > 0, reasons } };
        }
        const row = this.database.db
          .insert(promptArtifacts)
          .values({
            id: randomUUID(),
            shotId,
            projectId: project.id,
            workspaceId: project.workspaceId,
            cardId: card.id,
            cardVersion: card.version,
            projectVersion: project.version,
            profileRevisionId: profile?.id ?? null,
            compilerVersion,
            snapshotJson: JSON.stringify(snapshot),
            renderedJson: JSON.stringify(rendered),
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          })
          .returning()
          .get()!;
        this.audit(user, project.workspaceId, 'prompt.compile', row.id);
        return this.artifactView(user, row);
      },
      { behavior: 'immediate' },
    );
  }
  private artifactView(user: CurrentUser, row: typeof promptArtifacts.$inferSelect) {
    const shot = this.production.shot(user, row.shotId);
    const project = this.authz.project(user, row.projectId);
    const reasons: string[] = [];
    if (shot.version !== row.cardVersion) reasons.push('镜头已有新版本');
    if (project.version !== row.projectVersion) reasons.push('项目设定已有新版本');
    if (row.profileRevisionId) {
      const profile = this.profile(user, row.profileRevisionId);
      if (this.head(profile.profileId).id !== profile.id) reasons.push('Profile 已有新修订');
    }
    const snapshot = JSON.parse(row.snapshotJson);
    reasons.push(...entityFreshness(this.database, snapshot.entityRevisions ?? []));
    for (const ref of snapshot.entityRevisions ?? []) {
      if ((ref.decisionVersion ?? 0) !== assetApproval(this.database, ref.id).decisionVersion)
        reasons.push(`资产「${ref.name}」v${ref.version}的审批已变化`);
    }
    const script = this.database.db.select().from(scripts).where(eq(scripts.projectId, project.id)).get();
    if (
      snapshot.card.sources.some(
        (source: { revisionVersion: number }) => source.revisionVersion !== script?.version,
      )
    )
      reasons.push('引用原文已有新版本');
    return {
      id: row.id,
      shotId: row.shotId,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      snapshot,
      rendered: JSON.parse(row.renderedJson),
      freshness: { stale: reasons.length > 0, reasons },
    };
  }
  artifacts(user: CurrentUser, shotId: string, cursor?: string) {
    this.production.shot(user, shotId);
    const boundary = cursor
      ? this.database.db
          .select()
          .from(promptArtifacts)
          .where(and(eq(promptArtifacts.id, cursor), eq(promptArtifacts.shotId, shotId)))
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'INVALID_CURSOR', '提示词历史分页位置无效');
    const rows = this.database.db
      .select()
      .from(promptArtifacts)
      .where(
        and(
          eq(promptArtifacts.shotId, shotId),
          boundary
            ? or(
                lt(promptArtifacts.createdAt, boundary.createdAt),
                and(eq(promptArtifacts.createdAt, boundary.createdAt), lt(promptArtifacts.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(promptArtifacts.createdAt), desc(promptArtifacts.id))
      .limit(31)
      .all();
    return {
      items: rows
        .slice(0, 30)
        .map((row) => ({ id: row.id, createdAt: row.createdAt, cardVersion: row.cardVersion })),
      nextCursor: rows.length > 30 ? rows[29].id : null,
    };
  }
  artifact(user: CurrentUser, shotId: string, id: string) {
    this.production.shot(user, shotId);
    const row = this.database.db
      .select()
      .from(promptArtifacts)
      .where(and(eq(promptArtifacts.id, id), eq(promptArtifacts.shotId, shotId)))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '提示词记录不存在或无权访问');
    return this.artifactView(user, row);
  }
}
