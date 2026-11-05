import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { auditEvents, shots } from '../db/schema';
import { ProductionService } from './production.service';
import { FormalCard } from './formal-card';
import { appendCardEdition, cardRecord } from './shot-cards';

@Injectable()
export class CardAuthoringService {
  constructor(
    private readonly database: DatabaseService,
    private readonly production: ProductionService,
  ) {}
  editor(user: CurrentUser, id: string) {
    const shot = this.production.shot(user, id);
    const card = this.production.card(user, id);
    const body: FormalCard = card.available
      ? card.body
      : {
          title: `镜头 ${shot.code}`,
          intent: '',
          description: shot.description,
          framing: '',
          angle: '',
          composition: '',
          cameraMovement: shot.camera,
          action: '',
          lighting: '',
          mood: '',
          dialogue: shot.dialogue,
          audioNotes: '',
          durationSeconds: shot.durationHint,
          technique: shot.technique,
          assets: [],
          riskNotes: [],
          sourceSpanIds: [],
          sourceAudioPolicy: 'inspect',
        };
    return {
      shot,
      card,
      body,
      project: this.production.project(user, shot.projectId),
      ...this.production.access(user, shot.projectId),
    };
  }
  save(user: CurrentUser, id: string, expectedVersion: number, body: FormalCard, summary: string) {
    return this.database.db.transaction(
      () => {
        const shot = this.production.shot(user, id, 'edit');
        if (shot.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '镜头已被修改，本地制作卡输入已保留');
        const previous = cardRecord(this.database, id, shot.version);
        const sources: string[] = previous ? JSON.parse(previous.bodyJson).sourceSpanIds : [];
        if (JSON.stringify(body.sourceSpanIds) !== JSON.stringify(sources))
          fail(400, 'CARD_SOURCE_IMMUTABLE', '请保留服务端提供的原文引用；跨版本来源编辑尚未开放');
        const updated = this.database.db
          .update(shots)
          .set({
            description: body.description,
            camera: body.cameraMovement,
            dialogue: body.dialogue,
            durationHint: body.durationSeconds,
            technique: body.technique,
            version: expectedVersion + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(shots.id, id), eq(shots.version, expectedVersion)))
          .returning()
          .get()!;
        appendCardEdition(
          this.database,
          user,
          updated,
          body,
          previous?.sourceProposalRevisionId ?? null,
          summary || '编辑完整制作卡',
        );
        this.database.db
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: shot.workspaceId,
            actorId: user.id,
            action: 'shot.card.edit',
            targetId: id,
            createdAt: new Date().toISOString(),
          })
          .run();
        return this.editor(user, id);
      },
      { behavior: 'immediate' },
    );
  }
}
