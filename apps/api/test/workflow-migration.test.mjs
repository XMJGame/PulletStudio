import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applyMigrations } from '../dist/db/apply-migrations.js';
import { DatabaseService } from '../dist/db/database.service.js';
import { fixtureWorkflow } from '../../../tests/fixtures/comfy-mock.mjs';
for (const migrationCount of [35, 39])
  test(`legacy ${migrationCount} upgrade preserves data and generation references`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pullet-workflow-upgrade-')),
      source = fileURLToPath(new URL('../drizzle', import.meta.url));
    const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8'));
    const folder = join(directory, 'old');
    await mkdir(join(folder, 'meta'), { recursive: true });
    const old = { ...journal, entries: journal.entries.filter((entry) => entry.idx < migrationCount) };
    await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(old));
    for (const entry of old.entries)
      await copyFile(join(source, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
    let legacy, next;
    try {
      const path = join(directory, 'studio.sqlite');
      legacy = new Database(path);
      legacy.pragma('foreign_keys=ON');
      applyMigrations(legacy, folder);
      const owner = randomUUID(),
        workspace = randomUUID(),
        project = randomUUID(),
        connection = randomUUID(),
        workflow = randomUUID(),
        now = new Date().toISOString(),
        definition = JSON.stringify(fixtureWorkflow(connection));
      legacy
        .prepare('INSERT INTO users (id,email,name,password_hash,created_at) VALUES (?,?,?,?,?)')
        .run(owner, 'old@test.local', 'Old owner', 'fixture', now);
      legacy
        .prepare('INSERT INTO workspaces (id,name,slug,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(workspace, 'Old workspace', 'old', owner, now);
      legacy
        .prepare(
          'INSERT INTO projects (id,workspace_id,code,title,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        )
        .run(project, workspace, 'FILM01', 'Old project', now, now);
      legacy
        .prepare(
          'INSERT INTO generation_connections (id,workspace_id,name,base_url,trusted_private,created_at) VALUES (?,?,?,?,?,?)',
        )
        .run(connection, workspace, 'Old connection', 'http://127.0.0.1:1', 1, now);
      legacy
        .prepare(
          'INSERT INTO generation_workflows (id,workspace_id,project_id,connection_id,name,capability,definition_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .run(
          workflow,
          workspace,
          project,
          connection,
          'Old immutable definition',
          'image.text_to_image',
          definition,
          owner,
          now,
        );
      const episode = randomUUID(),
        shot = randomUUID(),
        prompt = randomUUID(),
        job = randomUUID(),
        card = randomUUID();
      legacy
        .prepare(
          'INSERT INTO episodes (id,workspace_id,project_id,code,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(episode, workspace, project, 'EP01', 'Old episode', now, now);
      legacy
        .prepare(
          'INSERT INTO shots (id,workspace_id,project_id,episode_id,code,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        )
        .run(shot, workspace, project, episode, 'SH001', now, now);
      legacy
        .prepare(
          'INSERT INTO shot_card_editions (id,shot_id,project_id,workspace_id,version,body_json,created_by,summary,created_at) VALUES (?,?,?,?,1,?,?,?,?)',
        )
        .run(card, shot, project, workspace, '{}', owner, 'Old card', now);
      legacy
        .prepare(
          'INSERT INTO prompt_artifacts (id,shot_id,project_id,workspace_id,card_id,card_version,project_version,compiler_version,snapshot_json,rendered_json,created_by,created_at) VALUES (?,?,?,?,?,1,1,?,?,?,?,?)',
        )
        .run(prompt, shot, project, workspace, card, 'old', '{}', '{"positivePrompt":"legacy"}', owner, now);
      legacy
        .prepare(
          "INSERT INTO generation_jobs (id,shot_id,project_id,workspace_id,workflow_id,prompt_id,shot_version,project_version,connection_version,creator_id,request_key,snapshot_json,state,next_at,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,1,?,?,?,'queued',0,?,?)",
        )
        .run(
          job,
          shot,
          project,
          workspace,
          workflow,
          prompt,
          owner,
          randomUUID(),
          '{"graph":{},"approvals":[]}',
          now,
          now,
        );
      if (migrationCount === 39) {
        legacy.prepare('UPDATE generation_connections SET pool_enabled=1 WHERE id=?').run(connection);
        legacy
          .prepare(
            "INSERT INTO generation_instance_checks (workflow_id,connection_id,project_id,workspace_id,connection_version,pool_version,checked_at,reachable,status,binding) VALUES (?,?,?,?,1,1,123,1,'compatible','passed')",
          )
          .run(workflow, connection, project, workspace);
        legacy
          .prepare(
            "INSERT INTO generation_job_routes (job_id,connection_id,workspace_id,instance_name,mode,pool_version,checked_at) VALUES (?,?,?,?,'auto',1,123)",
          )
          .run(job, connection, workspace, 'Old connection');
      }
      const storage = randomUUID(),
        asset = randomUUID(),
        media = randomUUID(),
        take = randomUUID(),
        completedJob = randomUUID();
      legacy
        .prepare('INSERT INTO storage_connections (id,kind,created_at) VALUES (?,?,?)')
        .run(storage, 'local', now);
      legacy
        .prepare(
          'INSERT INTO media_assets (id,project_id,workspace_id,name,version,created_by,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?)',
        )
        .run(asset, project, workspace, 'Old result', owner, now, now);
      legacy
        .prepare(
          'INSERT INTO media_versions (id,asset_id,project_id,workspace_id,version,storage_id,object_key,file_name,media_type,mime,byte_length,sha256,metadata_json,origin,created_by,created_at) VALUES (?,?,?,?,1,?,?,?,?,?,1,?,?,?,?,?)',
        )
        .run(
          media,
          asset,
          project,
          workspace,
          storage,
          'fixture/original.bin',
          'old.png',
          'image',
          'image/png',
          '0'.repeat(64),
          '{}',
          'generation',
          owner,
          now,
        );
      legacy
        .prepare(
          'INSERT INTO takes (id,shot_id,project_id,workspace_id,media_version_id,take_no,created_by,created_at) VALUES (?,?,?,?,?,1,?,?)',
        )
        .run(take, shot, project, workspace, media, owner, now);
      legacy
        .prepare(
          "INSERT INTO generation_jobs (id,shot_id,project_id,workspace_id,workflow_id,prompt_id,shot_version,project_version,connection_version,creator_id,request_key,snapshot_json,state,media_version_id,take_id,next_at,created_at,updated_at) VALUES (?,?,?,?,?,?,1,1,1,?,?,?,'completed',?,?,0,?,?)",
        )
        .run(
          completedJob,
          shot,
          project,
          workspace,
          workflow,
          prompt,
          owner,
          randomUUID(),
          '{"graph":{},"approvals":[]}',
          media,
          take,
          now,
          now,
        );
      const names = legacy
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'__drizzle_migrations'",
        )
        .all()
        .map((row) => row.name);
      const queries = names.map((name) => {
        const columns = legacy.pragma(`table_info("${name}")`).map((column) => `"${column.name}"`);
        return { name, select: `SELECT ${columns.join(', ')} FROM "${name}"` };
      });
      const rows = Object.fromEntries(
        queries.map(({ name, select }) => [name, legacy.prepare(select).all()]),
      );
      const hashes = legacy
        .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at')
        .all();
      legacy.close();
      legacy = undefined;
      next = new DatabaseService({ databasePath: path });
      for (const { name, select } of queries)
        assert.deepEqual(next.sqlite.prepare(select).all(), rows[name], name);
      assert.deepEqual(
        next.sqlite
          .prepare(
            'SELECT pool_enabled,pool_version,max_running,max_pending FROM generation_connections WHERE id=?',
          )
          .get(connection),
        { pool_enabled: migrationCount === 39 ? 1 : 0, pool_version: 1, max_running: 1, max_pending: 2 },
      );
      assert.deepEqual(
        next.sqlite
          .prepare(
            'SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at LIMIT ' + migrationCount,
          )
          .all(),
        hashes,
      );
      if (migrationCount === 35) {
        const adopted = next.sqlite.prepare('SELECT * FROM workflow_catalogs WHERE id=?').get(workflow);
        assert.equal(adopted.head_workflow_id, workflow);
        assert.equal(adopted.version, 1);
        assert.equal(adopted.revision, 1);
        assert.equal(adopted.archived, 0);
        assert.equal(
          next.sqlite
            .prepare('SELECT family_id FROM workflow_catalog_revisions WHERE workflow_id=?')
            .get(workflow).family_id,
          workflow,
        );
      }
      assert.equal(
        next.sqlite.prepare('SELECT board_id FROM generation_jobs WHERE id=?').get(job).board_id,
        null,
      );
      assert.throws(
        () => next.sqlite.prepare('UPDATE generation_jobs SET shot_id=NULL WHERE id=?').run(job),
        /immutable/,
      );
      if (migrationCount === 39)
        assert.throws(
          () => next.sqlite.prepare("UPDATE generation_jobs SET lease_id='old-worker' WHERE id=?").run(job),
          /updated.*worker/,
        );
      assert.equal(
        next.sqlite.prepare('SELECT in_library FROM media_assets WHERE id=?').get(asset).in_library,
        1,
      );
      assert.throws(
        () => next.sqlite.prepare("UPDATE generation_jobs SET state='queued' WHERE id=?").run(completedJob),
        /immutable/,
      );
      assert.equal(next.sqlite.pragma('integrity_check', { simple: true }), 'ok');
      assert.deepEqual(next.sqlite.pragma('foreign_key_check'), []);
    } finally {
      if (legacy?.open) legacy.close();
      next?.onModuleDestroy();
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      await rm(directory, { recursive: true, force: true });
    }
  });
