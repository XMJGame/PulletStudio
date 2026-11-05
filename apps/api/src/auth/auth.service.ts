import { Injectable } from '@nestjs/common';
import { and, eq, gt, lte, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import { AppConfig } from '../config';
import {
  auditEvents,
  invitations,
  sessions,
  systemState,
  users,
  workspaceMembers,
  workspaces,
} from '../db/schema';
import { CurrentUser, fail } from '../common/http';
import { digest, equalSecret, hashPassword, secret, verifyPassword } from './password';

export function publicUser(user: typeof users.$inferSelect): CurrentUser {
  return { id: user.id, email: user.email, name: user.name, instanceAdmin: user.instanceAdmin };
}
@Injectable()
export class AuthService {
  private readonly dummyHash = hashPassword(secret());
  constructor(
    private readonly database: DatabaseService,
    private readonly config: AppConfig,
  ) {}
  status() {
    return {
      initialized: !!this.database.db
        .select()
        .from(systemState)
        .where(eq(systemState.key, 'initialized'))
        .get(),
      setupEnabled: this.config.setupToken.length >= 32,
    };
  }
  async initialize(input: {
    setupToken: string;
    email: string;
    name: string;
    password: string;
    workspaceName: string;
  }) {
    if (!this.config.setupToken || !equalSecret(input.setupToken, this.config.setupToken))
      fail(403, 'SETUP_DENIED', '初始化密钥无效或未配置');
    if (this.status().initialized) fail(409, 'ALREADY_INITIALIZED', '系统已经初始化');
    const passwordHash = await hashPassword(input.password);
    const user = {
      id: randomUUID(),
      email: input.email,
      name: input.name,
      passwordHash,
      instanceAdmin: true,
      createdAt: new Date().toISOString(),
    };
    const workspace = {
      id: randomUUID(),
      name: input.workspaceName,
      slug: `ws-${randomUUID()}`,
      createdBy: user.id,
      createdAt: user.createdAt,
    };
    this.database.db.transaction(
      (tx) => {
        if (tx.select().from(systemState).where(eq(systemState.key, 'initialized')).get())
          fail(409, 'ALREADY_INITIALIZED', '系统已经初始化');
        tx.insert(systemState).values({ key: 'initialized', value: user.createdAt }).run();
        tx.insert(users).values(user).run();
        tx.insert(workspaces).values(workspace).run();
        tx.insert(workspaceMembers)
          .values({ workspaceId: workspace.id, userId: user.id, role: 'WORKSPACE_OWNER' })
          .run();
        tx.insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: workspace.id,
            actorId: user.id,
            action: 'setup.initialize',
            targetId: workspace.id,
            createdAt: user.createdAt,
          })
          .run();
      },
      { behavior: 'immediate' },
    );
    return { user: publicUser(user), workspace };
  }
  async login(email: string, password: string) {
    const user = this.database.db.select().from(users).where(eq(users.email, email)).get();
    const valid = await verifyPassword(password, user?.passwordHash || (await this.dummyHash));
    if (!user || !valid) fail(401, 'INVALID_CREDENTIALS', '邮箱或密码错误');
    return publicUser(user);
  }
  createSession(userId: string, previousToken?: string) {
    const token = secret();
    const csrfToken = secret();
    const now = Date.now();
    this.database.db.transaction((tx) => {
      tx.delete(sessions).where(lte(sessions.expiresAt, now)).run();
      if (previousToken)
        tx.delete(sessions)
          .where(eq(sessions.tokenHash, digest(previousToken)))
          .run();
      tx.insert(sessions)
        .values({
          tokenHash: digest(token),
          csrfHash: digest(csrfToken),
          userId,
          createdAt: now,
          expiresAt: now + this.config.sessionHours * 3600000,
        })
        .run();
    });
    return { token, csrfToken };
  }
  session(token: string) {
    return this.database.db
      .select({ user: users, session: sessions })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, Date.now())))
      .get();
  }
  logout(sessionHash: string) {
    this.database.db.delete(sessions).where(eq(sessions.tokenHash, sessionHash)).run();
  }
  async accept(input: { token: string; name?: string; password?: string }, existingUser?: CurrentUser) {
    const invitation = this.database.db
      .select()
      .from(invitations)
      .where(eq(invitations.tokenHash, digest(input.token)))
      .get();
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= Date.now())
      fail(400, 'INVITATION_INVALID', '邀请已失效或已使用');
    const existing = this.database.db.select().from(users).where(eq(users.email, invitation.email)).get();
    if (existing && existingUser?.id !== existing.id)
      fail(409, 'LOGIN_REQUIRED', '该邮箱已有账户，请先登录再接受邀请');
    if (!existing && (!input.name || !input.password))
      fail(400, 'REGISTRATION_REQUIRED', '新账户需要填写姓名与 8–16 位密码');
    const user = existing || {
      id: randomUUID(),
      email: invitation.email,
      name: input.name!,
      passwordHash: await hashPassword(input.password!),
      instanceAdmin: false,
      createdAt: new Date().toISOString(),
    };
    this.database.db.transaction(
      (tx) => {
        const claimed = tx
          .update(invitations)
          .set({ acceptedAt: Date.now() })
          .where(
            and(
              eq(invitations.id, invitation.id),
              isNull(invitations.acceptedAt),
              gt(invitations.expiresAt, Date.now()),
              eq(invitations.tokenHash, digest(input.token)),
            ),
          )
          .returning()
          .get();
        // Re-read under the write lock, to reject a second concurrent acceptance.
        if (
          !claimed ||
          tx
            .select()
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, invitation.workspaceId),
                eq(workspaceMembers.userId, user.id),
              ),
            )
            .get()
        )
          fail(409, 'INVITATION_USED', '邀请已使用或用户已加入工作区');
        if (!existing) tx.insert(users).values(user).run();
        tx.insert(workspaceMembers)
          .values({ workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role })
          .run();
        tx.insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: invitation.workspaceId,
            actorId: user.id,
            action: 'invitation.accept',
            targetId: invitation.id,
            createdAt: new Date().toISOString(),
          })
          .run();
      },
      { behavior: 'immediate' },
    );
    return publicUser(user);
  }
}
