import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  generationWorkflows,
  promptLibraryEntries as entries,
  promptLibraryRevisions as revisions,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { PromptLibraryBody } from './prompt-library.contract';
type Revision = typeof revisions.$inferSelect;
@Injectable()
export class PromptLibraryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
  ) {}
  private entry(user: CurrentUser, id: string, edit = false) {
    const row = this.database.db.select().from(entries).where(eq(entries.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '提示词不存在或无权访问');
    this.authz.project(user, row.projectId, edit ? 'edit' : 'read');
    return row;
  }
  private view(row: Revision) {
    return {
      id: row.id,
      entryId: row.entryId,
      projectId: row.projectId,
      version: row.version,
      title: row.title,
      positivePrompt: row.positivePrompt,
      negativePrompt: row.negativePrompt,
      tags: JSON.parse(row.tagsJson) as string[],
      source: row.source,
      workflowId: row.workflowId,
      createdAt: row.createdAt,
    };
  }
  read(user: CurrentUser, id: string, version?: number) {
    const entry = this.entry(user, id);
    const row = this.database.db
      .select()
      .from(revisions)
      .where(and(eq(revisions.entryId, id), eq(revisions.version, version ?? entry.version)))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '提示词版本不存在');
    return {
      currentVersion: entry.version,
      canEdit: this.production.access(user, entry.projectId).canEdit,
      revision: this.view(row),
    };
  }
  readRevision(user: CurrentUser, id: string) {
    const row = this.database.db.select().from(revisions).where(eq(revisions.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '提示词版本不存在或无权访问');
    return this.read(user, row.entryId, row.version);
  }
  reference(
    user: CurrentUser,
    projectId: string,
    id: string,
    positivePrompt: string,
    negativePrompt: string,
  ) {
    this.authz.project(user, projectId);
    const row = this.database.db
      .select()
      .from(revisions)
      .where(and(eq(revisions.id, id), eq(revisions.projectId, projectId)))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '提示词版本不属于当前项目');
    if (row.positivePrompt !== positivePrompt || row.negativePrompt !== negativePrompt)
      fail(409, 'PROMPT_LIBRARY_CONTENT_CHANGED', '提示词已被修改，请解除库版本引用后再保存或生成');
    return { entryId: row.entryId, revisionId: row.id, version: row.version, title: row.title };
  }
  list(user: CurrentUser, projectId: string, input: { q: string; tag: string; cursor?: string }) {
    const access = this.production.access(user, projectId);
    const scope = and(
      eq(entries.projectId, projectId),
      input.q
        ? sql`instr(lower(${revisions.title} || char(10) || ${revisions.positivePrompt} || char(10) || ${revisions.source}),lower(${input.q}))>0`
        : undefined,
      input.tag
        ? sql`exists(select 1 from json_each(${revisions.tagsJson}) where value=${input.tag})`
        : undefined,
    );
    const query = () =>
      this.database.db
        .select({
          id: entries.id,
          version: entries.version,
          title: revisions.title,
          tagsJson: revisions.tagsJson,
          positivePrompt: revisions.positivePrompt,
          createdAt: entries.createdAt,
        })
        .from(entries)
        .innerJoin(revisions, and(eq(revisions.entryId, entries.id), eq(revisions.version, entries.version)));
    const boundary = input.cursor
      ? query()
          .where(and(scope, eq(entries.id, input.cursor)))
          .get()
      : undefined;
    if (input.cursor && !boundary) fail(400, 'INVALID_CURSOR', '提示词分页位置无效');
    const rows = query()
      .where(
        and(
          scope,
          boundary
            ? or(
                lt(entries.createdAt, boundary.createdAt),
                and(eq(entries.createdAt, boundary.createdAt), lt(entries.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(entries.createdAt), desc(entries.id))
      .limit(21)
      .all();
    return {
      canEdit: access.canEdit,
      items: rows.slice(0, 20).map(({ tagsJson, positivePrompt, ...row }) => ({
        ...row,
        tags: JSON.parse(tagsJson),
        preview: positivePrompt.slice(0, 180),
      })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  history(user: CurrentUser, id: string, before?: number) {
    this.entry(user, id);
    const rows = this.database.db
      .select({ version: revisions.version, title: revisions.title, createdAt: revisions.createdAt })
      .from(revisions)
      .where(and(eq(revisions.entryId, id), before ? lt(revisions.version, before) : undefined))
      .orderBy(desc(revisions.version))
      .limit(21)
      .all();
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].version : null };
  }
  save(
    user: CurrentUser,
    projectId: string | null,
    id: string | null,
    input: PromptLibraryBody,
    key: string,
    expectedVersion?: number,
  ) {
    return this.database.db.transaction(
      () => {
        const entry = id ? this.entry(user, id, true) : null;
        const project = this.authz.project(user, entry?.projectId ?? projectId!, 'edit');
        const hash = createHash('sha256')
          .update(JSON.stringify({ id, input, expectedVersion }))
          .digest('hex');
        const replay = this.database.db
          .select()
          .from(revisions)
          .where(
            and(
              eq(revisions.projectId, project.id),
              eq(revisions.createdBy, user.id),
              eq(revisions.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.requestHash !== hash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他提示词内容');
          return { entryId: replay.entryId, revision: this.view(replay) };
        }
        if (entry && entry.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '提示词已有新版本，本地输入已保留');
        if (
          input.workflowId &&
          !this.database.db
            .select({ id: generationWorkflows.id })
            .from(generationWorkflows)
            .where(
              and(
                eq(generationWorkflows.id, input.workflowId),
                eq(generationWorkflows.projectId, project.id),
              ),
            )
            .get()
        )
          fail(404, 'NOT_FOUND', '推荐工作流不属于当前项目');
        const entryId = entry?.id ?? randomUUID(),
          version = entry ? entry.version + 1 : 1,
          createdAt = new Date().toISOString();
        if (!entry)
          this.database.db
            .insert(entries)
            .values({
              id: entryId,
              projectId: project.id,
              workspaceId: project.workspaceId,
              version: 1,
              createdBy: user.id,
              createdAt,
              updatedAt: createdAt,
            })
            .run();
        const row = this.database.db
          .insert(revisions)
          .values({
            id: randomUUID(),
            entryId,
            projectId: project.id,
            workspaceId: project.workspaceId,
            version,
            title: input.title,
            positivePrompt: input.positivePrompt,
            negativePrompt: input.negativePrompt,
            tagsJson: JSON.stringify(input.tags),
            source: input.source,
            workflowId: input.workflowId,
            createdBy: user.id,
            createdAt,
            requestKey: key,
            requestHash: hash,
          })
          .returning()
          .get()!;
        if (entry)
          this.database.db
            .update(entries)
            .set({ version, updatedAt: createdAt })
            .where(and(eq(entries.id, entryId), eq(entries.version, expectedVersion!)))
            .run();
        this.database.db
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            actorId: user.id,
            action: entry ? 'prompt-library.revise' : 'prompt-library.create',
            targetId: row.id,
            createdAt,
          })
          .run();
        return { entryId, revision: this.view(row) };
      },
      { behavior: 'immediate' },
    );
  }
}
