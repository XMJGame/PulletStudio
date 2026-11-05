import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  episodes,
  promptArtifacts,
  promptProfiles,
  scripts,
  shots,
  storyboardExports,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { PromptService } from '../prompt/prompt.service';
import {
  ExportDocument,
  exportLimits,
  ExportOptions,
  ExportPrompt,
  ExportShot,
  ExportSnapshot,
  ExportUnit,
} from './export-contract';
import { exportMediaTypes, renderStoryboard } from './render-storyboard';

const checksum = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const metadataColumns = {
  id: storyboardExports.id,
  projectId: storyboardExports.projectId,
  workspaceId: storyboardExports.workspaceId,
  createdBy: storyboardExports.createdBy,
  createdAt: storyboardExports.createdAt,
  format: storyboardExports.format,
  sha256: storyboardExports.sha256,
  snapshotHash: storyboardExports.snapshotHash,
  byteLength: storyboardExports.byteLength,
  shotCount: storyboardExports.shotCount,
};
type Metadata = Pick<typeof storyboardExports.$inferSelect, keyof typeof metadataColumns>;
@Injectable()
export class StoryboardExportsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
    private readonly prompts: PromptService,
  ) {}
  private view(row: Metadata) {
    return {
      ...row,
      fileName: `storyboard-${row.id}.${row.format}`,
      mediaType: exportMediaTypes[row.format],
      downloadPath: `/api/v1/storyboard-exports/${row.id}/file`,
    };
  }
  private collect(user: CurrentUser, projectId: string, options: ExportOptions): ExportSnapshot {
    const project = this.authz.project(user, projectId);
    const units = this.database.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.projectId, projectId), eq(episodes.workspaceId, project.workspaceId)))
      .orderBy(asc(episodes.orderIndex), asc(episodes.id))
      .limit(exportLimits.units + 2)
      .all();
    if (units.length > exportLimits.units + 1)
      fail(413, 'EXPORT_UNIT_LIMIT', '制作层级超出2000个单元，本轮有界导出暂不支持此规模');
    const root = units.find((unit) => unit.unitType === 'project_root');
    const visible = units.filter((unit) => unit.unitType !== 'project_root');
    if (visible.length > exportLimits.units) fail(413, 'EXPORT_UNIT_LIMIT', '制作层级超出2000个单元');
    const byId = new Map(visible.map((unit) => [unit.id, unit]));
    const ordered: typeof visible = [];
    const stack = visible.filter((unit) => !unit.parentId).reverse();
    const visited = new Set<string>();
    while (stack.length) {
      const unit = stack.pop()!;
      if (visited.has(unit.id)) fail(409, 'EXPORT_STRUCTURE_INVALID', '制作层级关系异常');
      visited.add(unit.id);
      ordered.push(unit);
      stack.push(...visible.filter((child) => child.parentId === unit.id).reverse());
    }
    if (visited.size !== visible.length) fail(409, 'EXPORT_STRUCTURE_INVALID', '制作层级不完整，未生成导出');
    const rank = new Map(ordered.map((unit, index) => [unit.id, index + 1]));
    const included = new Set<string>();
    const scope = options.scope;
    if (scope.type === 'unit') {
      if (!byId.has(scope.unitId)) fail(404, 'NOT_FOUND', '制作单元不存在或不属于当前项目');
      included.add(scope.unitId);
      if (scope.includeDescendants)
        for (const unit of ordered) if (unit.parentId && included.has(unit.parentId)) included.add(unit.id);
    }
    const filter =
      scope.type === 'root'
        ? root
          ? eq(shots.episodeId, root.id)
          : sql`0`
        : scope.type === 'unit'
          ? inArray(shots.episodeId, [...included])
          : scope.type === 'shots'
            ? inArray(shots.id, scope.shotIds)
            : undefined;
    const rows = this.database.db
      .select()
      .from(shots)
      .where(and(eq(shots.projectId, projectId), eq(shots.workspaceId, project.workspaceId), filter))
      .limit(exportLimits.shots + 1)
      .all();
    if (rows.length > exportLimits.shots)
      fail(413, 'EXPORT_SHOT_LIMIT', '单次最多导出200个镜头，请按单元或镜头拆分；未截断内容');
    if (scope.type === 'shots' && rows.length !== scope.shotIds.length)
      fail(404, 'NOT_FOUND', '部分镜头不存在或不属于当前项目');
    if (!rows.length) fail(400, 'EXPORT_EMPTY', '此范围没有镜头，请选择其他范围');
    rows.sort(
      (a, b) =>
        (rank.get(a.episodeId) ?? 0) - (rank.get(b.episodeId) ?? 0) ||
        a.sequence - b.sequence ||
        a.id.localeCompare(b.id),
    );
    const unitIds = new Set<string>(scope.type === 'project' ? ordered.map((unit) => unit.id) : included);
    const exports: ExportShot[] = [];
    let accumulatedBytes = 0;
    for (const shot of rows) {
      const path: ExportShot['unitPath'] = [];
      let parent = byId.get(shot.episodeId);
      while (parent) {
        unitIds.add(parent.id);
        path.unshift({ id: parent.id, code: parent.code, title: parent.title, version: parent.version });
        parent = parent.parentId ? byId.get(parent.parentId) : undefined;
      }
      const card = this.production.card(user, shot.id);
      const warnings: string[] = [];
      let prompt: ExportPrompt | null = null;
      if (!card.available) warnings.push('未保存完整制作卡，仅导出已有镜头基本资料。');
      if (options.promptMode === 'saved') {
        const latest = this.database.db
          .select({ id: promptArtifacts.id })
          .from(promptArtifacts)
          .where(
            and(
              eq(promptArtifacts.shotId, shot.id),
              eq(promptArtifacts.projectId, projectId),
              eq(promptArtifacts.workspaceId, project.workspaceId),
            ),
          )
          .orderBy(desc(promptArtifacts.createdAt), desc(promptArtifacts.id))
          .limit(1)
          .get();
        if (latest) {
          const artifact = this.prompts.artifact(user, shot.id, latest.id);
          const profileId = artifact.snapshot.profile.profileId as string | undefined;
          const current = profileId
            ? this.database.db
                .select({ id: promptProfiles.id })
                .from(promptProfiles)
                .where(and(eq(promptProfiles.profileId, profileId), eq(promptProfiles.projectId, projectId)))
                .orderBy(desc(promptProfiles.version))
                .get()
            : undefined;
          prompt = { kind: 'saved', ...artifact, checkedProfileRevisionId: current?.id ?? null };
          if (prompt.freshness.stale)
            warnings.push(
              `已保存提示词使用历史输入：${prompt.freshness.reasons.join('；')}。当前制作卡与提示词原卡请分别核对。`,
            );
        } else warnings.push('尚无已保存提示词；没有自动编译或创建Artifact。');
      } else if (card.available) {
        const compiled = this.prompts.compile(user, shot.id, {
          mode: 'preview',
          expectedShotVersion: shot.version,
          expectedProjectVersion: project.version,
          profileRevisionId: null,
        });
        prompt = { kind: 'neutral', ...compiled, checkedProfileRevisionId: null };
        warnings.push('提示词为本次中立离线编译，未另存Artifact，不含自定义Profile规则。');
      }
      const item: ExportShot = {
        id: shot.id,
        code: shot.code,
        version: shot.version,
        sequence: shot.sequence,
        unitId: root?.id === shot.episodeId ? null : shot.episodeId,
        unitPath: path,
        basic: {
          description: shot.description,
          camera: shot.camera,
          dialogue: shot.dialogue,
          durationHint: shot.durationHint,
          technique: shot.technique,
        },
        card: card.available ? card : null,
        prompt,
        warnings,
      };
      accumulatedBytes += Buffer.byteLength(JSON.stringify(item), 'utf8');
      if (accumulatedBytes > exportLimits.snapshotBytes)
        fail(413, 'EXPORT_SNAPSHOT_LIMIT', '导出快照超过4MiB，请缩小镜头范围；未截断内容');
      exports.push(item);
    }
    // Ancestors are required for a selected empty unit or a descendant-only scope.
    for (const id of [...unitIds]) {
      let unit = byId.get(id);
      while (unit?.parentId) {
        unitIds.add(unit.parentId);
        unit = byId.get(unit.parentId);
      }
    }
    const exportedUnits: ExportUnit[] = ordered
      .filter((unit) => unitIds.has(unit.id))
      .map((unit) => ({
        id: unit.id,
        code: unit.code,
        title: unit.title,
        version: unit.version,
        parentId: unit.parentId,
        kind: unit.unitType,
        orderIndex: unit.orderIndex,
        outline: unit.outline,
        targetDurationSeconds: unit.targetDurationSeconds,
      }));
    const script = this.database.db
      .select({ version: scripts.version })
      .from(scripts)
      .where(eq(scripts.projectId, projectId))
      .get();
    const snapshot: ExportSnapshot = {
      schemaVersion: 'studio.storyboard.v1',
      project: {
        id: project.id,
        code: project.code,
        title: project.title,
        version: project.version,
        aspectRatio: project.aspectRatio,
        language: project.language,
        description: project.description,
        workFormat: project.workFormat,
        narrativeMode: project.narrativeMode,
        stylePreset: project.stylePreset,
        styleDescription: project.styleDescription,
        directorNotes: project.directorNotes,
        targetDurationSeconds: project.targetDurationSeconds,
      },
      scope,
      promptMode: options.promptMode,
      observed: { scriptVersion: script?.version ?? 0 },
      units: exportedUnits,
      shots: exports,
      warnings: [
        '这是分镜文本快照，不包含媒体文件、API凭据或完整可重导入项目包。',
        '镜头时长与原声策略是制作计划；模型能力、资产参考与真实音轨仍需核对。',
        ...(options.format === 'csv' ? ['CSV对可能被表格执行的单元格加单引号；需逐字原值请使用JSON。'] : []),
      ],
    };
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > exportLimits.snapshotBytes)
      fail(413, 'EXPORT_SNAPSHOT_LIMIT', '导出快照超过4MiB，请缩小范围');
    return snapshot;
  }
  private prepare(user: CurrentUser, projectId: string, options: ExportOptions) {
    const snapshot = this.collect(user, projectId, options);
    const snapshotHash = checksum(JSON.stringify({ format: options.format, snapshot }));
    const document: ExportDocument = {
      ...snapshot,
      exportId: '00000000-0000-0000-0000-000000000000',
      exportedAt: '1970-01-01T00:00:00.000Z',
      snapshotHash,
    };
    const byteLength = renderStoryboard(document, options.format).length;
    if (byteLength > exportLimits.fileBytes)
      fail(413, 'EXPORT_FILE_LIMIT', '导出文件超过8MiB，请缩小范围；未截断内容');
    return { snapshot, snapshotHash, byteLength };
  }
  preview(user: CurrentUser, projectId: string, options: ExportOptions) {
    return this.database.db.transaction(() => {
      const prepared = this.prepare(user, projectId, options);
      return {
        snapshotHash: prepared.snapshotHash,
        projectVersion: prepared.snapshot.project.version,
        byteLength: prepared.byteLength,
        shotCount: prepared.snapshot.shots.length,
        limits: exportLimits,
        warnings: prepared.snapshot.warnings,
        items: prepared.snapshot.shots.map((shot) => ({
          id: shot.id,
          code: shot.code,
          path: shot.unitPath.map((unit) => `${unit.code} ${unit.title}`).join(' / ') || '项目直属',
          version: shot.version,
          cardVersion: shot.card?.version ?? null,
          promptId: shot.prompt?.id ?? null,
          promptKind: shot.prompt?.kind ?? null,
          warnings: [...shot.warnings, ...(shot.prompt?.rendered.warnings ?? [])],
        })),
      };
    });
  }
  create(
    user: CurrentUser,
    projectId: string,
    options: ExportOptions,
    expectedSnapshotHash: string,
    key: string,
  ) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId);
        const requestHash = checksum(JSON.stringify({ ...options, expectedSnapshotHash }));
        const existing = this.database.db
          .select(metadataColumns)
          .from(storyboardExports)
          .where(
            and(
              eq(storyboardExports.projectId, projectId),
              eq(storyboardExports.createdBy, user.id),
              eq(storyboardExports.idempotencyKey, key),
            ),
          )
          .get();
        if (existing) {
          const hash = this.database.db
            .select({ hash: storyboardExports.requestHash })
            .from(storyboardExports)
            .where(eq(storyboardExports.id, existing.id))
            .get()!;
          if (hash.hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', '同一请求标识已用于其他导出选项');
          return { ...this.view(existing), replayed: true };
        }
        const prepared = this.prepare(user, projectId, options);
        if (prepared.snapshotHash !== expectedSnapshotHash)
          fail(409, 'EXPORT_PREVIEW_CHANGED', '制作内容或提示词已变化，请重新预览后确认导出；选项已保留');
        const id = randomUUID(),
          createdAt = new Date().toISOString();
        const document: ExportDocument = {
          ...prepared.snapshot,
          exportId: id,
          exportedAt: createdAt,
          snapshotHash: prepared.snapshotHash,
        };
        const content = renderStoryboard(document, options.format);
        if (content.length > exportLimits.fileBytes)
          fail(413, 'EXPORT_FILE_LIMIT', '导出文件超过8MiB，请缩小范围');
        const row = this.database.db
          .insert(storyboardExports)
          .values({
            id,
            projectId,
            workspaceId: project.workspaceId,
            createdBy: user.id,
            createdAt,
            format: options.format,
            idempotencyKey: key,
            requestHash,
            snapshotHash: prepared.snapshotHash,
            snapshotJson: JSON.stringify(document),
            content,
            sha256: checksum(content),
            byteLength: content.length,
            shotCount: document.shots.length,
          })
          .returning(metadataColumns)
          .get()!;
        this.database.db
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            actorId: user.id,
            action: 'storyboard.export.create',
            targetId: id,
            createdAt,
          })
          .run();
        return { ...this.view(row), replayed: false };
      },
      { behavior: 'immediate' },
    );
  }
  private authorize(user: CurrentUser, id: string) {
    const row = this.database.db
      .select(metadataColumns)
      .from(storyboardExports)
      .where(eq(storyboardExports.id, id))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '分镜导出不存在或无权访问');
    this.authz.project(user, row.projectId);
    return row;
  }
  read(user: CurrentUser, id: string) {
    const row = this.authorize(user, id);
    const data = this.database.db
      .select({ snapshot: storyboardExports.snapshotJson })
      .from(storyboardExports)
      .where(eq(storyboardExports.id, id))
      .get()!;
    const snapshot = JSON.parse(data.snapshot) as ExportDocument;
    return {
      ...this.view(row),
      scope: snapshot.scope,
      promptMode: snapshot.promptMode,
      project: snapshot.project,
      warnings: snapshot.warnings,
    };
  }
  file(user: CurrentUser, id: string) {
    const row = this.authorize(user, id);
    const content = this.database.db
      .select({ content: storyboardExports.content })
      .from(storyboardExports)
      .where(eq(storyboardExports.id, id))
      .get()!.content;
    if (content.length !== row.byteLength || checksum(content) !== row.sha256)
      fail(409, 'EXPORT_FILE_INTEGRITY', '导出文件校验失败，未提供不一致的文件');
    return { ...this.view(row), content };
  }
  list(user: CurrentUser, projectId: string, cursor?: string) {
    this.authz.project(user, projectId);
    const boundary = cursor
      ? this.database.db
          .select(metadataColumns)
          .from(storyboardExports)
          .where(and(eq(storyboardExports.id, cursor), eq(storyboardExports.projectId, projectId)))
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'INVALID_CURSOR', '导出记录分页位置无效');
    const rows = this.database.db
      .select(metadataColumns)
      .from(storyboardExports)
      .where(
        and(
          eq(storyboardExports.projectId, projectId),
          boundary
            ? or(
                lt(storyboardExports.createdAt, boundary.createdAt),
                and(
                  eq(storyboardExports.createdAt, boundary.createdAt),
                  lt(storyboardExports.id, boundary.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(storyboardExports.createdAt), desc(storyboardExports.id))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => this.view(row)),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
}
