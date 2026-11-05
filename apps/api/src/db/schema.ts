import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  blob,
  primaryKey,
  uniqueIndex,
  foreignKey,
  index,
  check,
  AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

export const visualStylePresets = [
  'unspecified',
  'cinematic_realism',
  'animation_3d',
  'animation_2d',
  'ink_wash',
  'custom',
] as const;
export const workFormats = [
  'custom',
  'short',
  'longform',
  'series',
  'film',
  'ad',
  'mv',
  'documentary',
] as const;
export const narrativeModes = ['none', 'narration', 'dialogue', 'hybrid', 'music_driven'] as const;
export const unitTypes = ['episode', 'act', 'chapter', 'sequence', 'scene', 'section'] as const;
export const productionTechniques = [
  'unspecified',
  'static',
  'animated_still',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'external',
] as const;

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  instanceAdmin: integer('instance_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});
export const systemState = sqliteTable('system_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    csrfHash: text('csrf_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('sessions_expiry').on(t.expiresAt)],
);
export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  nextProjectNumber: integer('next_project_number').notNull().default(1),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: text('created_at').notNull(),
});
export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['WORKSPACE_OWNER', 'WORKSPACE_ADMIN', 'MEMBER'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);
export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    code: text('code').notNull(),
    title: text('title').notNull(),
    aspectRatio: text('aspect_ratio').notNull().default('16:9'),
    language: text('language').notNull().default('zh-CN'),
    description: text('description').notNull().default(''),
    stylePreset: text('style_preset', { enum: visualStylePresets }).notNull().default('unspecified'),
    styleDescription: text('style_description').notNull().default(''),
    workFormat: text('work_format', { enum: workFormats }).notNull().default('custom'),
    narrativeMode: text('narrative_mode', { enum: narrativeModes }).notNull().default('none'),
    targetDurationSeconds: integer('target_duration_seconds'),
    directorNotes: text('director_notes').notNull().default(''),
    nextUnitNumber: integer('next_unit_number').notNull().default(1),
    nextEpisodeNumber: integer('next_episode_number').notNull().default(1),
    deletedAt: text('deleted_at'),
    deletedBy: text('deleted_by').references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('projects_workspace_code').on(t.workspaceId, t.code),
    uniqueIndex('projects_parent').on(t.id, t.workspaceId),
  ],
);
export const projectMembers = sqliteTable(
  'project_members',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: ['PROJECT_MANAGER', 'EDITOR', 'GENERATOR', 'REVIEWER', 'VIEWER'] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);
export const episodes = sqliteTable(
  'episodes',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    code: text('code').notNull(),
    title: text('title').notNull(),
    orderIndex: integer('order_index').notNull().default(0),
    nextShotNumber: integer('next_shot_number').notNull().default(1),
    unitType: text('unit_type', { enum: [...unitTypes, 'project_root'] })
      .notNull()
      .default('episode'),
    parentId: text('parent_id').references((): AnySQLiteColumn => episodes.id),
    outline: text('outline').notNull().default(''),
    targetDurationSeconds: integer('target_duration_seconds'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('episodes_project_code').on(t.projectId, t.code),
    uniqueIndex('episodes_parent').on(t.id, t.projectId, t.workspaceId),
    index('units_project_parent').on(t.projectId, t.parentId, t.orderIndex),
    uniqueIndex('units_project_root')
      .on(t.projectId)
      .where(sql`${t.unitType} = 'project_root'`),
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
  ],
);
export const shots = sqliteTable(
  'shots',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    episodeId: text('episode_id').notNull(),
    code: text('code').notNull(),
    sequence: integer('sequence').notNull().default(0),
    description: text('description').notNull().default(''),
    camera: text('camera').notNull().default(''),
    dialogue: text('dialogue').notNull().default(''),
    durationHint: integer('duration_hint').notNull().default(5),
    technique: text('technique', { enum: productionTechniques }).notNull().default('unspecified'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('shots_episode_code').on(t.episodeId, t.code),
    uniqueIndex('shots_scope').on(t.id, t.projectId, t.workspaceId),
    foreignKey({
      columns: [t.episodeId, t.projectId, t.workspaceId],
      foreignColumns: [episodes.id, episodes.projectId, episodes.workspaceId],
    }),
  ],
);
export const invitations = sqliteTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    email: text('email').notNull(),
    role: text('role', { enum: ['WORKSPACE_ADMIN', 'MEMBER'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    acceptedAt: integer('accepted_at'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
  },
  (t) => [
    uniqueIndex('invitations_pending_email')
      .on(t.workspaceId, t.email)
      .where(sql`${t.acceptedAt} is null`),
  ],
);
export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').references(() => workspaces.id),
  actorId: text('actor_id')
    .notNull()
    .references(() => users.id),
  action: text('action').notNull(),
  targetId: text('target_id').notNull(),
  createdAt: text('created_at').notNull(),
});

// A project has one canonical script; each save appends an immutable full revision.
export const scripts = sqliteTable(
  'scripts',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull().unique(),
    version: integer('version').notNull(),
    lockVersion: integer('lock_version').notNull().default(0),
    lockedAt: text('locked_at'),
    lockedBy: text('locked_by').references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('scripts_parent').on(t.id, t.projectId, t.workspaceId),
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    check('scripts_positive_version', sql`${t.version} >= 1`),
  ],
);
export const scriptRevisions = sqliteTable(
  'script_revisions',
  {
    id: text('id').primaryKey(),
    scriptId: text('script_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    summary: text('summary').notNull().default(''),
    restoredFromVersion: integer('restored_from_version'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('script_revisions_version').on(t.scriptId, t.version),
    uniqueIndex('script_revisions_scope').on(t.id, t.projectId, t.workspaceId),
    foreignKey({
      columns: [t.scriptId, t.projectId, t.workspaceId],
      foreignColumns: [scripts.id, scripts.projectId, scripts.workspaceId],
    }),
    check('script_revisions_positive_version', sql`${t.version} >= 1`),
  ],
);

// Bounded original text evidence, never general-purpose media storage.
export const scriptSources = sqliteTable(
  'script_sources',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id')
      .notNull()
      .unique()
      .references(() => scriptRevisions.id),
    fileName: text('file_name').notNull(),
    kind: text('kind', { enum: ['novel', 'script', 'narration', 'brief'] }).notNull(),
    origin: text('origin', { enum: ['file', 'paste'] }).notNull(),
    encoding: text('encoding').notNull(),
    sha256: text('sha256').notNull(),
    byteLength: integer('byte_length').notNull(),
    originalBytes: blob('original_bytes', { mode: 'buffer' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check(
      'script_sources_size',
      sql`${t.byteLength} > 0 AND ${t.byteLength} <= 180000 AND length(${t.originalBytes}) = ${t.byteLength}`,
    ),
  ],
);

export const textConnections = sqliteTable(
  'text_connections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    providerType: text('provider_type').notNull().default('openai_compatible'),
    baseUrl: text('base_url').notNull(),
    trustedPrivate: integer('trusted_private', { mode: 'boolean' }).notNull().default(false),
    encryptedSecret: text('encrypted_secret'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    approvedBy: text('approved_by')
      .notNull()
      .references(() => users.id),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('text_connections_scope').on(t.id, t.workspaceId)],
);
export const textModelProfiles = sqliteTable(
  'text_model_profiles',
  {
    id: text('id').primaryKey(),
    connectionId: text('connection_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    model: text('model').notNull(),
    outputMode: text('output_mode', { enum: ['json_schema', 'json_object', 'prompt_json'] }).notNull(),
    tokenParameter: text('token_parameter', { enum: ['max_tokens', 'max_completion_tokens'] })
      .notNull()
      .default('max_tokens'),
    maxOutputTokens: integer('max_output_tokens').notNull().default(4096),
    timeoutSeconds: integer('timeout_seconds').notNull().default(120),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.connectionId, t.workspaceId],
      foreignColumns: [textConnections.id, textConnections.workspaceId],
    }),
    uniqueIndex('text_models_scope').on(t.id, t.workspaceId),
  ],
);
export const analysisStates = [
  'queued',
  'preparing',
  'submitted',
  'retry_waiting',
  'needs_reconciliation',
  'failed',
  'cancelled',
  'completed',
] as const;
export const analysisRuns = sqliteTable(
  'analysis_runs',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => scriptRevisions.id),
    modelProfileId: text('model_profile_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    inputJson: text('input_json').notNull(),
    connectionSnapshotJson: text('connection_snapshot_json').notNull(),
    state: text('state', { enum: analysisStates }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    retryCount: integer('retry_count').notNull().default(0),
    nextRunAt: integer('next_run_at').notNull().default(0),
    leaseOwner: text('lease_owner'),
    leaseUntil: integer('lease_until'),
    providerTaskId: text('provider_task_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    version: integer('version').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    foreignKey({
      columns: [t.modelProfileId, t.workspaceId],
      foreignColumns: [textModelProfiles.id, textModelProfiles.workspaceId],
    }),
    uniqueIndex('analysis_idempotency').on(t.projectId, t.createdBy, t.idempotencyKey),
    index('analysis_queue').on(t.state, t.nextRunAt, t.createdAt),
    index('analysis_project_page').on(t.projectId, t.id),
    uniqueIndex('analysis_run_scope').on(t.id, t.projectId, t.workspaceId),
  ],
);
export const analysisProposals = sqliteTable(
  'analysis_proposals',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull().unique(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    bodyJson: text('body_json').notNull(),
    schemaVersion: text('schema_version').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('analysis_proposals_scope').on(t.id, t.projectId, t.workspaceId),
    foreignKey({
      columns: [t.runId, t.projectId, t.workspaceId],
      foreignColumns: [analysisRuns.id, analysisRuns.projectId, analysisRuns.workspaceId],
    }),
  ],
);

export const proposalReviews = sqliteTable(
  'proposal_reviews',
  {
    proposalId: text('proposal_id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    state: text('state', { enum: ['draft', 'rejected', 'accepted'] }).notNull(),
    version: integer('version').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.proposalId, t.projectId, t.workspaceId],
      foreignColumns: [analysisProposals.id, analysisProposals.projectId, analysisProposals.workspaceId],
    }),
    check('proposal_review_version', sql`${t.version} >= 1`),
  ],
);
export const proposalRevisions = sqliteTable(
  'proposal_revisions',
  {
    id: text('id').primaryKey(),
    proposalId: text('proposal_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    action: text('action', { enum: ['edit', 'rejected', 'reopened', 'accepted'] }).notNull(),
    bodyJson: text('body_json').notNull(),
    summary: text('summary').notNull(),
    decisionJson: text('decision_json').notNull().default('{}'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.proposalId, t.projectId, t.workspaceId],
      foreignColumns: [analysisProposals.id, analysisProposals.projectId, analysisProposals.workspaceId],
    }),
    uniqueIndex('proposal_revisions_version').on(t.proposalId, t.version),
    uniqueIndex('proposal_revisions_scope').on(t.id, t.projectId, t.workspaceId),
  ],
);
export const scriptSpans = sqliteTable(
  'script_spans',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    textHash: text('text_hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.revisionId, t.projectId, t.workspaceId],
      foreignColumns: [scriptRevisions.id, scriptRevisions.projectId, scriptRevisions.workspaceId],
    }),
    uniqueIndex('script_spans_scope').on(t.id, t.projectId, t.workspaceId),
    check('script_span_offsets', sql`${t.startOffset} >= 0 AND ${t.endOffset} > ${t.startOffset}`),
  ],
);
export const shotCardRevisions = sqliteTable(
  'shot_card_revisions',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    bodyJson: text('body_json').notNull(),
    sourceProposalRevisionId: text('source_proposal_revision_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    summary: text('summary').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [shots.id, shots.projectId, shots.workspaceId],
    }),
    foreignKey({
      columns: [t.sourceProposalRevisionId, t.projectId, t.workspaceId],
      foreignColumns: [proposalRevisions.id, proposalRevisions.projectId, proposalRevisions.workspaceId],
    }),
    uniqueIndex('shot_card_version').on(t.shotId, t.version),
    uniqueIndex('shot_card_scope').on(t.id, t.projectId, t.workspaceId),
  ],
);
export const shotScriptSpans = sqliteTable(
  'shot_script_spans',
  {
    cardRevisionId: text('card_revision_id').notNull(),
    spanId: text('span_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardRevisionId, t.spanId] }),
    foreignKey({
      columns: [t.cardRevisionId, t.projectId, t.workspaceId],
      foreignColumns: [shotCardRevisions.id, shotCardRevisions.projectId, shotCardRevisions.workspaceId],
    }),
    foreignKey({
      columns: [t.spanId, t.projectId, t.workspaceId],
      foreignColumns: [scriptSpans.id, scriptSpans.projectId, scriptSpans.workspaceId],
    }),
  ],
);
export const proposalAdoptions = sqliteTable(
  'proposal_adoptions',
  {
    proposalId: text('proposal_id').notNull(),
    candidateIndex: integer('candidate_index').notNull(),
    proposalRevisionId: text('proposal_revision_id').notNull(),
    shotId: text('shot_id').notNull().unique(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.proposalId, t.candidateIndex] }),
    foreignKey({
      columns: [t.proposalId, t.projectId, t.workspaceId],
      foreignColumns: [analysisProposals.id, analysisProposals.projectId, analysisProposals.workspaceId],
    }),
    foreignKey({
      columns: [t.proposalRevisionId, t.projectId, t.workspaceId],
      foreignColumns: [proposalRevisions.id, proposalRevisions.projectId, proposalRevisions.workspaceId],
    }),
    foreignKey({
      columns: [t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [shots.id, shots.projectId, shots.workspaceId],
    }),
  ],
);
