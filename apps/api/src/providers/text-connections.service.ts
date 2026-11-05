import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { auditEvents, textConnections, textModelProfiles } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProviderSecrets } from './provider-secrets';
import { approvedBaseUrl } from './safe-text-http';

export type TextProfileInput = {
  name: string;
  model: string;
  outputMode: 'json_schema' | 'json_object' | 'prompt_json';
  tokenParameter: 'max_tokens' | 'max_completion_tokens';
  maxOutputTokens: number;
  timeoutSeconds: number;
};
type ConnectionInput = {
  name: string;
  baseUrl: string;
  trustedPrivate: boolean;
  apiKey?: string;
  profile: TextProfileInput;
};
@Injectable()
export class TextConnectionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly secrets: ProviderSecrets,
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
  list(user: CurrentUser, workspaceId: string) {
    this.authz.workspace(user, workspaceId);
    const rows = this.database.db
      .select()
      .from(textConnections)
      .where(eq(textConnections.workspaceId, workspaceId))
      .orderBy(asc(textConnections.createdAt))
      .limit(100)
      .all();
    return {
      encryptionReady: this.secrets.ready,
      items: rows.map((row) => {
        const { encryptedSecret, ...value } = row;
        return {
          ...value,
          hasApiKey: !!encryptedSecret,
          profiles: this.database.db
            .select()
            .from(textModelProfiles)
            .where(eq(textModelProfiles.connectionId, row.id))
            .orderBy(asc(textModelProfiles.createdAt))
            .all(),
        };
      }),
    };
  }
  create(user: CurrentUser, workspaceId: string, input: ConnectionInput) {
    this.authz.workspace(user, workspaceId, true);
    if (!user.instanceAdmin) fail(403, 'ENDPOINT_APPROVAL_REQUIRED', '新增外部端点需要实例管理员批准');
    let baseUrl: string;
    try {
      baseUrl = approvedBaseUrl(input.baseUrl, input.trustedPrivate);
    } catch {
      fail(400, 'ENDPOINT_INVALID', '请提供合法 HTTPS 基础地址，自部署 HTTP 需明确批准');
    }
    return this.database.db.transaction(
      (tx) => {
        this.authz.workspace(user, workspaceId, true);
        const id = randomUUID(),
          now = new Date().toISOString();
        tx.insert(textConnections)
          .values({
            id,
            workspaceId,
            name: input.name,
            baseUrl,
            trustedPrivate: input.trustedPrivate,
            encryptedSecret: input.apiKey ? this.secrets.encrypt(input.apiKey, id, workspaceId) : null,
            approvedBy: user.id,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const profile = tx
          .insert(textModelProfiles)
          .values({
            id: randomUUID(),
            workspaceId,
            connectionId: id,
            ...input.profile,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get()!;
        this.audit(user, workspaceId, 'text.connection.create', id);
        return { id, profileId: profile.id };
      },
      { behavior: 'immediate' },
    );
  }
  update(
    user: CurrentUser,
    id: string,
    input: { expectedVersion: number; enabled?: boolean; apiKey?: string; name?: string },
  ) {
    return this.database.db.transaction(
      (tx) => {
        const connection = tx.select().from(textConnections).where(eq(textConnections.id, id)).get();
        if (!connection) fail(404, 'NOT_FOUND', '文本连接不存在');
        this.authz.workspace(user, connection.workspaceId, true);
        if (connection.version !== input.expectedVersion)
          fail(409, 'VERSION_CONFLICT', '文本连接已变化，请刷新后重试');
        tx.update(textConnections)
          .set({
            enabled: input.enabled,
            name: input.name,
            ...(input.apiKey !== undefined
              ? {
                  encryptedSecret: input.apiKey
                    ? this.secrets.encrypt(input.apiKey, id, connection.workspaceId)
                    : null,
                }
              : {}),
            version: input.expectedVersion + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(textConnections.id, id), eq(textConnections.version, input.expectedVersion)))
          .run();
        this.audit(user, connection.workspaceId, 'text.connection.update', id);
        return { ok: true };
      },
      { behavior: 'immediate' },
    );
  }
  addModel(user: CurrentUser, connectionId: string, input: TextProfileInput) {
    return this.database.db.transaction(
      (tx) => {
        const connection = tx
          .select()
          .from(textConnections)
          .where(eq(textConnections.id, connectionId))
          .get();
        if (!connection) fail(404, 'NOT_FOUND', '文本连接不存在');
        this.authz.workspace(user, connection.workspaceId, true);
        const now = new Date().toISOString();
        const model = tx
          .insert(textModelProfiles)
          .values({
            id: randomUUID(),
            workspaceId: connection.workspaceId,
            connectionId,
            ...input,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get()!;
        this.audit(user, connection.workspaceId, 'text.model.create', model.id);
        return model;
      },
      { behavior: 'immediate' },
    );
  }
  getModel(id: string) {
    const found = this.database.db
      .select({ profile: textModelProfiles, connection: textConnections })
      .from(textModelProfiles)
      .innerJoin(textConnections, eq(textConnections.id, textModelProfiles.connectionId))
      .where(eq(textModelProfiles.id, id))
      .get();
    if (!found) fail(404, 'NOT_FOUND', '文本模型不存在');
    return found;
  }
  credential(connection: typeof textConnections.$inferSelect) {
    return this.secrets.decrypt(connection.encryptedSecret, connection.id, connection.workspaceId);
  }
}
