import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { scripts, scriptRevisions, scriptSources, users, auditEvents } from '../db/schema';
import { CurrentUser, fail } from '../common/http';
import { AuthorizationService } from '../production/authorization.service';
import { ParsedSource, parseScriptSource, SourceInput, sourceSpans, textChecksum } from './script-evidence';

type ScriptInput = { expectedVersion: number; title: string; content: string; summary: string };
@Injectable()
export class ScriptsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}
  private document(projectId: string, workspaceId: string) {
    return this.database.db
      .select()
      .from(scripts)
      .where(and(eq(scripts.projectId, projectId), eq(scripts.workspaceId, workspaceId)))
      .get();
  }
  private revision(projectId: string, workspaceId: string, version: number) {
    const result = this.database.db
      .select({ revision: scriptRevisions, authorName: users.name })
      .from(scriptRevisions)
      .innerJoin(users, eq(users.id, scriptRevisions.createdBy))
      .where(
        and(
          eq(scriptRevisions.projectId, projectId),
          eq(scriptRevisions.workspaceId, workspaceId),
          eq(scriptRevisions.version, version),
        ),
      )
      .get();
    return result && { ...result.revision, authorName: result.authorName };
  }
  private source(revisionId: string) {
    return this.database.db
      .select()
      .from(scriptSources)
      .where(eq(scriptSources.revisionId, revisionId))
      .get();
  }
  private decorate(
    revision: NonNullable<ReturnType<ScriptsService['revision']>>,
    document: NonNullable<ReturnType<ScriptsService['document']>>,
  ) {
    const source = this.source(revision.id);
    return {
      ...revision,
      checksum: textChecksum(revision.content),
      locked: !!document.lockedAt,
      lockVersion: document.lockVersion,
      lockedAt: document.lockedAt,
      lockedBy: document.lockedBy,
      source: source
        ? {
            id: source.id,
            fileName: source.fileName,
            kind: source.kind,
            origin: source.origin,
            encoding: source.encoding,
            sha256: source.sha256,
            byteLength: source.byteLength,
          }
        : null,
    };
  }
  current(user: CurrentUser, projectId: string) {
    const project = this.authz.project(user, projectId);
    const document = this.document(projectId, project.workspaceId);
    if (!document)
      return {
        id: null,
        projectId,
        version: 0,
        title: '项目剧本',
        content: '',
        summary: '',
        createdAt: null,
        authorName: null,
        restoredFromVersion: null,
        locked: false,
        lockVersion: 0,
        lockedAt: null,
        lockedBy: null,
        source: null,
        checksum: textChecksum(''),
      };
    return this.decorate(this.revision(projectId, project.workspaceId, document.version)!, document);
  }
  history(user: CurrentUser, projectId: string, before?: number) {
    const project = this.authz.project(user, projectId);
    const rows = this.database.db
      .select({
        id: scriptRevisions.id,
        version: scriptRevisions.version,
        title: scriptRevisions.title,
        summary: scriptRevisions.summary,
        createdAt: scriptRevisions.createdAt,
        createdBy: scriptRevisions.createdBy,
        authorName: users.name,
        restoredFromVersion: scriptRevisions.restoredFromVersion,
      })
      .from(scriptRevisions)
      .innerJoin(users, eq(users.id, scriptRevisions.createdBy))
      .where(
        and(
          eq(scriptRevisions.projectId, projectId),
          eq(scriptRevisions.workspaceId, project.workspaceId),
          before ? lt(scriptRevisions.version, before) : undefined,
        ),
      )
      .orderBy(desc(scriptRevisions.version))
      .limit(31)
      .all();
    const items = rows.slice(0, 30);
    return { items, nextCursor: rows.length > 30 ? items.at(-1)!.version : null };
  }
  readVersion(user: CurrentUser, projectId: string, version: number) {
    const project = this.authz.project(user, projectId);
    const revision = this.revision(projectId, project.workspaceId, version);
    if (!revision) fail(404, 'NOT_FOUND', '剧本版本不存在');
    return this.decorate(revision, this.document(projectId, project.workspaceId)!);
  }
  importSource(
    user: CurrentUser,
    projectId: string,
    input: { expectedVersion: number; title: string; kind: ParsedSource['kind']; source: SourceInput },
  ) {
    this.authz.project(user, projectId, 'edit');
    const source = parseScriptSource(input.source, input.kind);
    return this.append(
      user,
      projectId,
      input.expectedVersion,
      {
        expectedVersion: input.expectedVersion,
        title: input.title,
        content: source.content,
        summary: `导入${source.origin === 'file' ? '文件' : '文本'}：${source.fileName}`,
      },
      undefined,
      source,
    );
  }
  original(user: CurrentUser, projectId: string, version: number) {
    const revision = this.readVersion(user, projectId, version);
    const source = this.source(revision.id);
    if (!source) fail(404, 'SOURCE_NOT_FOUND', '此版本没有导入原文件；正文仍可在历史版本查看');
    return source;
  }
  spans(user: CurrentUser, projectId: string, version: number, after: number, limit: number) {
    const revision = this.readVersion(user, projectId, version);
    return sourceSpans(revision.id, revision.content, after, limit);
  }
  setLock(
    user: CurrentUser,
    projectId: string,
    expectedVersion: number,
    expectedLockVersion: number,
    locked: boolean,
  ) {
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, 'manage');
        const document = this.document(projectId, project.workspaceId);
        if (!document) fail(400, 'SCRIPT_NOT_SAVED', '请先保存或导入剧本');
        if (document.version !== expectedVersion || document.lockVersion !== expectedLockVersion)
          fail(409, 'VERSION_CONFLICT', '剧本或锁定状态已变化，请载入最新剧本', {
            latestVersion: document.version,
          });
        if (!!document.lockedAt === locked)
          fail(409, 'LOCK_STATE_CONFLICT', locked ? '剧本已锁定' : '剧本已解锁');
        const now = new Date().toISOString();
        tx.update(scripts)
          .set({
            lockVersion: expectedLockVersion + 1,
            lockedAt: locked ? now : null,
            lockedBy: locked ? user.id : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(scripts.id, document.id),
              eq(scripts.version, expectedVersion),
              eq(scripts.lockVersion, expectedLockVersion),
            ),
          )
          .run();
        tx.insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            actorId: user.id,
            action: locked ? 'script.lock' : 'script.unlock',
            targetId: document.id,
            createdAt: now,
          })
          .run();
        return this.current(user, projectId);
      },
      { behavior: 'immediate' },
    );
  }
  save(user: CurrentUser, projectId: string, input: ScriptInput) {
    return this.append(user, projectId, input.expectedVersion, input);
  }
  restore(user: CurrentUser, projectId: string, version: number, expectedVersion: number) {
    return this.append(user, projectId, expectedVersion, undefined, version);
  }
  private append(
    user: CurrentUser,
    projectId: string,
    expectedVersion: number,
    input?: ScriptInput,
    sourceVersion?: number,
    importedSource?: ParsedSource,
  ) {
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, 'edit');
        const document = this.document(projectId, project.workspaceId);
        if (document?.lockedAt) fail(423, 'SCRIPT_LOCKED', '剧本已锁定，请由项目管理员明确解锁后创建新版本');
        const actualVersion = document?.version || 0;
        if (actualVersion !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '剧本已被修改，本地输入已保留', { latestVersion: actualVersion });
        const source = sourceVersion
          ? this.revision(projectId, project.workspaceId, sourceVersion)
          : undefined;
        if (sourceVersion && !source) fail(404, 'NOT_FOUND', '剧本版本不存在');
        const now = new Date().toISOString();
        const scriptId = document?.id || randomUUID();
        const version = actualVersion + 1;
        if (!document)
          tx.insert(scripts)
            .values({
              id: scriptId,
              projectId,
              workspaceId: project.workspaceId,
              version,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        else {
          const updated = tx
            .update(scripts)
            .set({ version, updatedAt: now })
            .where(and(eq(scripts.id, scriptId), eq(scripts.version, expectedVersion)))
            .returning()
            .get();
          if (!updated) fail(409, 'VERSION_CONFLICT', '剧本已被修改，请加载最新版本');
        }
        const revisionId = randomUUID();
        tx.insert(scriptRevisions)
          .values({
            id: revisionId,
            scriptId,
            projectId,
            workspaceId: project.workspaceId,
            version,
            title: source?.title ?? input!.title,
            content: source?.content ?? input!.content,
            summary: source ? `从 v${source.version} 恢复` : input!.summary,
            restoredFromVersion: source?.version ?? null,
            createdBy: user.id,
            createdAt: now,
          })
          .run();
        if (importedSource) {
          const { content: _content, ...evidence } = importedSource;
          tx.insert(scriptSources)
            .values({ id: randomUUID(), revisionId, ...evidence, createdAt: now })
            .run();
        }
        tx.insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            actorId: user.id,
            action: importedSource ? 'script.import' : source ? 'script.restore' : 'script.save',
            targetId: scriptId,
            createdAt: now,
          })
          .run();
        return this.current(user, projectId);
      },
      { behavior: 'immediate' },
    );
  }
}
