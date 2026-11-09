import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { BoardLayout } from '../../../../packages/contracts/src/board';
import { CurrentUser, fail, parse } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { boards, boardRevisions, generationJobs } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { GenerationService, type GenerationSnapshot } from '../generation/generation.service';
import {
  createJobInput,
  createProjectJobInput,
  type ReferenceMediaType,
} from '../generation/generation-contract';
import { boardLayout } from './board-contract';
import { BoardReferencesService } from './board-references.service';

export const boardJobInput = createJobInput
  .pick({ routing: true, confirmed: true })
  .extend({ expectedRevision: z.number().int().positive() })
  .strict();
@Injectable()
export class BoardGenerationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly generation: GenerationService,
    private readonly references: BoardReferencesService,
  ) {}
  private board(user: CurrentUser, id: string, edit = false) {
    const row = this.database.db.select().from(boards).where(eq(boards.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '画布不存在或无权访问');
    this.authz.project(user, row.projectId, edit ? 'edit' : 'read');
    return row;
  }
  jobs(user: CurrentUser, id: string, nodeId: string, cursor?: string) {
    const board = this.board(user, id);
    return this.generation.projectJobs(user, board.projectId, id, cursor, nodeId);
  }
  create(user: CurrentUser, id: string, nodeId: string, input: z.infer<typeof boardJobInput>, key: string) {
    return this.database.db.transaction(
      () => {
        const board = this.board(user, id, true),
          requestHash = createHash('sha256').update(JSON.stringify({ id, nodeId, input })).digest('hex');
        const replay = this.database.db
          .select()
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.projectId, board.projectId),
              isNull(generationJobs.shotId),
              eq(generationJobs.creatorId, user.id),
              eq(generationJobs.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          const execution = (JSON.parse(replay.snapshotJson) as GenerationSnapshot).boardExecution;
          if (execution?.requestHash !== requestHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他画布执行');
          return this.generation.get(user, replay.id);
        }
        if (board.version !== input.expectedRevision)
          fail(409, 'BOARD_VERSION_CONFLICT', '画布已有新修订，请比较并保存后再执行');
        const revision = this.database.db
          .select()
          .from(boardRevisions)
          .where(and(eq(boardRevisions.boardId, id), eq(boardRevisions.version, input.expectedRevision)))
          .get()!;
        const layout = parse(boardLayout, JSON.parse(revision.layoutJson)) as BoardLayout,
          node = layout.nodes.find((n) => n.id === nodeId);
        if (node?.type !== 'generation' || !node.data.generation?.workflowId)
          fail(400, 'BOARD_GENERATION_INCOMPLETE', '请选择生成节点的工作流并保存');
        const bindings = layout.edges.filter((e) => e.kind === 'input_binding' && e.target === nodeId);
        const textEdge = bindings.find((e) => e.targetPort === 'prompt'),
          imageEdge = bindings.find((e) => e.targetPort === 'first_frame');
        const text = layout.nodes.find((n) => n.id === textEdge?.source);
        if (!text || !['note', 'brief'].includes(text.type) || !text.data.text?.trim())
          fail(400, 'BOARD_GENERATION_INCOMPLETE', '生成节点需要连接非空文字');
        const resolveMedia = (sourceId: string, type: ReferenceMediaType) => {
          const source = layout.nodes.find((n) => n.id === sourceId)!;
          const value =
            source.type === 'result'
              ? this.references.result(user, board.projectId, source.data.jobId!, true, source.data.outputId)
              : this.references.resolve(user, board.projectId, source.data.ref!, true);
          if (value.status === 'unavailable' || value.media?.mediaType !== type)
            fail(
              400,
              type === 'image' ? 'REFERENCE_IMAGE_INVALID' : 'REFERENCE_MEDIA_INVALID',
              '参考素材必须是类型匹配且可访问的固定版本',
            );
          return value.media.id;
        };
        const referenceMediaVersions = Object.fromEntries(
          bindings.flatMap((edge) =>
            edge.targetPort?.startsWith('reference:')
              ? [
                  [
                    edge.targetPort.slice('reference:'.length),
                    resolveMedia(edge.source, edge.sourcePort as ReferenceMediaType),
                  ],
                ]
              : [],
          ),
        );
        const job = parse(createProjectJobInput, {
          workflowId: node.data.generation.workflowId,
          parameterValues: node.data.generation.parameterValues,
          fieldValues: node.data.generation.fieldValues,
          positivePrompt: text.data.text,
          negativePrompt: text.data.prompt?.negativePrompt ?? '',
          source: text.data.prompt?.source ?? '',
          promptLibraryRevisionId: text.data.prompt?.promptLibraryRevisionId,
          imageVersionId: imageEdge && resolveMedia(imageEdge.source, 'image'),
          referenceMediaVersions,
          boardId: id,
          routing: input.routing,
          confirmed: input.confirmed,
        });
        return this.generation.createBoardJob(user, board.projectId, job, key, {
          boardId: id,
          revision: input.expectedRevision,
          nodeId,
          requestHash,
          bindings: bindings.map((e) => ({ port: e.targetPort!, sourceNodeId: e.source })),
        });
      },
      { behavior: 'immediate' },
    );
  }
}
