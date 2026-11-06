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

// Human-authored continuations share Shot.version with the original immutable AI cards.
export const shotCardEditions = sqliteTable(
  'shot_card_editions',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    bodyJson: text('body_json').notNull(),
    sourceProposalRevisionId: text('source_proposal_revision_id'),
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
    uniqueIndex('shot_card_edition_version').on(t.shotId, t.version),
    check('shot_card_edition_positive', sql`${t.version} > 0`),
  ],
);
export const promptProfiles = sqliteTable(
  'prompt_profiles',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    configJson: text('config_json').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    uniqueIndex('prompt_profile_version').on(t.profileId, t.version),
    uniqueIndex('prompt_profile_scope').on(t.id, t.projectId, t.workspaceId),
    index('prompt_profile_project').on(t.projectId, t.profileId, t.version),
    check('prompt_profile_positive', sql`${t.version} > 0`),
  ],
);
export const promptArtifacts = sqliteTable(
  'prompt_artifacts',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    cardId: text('card_id').notNull(),
    cardVersion: integer('card_version').notNull(),
    projectVersion: integer('project_version').notNull(),
    profileRevisionId: text('profile_revision_id'),
    compilerVersion: text('compiler_version').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    renderedJson: text('rendered_json').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [shots.id, shots.projectId, shots.workspaceId],
    }),
    foreignKey({
      columns: [t.profileRevisionId, t.projectId, t.workspaceId],
      foreignColumns: [promptProfiles.id, promptProfiles.projectId, promptProfiles.workspaceId],
    }),
    index('prompt_artifact_page').on(t.shotId, t.id),
  ],
);

export const storyboardExports = sqliteTable(
  'storyboard_exports',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    format: text('format', { enum: ['json', 'md', 'csv'] }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    content: blob('content', { mode: 'buffer' }).notNull(),
    sha256: text('sha256').notNull(),
    byteLength: integer('byte_length').notNull(),
    shotCount: integer('shot_count').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    uniqueIndex('storyboard_export_idempotency').on(t.projectId, t.createdBy, t.idempotencyKey),
    index('storyboard_export_page').on(t.projectId, t.createdAt, t.id),
    check('storyboard_export_size', sql`${t.byteLength} > 0 AND ${t.byteLength} <= 8388608`),
    check('storyboard_export_shot_count', sql`${t.shotCount} > 0 AND ${t.shotCount} <= 200`),
  ],
);

export const mediaPackageExports = sqliteTable(
  'media_package_exports',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    manifestJson: text('manifest_json').notNull(),
    shotCount: integer('shot_count').notNull(),
    mediaBytes: integer('media_bytes').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    uniqueIndex('media_package_request').on(t.projectId, t.createdBy, t.requestKey),
    index('media_package_page').on(t.projectId, t.createdAt, t.id),
    check(
      'media_package_limits',
      sql`${t.shotCount} BETWEEN 1 AND 100 AND ${t.mediaBytes}>0 AND ${t.mediaBytes}<=2147483648 AND length(CAST(${t.manifestJson} AS BLOB))<=4194304`,
    ),
  ],
);

export const storageConnections = sqliteTable('storage_connections', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  createdAt: text('created_at').notNull(),
});
export const mediaAssets = sqliteTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    version: integer('version').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    uniqueIndex('media_asset_scope').on(t.id, t.projectId, t.workspaceId),
    index('media_asset_page').on(t.projectId, t.createdAt, t.id),
    check('media_asset_version_positive', sql`${t.version} > 0`),
  ],
);
export const mediaVersions = sqliteTable(
  'media_versions',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    storageId: text('storage_id')
      .notNull()
      .references(() => storageConnections.id),
    objectKey: text('object_key').notNull().unique(),
    fileName: text('file_name').notNull(),
    mediaType: text('media_type', { enum: ['image', 'video', 'audio'] }).notNull(),
    mime: text('mime').notNull(),
    byteLength: integer('byte_length').notNull(),
    sha256: text('sha256').notNull(),
    metadataJson: text('metadata_json').notNull(),
    posterJson: text('poster_json'),
    origin: text('origin').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.assetId, t.projectId, t.workspaceId],
      foreignColumns: [mediaAssets.id, mediaAssets.projectId, mediaAssets.workspaceId],
    }),
    uniqueIndex('media_version_number').on(t.assetId, t.version),
    uniqueIndex('media_version_scope').on(t.id, t.projectId, t.workspaceId),
    check('media_version_size', sql`${t.byteLength}>0`),
  ],
);
export const mediaUploadStates = [
  'created',
  'uploading',
  'complete',
  'failed',
  'needs_reconciliation',
] as const;
export const mediaUploads = sqliteTable(
  'media_uploads',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    assetId: text('asset_id').notNull(),
    mediaVersionId: text('media_version_id').notNull().unique(),
    expectedAssetVersion: integer('expected_asset_version').notNull(),
    storageId: text('storage_id')
      .notNull()
      .references(() => storageConnections.id),
    fileName: text('file_name').notNull(),
    declaredMime: text('declared_mime').notNull(),
    expectedBytes: integer('expected_bytes').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    generationJobId: text('generation_job_id'),
    animaticJobId: text('animatic_job_id'),
    requestHash: text('request_hash').notNull(),
    state: text('state', { enum: mediaUploadStates }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseUntil: integer('lease_until'),
    receivedBytes: integer('received_bytes').notNull().default(0),
    preparedJson: text('prepared_json'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    uniqueIndex('media_upload_idempotency').on(t.projectId, t.createdBy, t.idempotencyKey),
    index('media_upload_page').on(t.projectId, t.createdAt, t.id),
    index('media_upload_lease').on(t.state, t.leaseUntil),
  ],
);
export const takes = sqliteTable(
  'takes',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    mediaVersionId: text('media_version_id').notNull(),
    takeNo: integer('take_no').notNull(),
    state: text('state', { enum: ['draft'] })
      .notNull()
      .default('draft'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [shots.id, shots.projectId, shots.workspaceId],
    }),
    foreignKey({
      columns: [t.mediaVersionId, t.projectId, t.workspaceId],
      foreignColumns: [mediaVersions.id, mediaVersions.projectId, mediaVersions.workspaceId],
    }),
    uniqueIndex('take_number').on(t.shotId, t.takeNo),
    uniqueIndex('take_media_once').on(t.shotId, t.mediaVersionId),
    uniqueIndex('take_review_scope').on(t.id, t.shotId, t.projectId, t.workspaceId, t.mediaVersionId),
    check('take_positive', sql`${t.takeNo}>0`),
  ],
);

export const takeReviewEvents = sqliteTable(
  'take_review_events',
  {
    id: text('id').primaryKey(),
    takeId: text('take_id').notNull(),
    shotId: text('shot_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    mediaVersionId: text('media_version_id').notNull(),
    version: integer('version').notNull(),
    action: text('action', { enum: ['submit', 'withdraw', 'approve', 'reject', 'revoke'] }).notNull(),
    shotVersion: integer('shot_version').notNull(),
    projectVersion: integer('project_version').notNull(),
    promptId: text('prompt_id').references(() => promptArtifacts.id),
    generationJobId: text('generation_job_id').references(() => generationJobs.id),
    reason: text('reason').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    requestKey: text('request_key').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.takeId, t.shotId, t.projectId, t.workspaceId, t.mediaVersionId],
      foreignColumns: [takes.id, takes.shotId, takes.projectId, takes.workspaceId, takes.mediaVersionId],
    }),
    uniqueIndex('take_review_version').on(t.takeId, t.version),
    uniqueIndex('take_review_request').on(t.takeId, t.actorId, t.requestKey),
    uniqueIndex('take_review_selection_scope').on(t.id, t.takeId, t.shotId, t.projectId, t.workspaceId),
    check('take_review_action', sql`${t.action} IN ('submit','withdraw','approve','reject','revoke')`),
    check(
      'take_review_version_positive',
      sql`${t.version}>0 AND ${t.shotVersion}>0 AND ${t.projectVersion}>0`,
    ),
    check('take_review_reason', sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`),
  ],
);

export const shotTakeSelections = sqliteTable(
  'shot_take_selections',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    takeId: text('take_id'),
    approvalId: text('approval_id'),
    reason: text('reason').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    requestKey: text('request_key').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [shots.id, shots.projectId, shots.workspaceId],
    }),
    foreignKey({
      columns: [t.approvalId, t.takeId, t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [
        takeReviewEvents.id,
        takeReviewEvents.takeId,
        takeReviewEvents.shotId,
        takeReviewEvents.projectId,
        takeReviewEvents.workspaceId,
      ],
    }),
    uniqueIndex('shot_selection_version').on(t.shotId, t.version),
    uniqueIndex('shot_selection_request').on(t.shotId, t.actorId, t.requestKey),
    check(
      'shot_selection_pair',
      sql`(${t.takeId} IS NULL AND ${t.approvalId} IS NULL) OR (${t.takeId} IS NOT NULL AND ${t.approvalId} IS NOT NULL)`,
    ),
    check('shot_selection_version_positive', sql`${t.version}>0`),
    check('shot_selection_reason', sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`),
  ],
);

export const assetEntities = sqliteTable(
  'asset_entities',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    kind: text('kind', { enum: ['character', 'environment', 'prop', 'voice'] }).notNull(),
    version: integer('version').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    creationKey: text('creation_key').notNull(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    uniqueIndex('entity_scope').on(t.id, t.projectId, t.workspaceId),
    uniqueIndex('entity_create_key').on(t.projectId, t.createdBy, t.creationKey),
    index('entity_page').on(t.projectId, t.kind, t.createdAt, t.id),
    check('entity_version_positive', sql`${t.version}>0`),
  ],
);
export const assetEntityRevisions = sqliteTable(
  'asset_entity_revisions',
  {
    id: text('id').primaryKey(),
    entityId: text('entity_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    attributesJson: text('attributes_json').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.entityId, t.projectId, t.workspaceId],
      foreignColumns: [assetEntities.id, assetEntities.projectId, assetEntities.workspaceId],
    }),
    uniqueIndex('entity_revision_number').on(t.entityId, t.version),
    uniqueIndex('entity_revision_scope').on(t.id, t.projectId, t.workspaceId),
    uniqueIndex('entity_revision_key').on(t.entityId, t.idempotencyKey),
    check('entity_revision_positive', sql`${t.version}>0`),
  ],
);
export const entityMediaBindings = sqliteTable(
  'entity_media_bindings',
  {
    revisionId: text('revision_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    mediaVersionId: text('media_version_id').notNull(),
    role: text('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.role, t.mediaVersionId] }),
    foreignKey({
      columns: [t.revisionId, t.projectId, t.workspaceId],
      foreignColumns: [
        assetEntityRevisions.id,
        assetEntityRevisions.projectId,
        assetEntityRevisions.workspaceId,
      ],
    }),
    foreignKey({
      columns: [t.mediaVersionId, t.projectId, t.workspaceId],
      foreignColumns: [mediaVersions.id, mediaVersions.projectId, mediaVersions.workspaceId],
    }),
    index('entity_media_lookup').on(t.mediaVersionId, t.role),
  ],
);
export const assetRevisionDecisions = sqliteTable(
  'asset_revision_decisions',
  {
    id: text('id').primaryKey(),
    revisionId: text('revision_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    action: text('action', { enum: ['approve', 'revoke'] }).notNull(),
    reason: text('reason').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    requestKey: text('request_key').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.revisionId, t.projectId, t.workspaceId],
      foreignColumns: [
        assetEntityRevisions.id,
        assetEntityRevisions.projectId,
        assetEntityRevisions.workspaceId,
      ],
    }),
    uniqueIndex('asset_decision_version').on(t.revisionId, t.version),
    uniqueIndex('asset_decision_request').on(t.revisionId, t.actorId, t.requestKey),
    check('asset_decision_action', sql`${t.action} IN ('approve', 'revoke')`),
    check('asset_decision_reason', sql`length(trim(${t.reason})) BETWEEN 1 AND 1000`),
  ],
);

export const shotAssetBindings = sqliteTable(
  'shot_asset_bindings',
  {
    id: text('id').primaryKey(),
    shotId: text('shot_id').notNull(),
    cardVersion: integer('card_version').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    revisionId: text('revision_id').notNull(),
    purpose: text('purpose').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [shots.id, shots.projectId, shots.workspaceId],
    }),
    foreignKey({
      columns: [t.revisionId, t.projectId, t.workspaceId],
      foreignColumns: [
        assetEntityRevisions.id,
        assetEntityRevisions.projectId,
        assetEntityRevisions.workspaceId,
      ],
    }),
    uniqueIndex('shot_asset_revision').on(t.shotId, t.cardVersion, t.revisionId),
    index('shot_asset_impact').on(t.revisionId, t.id),
  ],
);

export const generationConnections = sqliteTable(
  'generation_connections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    name: text('name').notNull(),
    baseUrl: text('base_url').notNull(),
    trustedPrivate: integer('trusted_private', { mode: 'boolean' }).notNull(),
    encryptedSecret: text('encrypted_secret'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    version: integer('version').notNull().default(1),
    poolEnabled: integer('pool_enabled', { mode: 'boolean' }).notNull().default(false),
    poolVersion: integer('pool_version').notNull().default(1),
    maxRunning: integer('max_running').notNull().default(1),
    maxPending: integer('max_pending').notNull().default(2),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('generation_connection_scope').on(t.id, t.workspaceId),
    uniqueIndex('generation_pool_endpoint')
      .on(t.workspaceId, t.baseUrl)
      .where(sql`${t.poolEnabled} = 1`),
  ],
);

export const timelineRevisions = sqliteTable(
  'timeline_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    durationMs: integer('duration_ms').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    uniqueIndex('timeline_version').on(t.projectId, t.version),
    uniqueIndex('timeline_request').on(t.projectId, t.createdBy, t.requestKey),
    uniqueIndex('timeline_scope').on(t.id, t.projectId, t.workspaceId),
    check(
      'timeline_limits',
      sql`${t.version}>0 AND ${t.durationMs} BETWEEN 40 AND 300000 AND length(CAST(${t.snapshotJson} AS BLOB))<=4194304`,
    ),
  ],
);
export const animaticJobs = sqliteTable(
  'animatic_jobs',
  {
    id: text('id').primaryKey(),
    timelineId: text('timeline_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    requestKey: text('request_key').notNull(),
    state: text('state', {
      enum: ['queued', 'rendering', 'archiving', 'completed', 'failed', 'canceled'],
    }).notNull(),
    leaseId: text('lease_id'),
    leaseUntil: integer('lease_until'),
    nextAt: integer('next_at').notNull(),
    mediaVersionId: text('media_version_id').references(() => mediaVersions.id),
    errorCode: text('error_code'),
  },
  (t) => [
    foreignKey({
      columns: [t.timelineId, t.projectId, t.workspaceId],
      foreignColumns: [timelineRevisions.id, timelineRevisions.projectId, timelineRevisions.workspaceId],
    }),
    uniqueIndex('animatic_request').on(t.projectId, t.createdBy, t.requestKey),
    index('animatic_queue').on(t.state, t.nextAt, t.leaseUntil),
    index('animatic_history').on(t.timelineId, t.createdAt, t.id),
    check('animatic_completion', sql`${t.state}<>'completed' OR ${t.mediaVersionId} IS NOT NULL`),
  ],
);

export const generationWorkflows = sqliteTable(
  'generation_workflows',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    projectId: text('project_id').notNull(),
    connectionId: text('connection_id').notNull(),
    name: text('name').notNull(),
    capability: text('capability', {
      enum: ['image.text_to_image', 'video.text_to_video', 'video.image_to_video'],
    }).notNull(),
    definitionJson: text('definition_json').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    foreignKey({
      columns: [t.connectionId, t.workspaceId],
      foreignColumns: [generationConnections.id, generationConnections.workspaceId],
    }),
    uniqueIndex('generation_workflow_scope').on(t.id, t.projectId, t.workspaceId),
    index('generation_workflow_project').on(t.projectId, t.createdAt),
  ],
);

export const generationInstanceChecks = sqliteTable(
  'generation_instance_checks',
  {
    workflowId: text('workflow_id').notNull(),
    connectionId: text('connection_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    connectionVersion: integer('connection_version').notNull(),
    poolVersion: integer('pool_version').notNull(),
    checkedAt: integer('checked_at').notNull(),
    reachable: integer('reachable', { mode: 'boolean' }).notNull(),
    running: integer('running'),
    pending: integer('pending'),
    status: text('status', { enum: ['compatible', 'incompatible', 'unverified'] }).notNull(),
    binding: text('binding', { enum: ['passed', 'failed', 'unverified'] }).notNull(),
    reportJson: text('report_json'),
  },
  (t) => [
    primaryKey({ columns: [t.workflowId, t.connectionId] }),
    foreignKey({
      columns: [t.workflowId, t.projectId, t.workspaceId],
      foreignColumns: [
        generationWorkflows.id,
        generationWorkflows.projectId,
        generationWorkflows.workspaceId,
      ],
    }),
    foreignKey({
      columns: [t.connectionId, t.workspaceId],
      foreignColumns: [generationConnections.id, generationConnections.workspaceId],
    }),
    check(
      'generation_instance_check_counts',
      sql`(${t.running} IS NULL AND ${t.pending} IS NULL) OR (${t.running} IS NOT NULL AND ${t.pending} IS NOT NULL AND ${t.running}>=0 AND ${t.pending}>=0)`,
    ),
  ],
);

export const workflowCatalogs = sqliteTable(
  'workflow_catalogs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    headWorkflowId: text('head_workflow_id'),
    revision: integer('revision').notNull(),
    version: integer('version').notNull(),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    foreignKey({
      columns: [t.headWorkflowId, t.projectId, t.workspaceId],
      foreignColumns: [
        generationWorkflows.id,
        generationWorkflows.projectId,
        generationWorkflows.workspaceId,
      ],
    }),
    uniqueIndex('workflow_catalog_scope').on(t.id, t.projectId, t.workspaceId),
    check('workflow_catalog_versions', sql`${t.revision}>=0 AND ${t.version}>=0`),
  ],
);
export const workflowCatalogRevisions = sqliteTable(
  'workflow_catalog_revisions',
  {
    workflowId: text('workflow_id').primaryKey(),
    familyId: text('family_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    revision: integer('revision').notNull(),
    summary: text('summary').notNull(),
    restoredFromId: text('restored_from_id').references(() => generationWorkflows.id),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    requestKey: text('request_key'),
    requestHash: text('request_hash'),
  },
  (t) => [
    foreignKey({
      columns: [t.workflowId, t.projectId, t.workspaceId],
      foreignColumns: [
        generationWorkflows.id,
        generationWorkflows.projectId,
        generationWorkflows.workspaceId,
      ],
    }),
    foreignKey({
      columns: [t.familyId, t.projectId, t.workspaceId],
      foreignColumns: [workflowCatalogs.id, workflowCatalogs.projectId, workflowCatalogs.workspaceId],
    }),
    uniqueIndex('workflow_catalog_revision').on(t.familyId, t.revision),
    uniqueIndex('workflow_catalog_request').on(t.projectId, t.createdBy, t.requestKey),
    check('workflow_revision_positive', sql`${t.revision}>0 AND length(${t.summary})<=1000`),
  ],
);

export const generationStates = [
  'queued',
  'preparing',
  'submitting',
  'submitted',
  'fetching',
  'completed',
  'test_completed',
  'needs_reconciliation',
  'failed',
  'canceled',
] as const;
export const generationJobs = sqliteTable(
  'generation_jobs',
  {
    id: text('id').primaryKey(),
    purpose: text('purpose', { enum: ['production', 'workflow_test'] })
      .notNull()
      .default('production'),
    shotId: text('shot_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    workflowId: text('workflow_id').notNull(),
    promptId: text('prompt_id')
      .notNull()
      .references(() => promptArtifacts.id),
    shotVersion: integer('shot_version').notNull(),
    projectVersion: integer('project_version').notNull(),
    connectionVersion: integer('connection_version').notNull(),
    creatorId: text('creator_id')
      .notNull()
      .references(() => users.id),
    requestKey: text('request_key').notNull(),
    snapshotJson: text('snapshot_json').notNull(),
    state: text('state', { enum: generationStates }).notNull(),
    remoteId: text('remote_id'),
    resultJson: text('result_json'),
    mediaVersionId: text('media_version_id').references(() => mediaVersions.id),
    takeId: text('take_id').references(() => takes.id),
    leaseId: text('lease_id'),
    leaseUntil: integer('lease_until'),
    nextAt: integer('next_at').notNull(),
    deadline: integer('deadline'),
    errorCode: text('error_code'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.shotId, t.projectId, t.workspaceId],
      foreignColumns: [shots.id, shots.projectId, shots.workspaceId],
    }),
    foreignKey({
      columns: [t.workflowId, t.projectId, t.workspaceId],
      foreignColumns: [
        generationWorkflows.id,
        generationWorkflows.projectId,
        generationWorkflows.workspaceId,
      ],
    }),
    uniqueIndex('generation_job_request').on(t.shotId, t.creatorId, t.requestKey),
    index('generation_job_schedule').on(t.state, t.nextAt, t.leaseUntil),
    index('generation_job_shot').on(t.shotId, t.createdAt, t.id),
    check(
      'generation_job_complete',
      sql`${t.state} <> 'completed' OR (${t.mediaVersionId} IS NOT NULL AND ${t.takeId} IS NOT NULL)`,
    ),
  ],
);

export const workflowReleaseEvents = sqliteTable(
  'workflow_release_events',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => workflowCatalogs.id),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflowCatalogRevisions.workflowId),
    sequence: integer('sequence').notNull(),
    action: text('action', { enum: ['publish', 'revoke'] }).notNull(),
    testJobId: text('test_job_id')
      .notNull()
      .references(() => generationJobs.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('workflow_release_sequence').on(t.familyId, t.sequence),
    uniqueIndex('workflow_release_request').on(t.familyId, t.actorId, t.requestKey),
    check(
      'workflow_release_valid',
      sql`${t.sequence}>0 AND ${t.action} IN ('publish','revoke') AND length(${t.reason}) BETWEEN 1 AND 1000`,
    ),
  ],
);

export const boards = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    unitId: text('unit_id'),
    title: text('title').notNull(),
    version: integer('version').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    creationKey: text('creation_key').notNull(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.projectId, t.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }),
    foreignKey({
      columns: [t.unitId, t.projectId, t.workspaceId],
      foreignColumns: [episodes.id, episodes.projectId, episodes.workspaceId],
    }),
    uniqueIndex('board_scope').on(t.id, t.projectId, t.workspaceId),
    uniqueIndex('board_create_key').on(t.projectId, t.createdBy, t.creationKey),
    index('board_project_page').on(t.projectId, t.createdAt, t.id),
    check('board_version', sql`${t.version}>=0`),
    check('board_title', sql`length(${t.title}) BETWEEN 1 AND 100`),
  ],
);
export const boardRevisions = sqliteTable(
  'board_revisions',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id').notNull(),
    projectId: text('project_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    schemaVersion: text('schema_version').notNull(),
    layoutJson: text('layout_json').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
    requestKey: text('request_key').notNull(),
    requestHash: text('request_hash').notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.boardId, t.projectId, t.workspaceId],
      foreignColumns: [boards.id, boards.projectId, boards.workspaceId],
    }),
    uniqueIndex('board_revision_version').on(t.boardId, t.version),
    uniqueIndex('board_revision_request').on(t.boardId, t.createdBy, t.requestKey),
    check(
      'board_revision_limits',
      sql`${t.version}>0 AND ${t.schemaVersion}='studio.board.v1' AND length(CAST(${t.layoutJson} AS BLOB))<=262144 AND json_valid(${t.layoutJson})`,
    ),
  ],
);
