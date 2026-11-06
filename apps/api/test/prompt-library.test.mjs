import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { startComfyMock, fixtureWorkflow } from '../../../tests/fixtures/comfy-mock.mjs';
test('project prompt library isolates immutable text and reusable generation sources', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-prompt-library-'));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.COOKIE_SECURE = 'false';
  process.env.SETUP_TOKEN = 'isolated-prompt-library-setup-2026';
  process.env.PROVIDER_MASTER_KEY = 'b'.repeat(64);
  const { createApplication } = await import('../dist/application.js'),
    { DatabaseService } = await import('../dist/db/database.service.js');
  let app, base, remote, project, workspace, saved;
  const db = () => app.get(DatabaseService).sqlite;
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  function client() {
    let cookie = '',
      csrf = '';
    return async (method, path, body, key) => {
      const response = await fetch(base + '/api/v1' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Request': '1',
          'X-CSRF-Token': csrf,
          Cookie: cookie,
          'Idempotency-Key': key ?? randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.getSetCookie().length)
        cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  }
  const owner = client(),
    reader = client(),
    editor = client(),
    outside = client(),
    body = {
      title: 'Station light 100%',
      positivePrompt: 'A station under soft blue light',
      negativePrompt: 'no lettering',
      source: 'External notes',
      tags: ['scene', 'night'],
      workflowId: null,
    };
  let readerId, editorId;
  const create = (input = body, key = randomUUID(), actor = owner) =>
    actor('POST', `/projects/${project.id}/prompt-library`, input, key);
  const revise = (input, version, key = randomUUID(), actor = owner) =>
    actor('POST', `/prompt-library/${saved.entryId}/revisions`, { ...input, expectedVersion: version }, key);
  try {
    remote = await startComfyMock({});
    await start();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@prompts.test',
        password: 'Studio8!',
        name: 'Creator',
        workspaceName: 'Prompt studio',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Prompt studies' })).data;
    for (const [actor, name, role] of [
      [reader, 'Reader', 'VIEWER'],
      [editor, 'Editor', 'EDITOR'],
      [outside, 'Outside', null],
    ]) {
      const invite = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: `${name}@prompts.test` })
      ).data;
      const user = (
        await actor('POST', '/invitations/accept', { token: invite.token, name, password: 'Studio8!' })
      ).data.user;
      if (role) await owner('POST', `/projects/${project.id}/members`, { userId: user.id, role });
      if (actor === reader) readerId = user.id;
      if (actor === editor) editorId = user.id;
    }
    await t.test(
      'text saves without a Shot and request replay stays fixed after later revisions',
      async () => {
        const key = randomUUID(),
          result = await create(body, key);
        assert.equal(result.status, 201, JSON.stringify(result.data));
        saved = result.data;
        assert.deepEqual((await create(body, key)).data, saved);
        assert.equal((await create({ ...body, title: 'Other' }, key)).status, 409);
        assert.equal((await create({ ...body, positivePrompt: ' ' })).status, 400);
        assert.equal((await create({ ...body, tags: ['x'.repeat(41)] })).status, 400);
        assert.equal(db().prepare('SELECT count(*) n FROM shots WHERE project_id=?').get(project.id).n, 0);
        const edit = await revise({ ...body, positivePrompt: 'A station at dawn' }, 1);
        assert.equal(edit.status, 201, JSON.stringify(edit.data));
        assert.equal(edit.data.revision.version, 2);
        assert.deepEqual((await create(body, key)).data, saved);
        assert.equal(
          (await owner('GET', `/prompt-library/${saved.entryId}/revisions/1`)).data.revision.positivePrompt,
          body.positivePrompt,
        );
      },
    );
    await t.test(
      'CAS rejects stale edits and failed auditing rolls back head and revision together',
      async () => {
        const result = await revise({ ...body, title: 'Latest title' }, 2, randomUUID(), editor);
        assert.equal(result.status, 201);
        assert.equal((await revise({ ...body, title: 'Stale input' }, 2)).status, 409);
        db().exec(
          "CREATE TRIGGER fail_prompt_audit BEFORE INSERT ON audit_events WHEN NEW.action='prompt-library.revise' BEGIN SELECT RAISE(ABORT,'fixture'); END",
        );
        assert.equal((await revise({ ...body, title: 'Must rollback' }, 3)).status, 409);
        db().exec('DROP TRIGGER fail_prompt_audit');
        assert.equal((await owner('GET', `/prompt-library/${saved.entryId}`)).data.currentVersion, 3);
        assert.equal(
          db().prepare('SELECT count(*) n FROM prompt_library_revisions WHERE entry_id=?').get(saved.entryId)
            .n,
          3,
        );
        assert.throws(
          () =>
            db()
              .prepare("UPDATE prompt_library_revisions SET title='tamper' WHERE id=?")
              .run(saved.revision.id),
          /immutable/,
        );
        assert.throws(
          () => db().prepare('DELETE FROM prompt_library_revisions WHERE id=?').run(saved.revision.id),
          /history/,
        );
        assert.throws(
          () => db().prepare('UPDATE prompt_library_entries SET version=99 WHERE id=?').run(saved.entryId),
          /transition/,
        );
      },
    );
    await t.test(
      'readers can copy text but cannot mutate and project scope never implies sharing',
      async () => {
        assert.equal((await reader('GET', `/prompt-library/${saved.entryId}`)).data.canEdit, false);
        assert.equal((await create(body, randomUUID(), reader)).status, 403);
        assert.equal((await revise(body, 3, randomUUID(), reader)).status, 403);
        for (const path of [
          `/projects/${project.id}/prompt-library`,
          `/prompt-library/${saved.entryId}`,
          `/prompt-library/${saved.entryId}/revisions`,
          `/prompt-library-revisions/${saved.revision.id}`,
        ])
          assert.equal((await outside('GET', path)).status, 404);
        const foreign = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Private project' })
        ).data;
        const connection = (
          await owner('POST', `/projects/${foreign.id}/generation-connections`, {
            name: 'Fixture',
            baseUrl: remote.baseUrl,
            trustedPrivate: true,
          })
        ).data;
        const foreignWorkflow = (
          await owner('POST', `/projects/${foreign.id}/generation-workflows`, fixtureWorkflow(connection.id))
        ).data;
        assert.equal((await create({ ...body, workflowId: foreignWorkflow.id })).status, 404);
        const workflow = (
          await owner('POST', `/projects/${project.id}/generation-workflows`, fixtureWorkflow(connection.id))
        ).data;
        const jobInput = {
          workflowId: workflow.id,
          positivePrompt: body.positivePrompt,
          negativePrompt: body.negativePrompt,
          promptLibraryRevisionId: saved.revision.id,
          confirmed: true,
        };
        let job = await owner('POST', `/projects/${project.id}/generation-jobs`, jobInput);
        assert.equal(job.status, 201, JSON.stringify(job.data));
        assert.equal(job.data.promptLibrary.revisionId, saved.revision.id);
        assert.equal(job.data.shotId, null);
        assert.equal(
          (
            await owner('POST', `/projects/${project.id}/generation-jobs`, {
              ...jobInput,
              positivePrompt: 'Changed without clearing reference',
            })
          ).status,
          409,
        );
        const foreignPrompt = (await owner('POST', `/projects/${foreign.id}/prompt-library`, body)).data;
        assert.equal(
          (
            await owner('POST', `/projects/${project.id}/generation-jobs`, {
              ...jobInput,
              promptLibraryRevisionId: foreignPrompt.revision.id,
            })
          ).status,
          404,
        );
        const key = randomUUID(),
          queued = await owner('POST', `/projects/${project.id}/generation-jobs`, jobInput, key);
        assert.equal(
          (
            await owner(
              'POST',
              `/projects/${project.id}/generation-jobs`,
              { ...jobInput, promptLibraryRevisionId: undefined },
              key,
            )
          ).status,
          409,
        );
        await revise({ ...body, positivePrompt: 'Newest text' }, 3);
        job = await owner('GET', `/generation-jobs/${queued.data.id}`);
        assert.equal(job.data.prompt.positivePrompt, body.positivePrompt);
        assert.equal(job.data.promptLibrary.version, 1);
        assert.equal(
          JSON.parse(
            db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(job.data.id)
              .snapshot_json,
          ).graph['1'].inputs.text,
          body.positivePrompt,
        );
      },
    );
    await t.test('notes retain full prompts and reject foreign or forged library provenance', async () => {
      const long = await create({ ...body, title: 'Long reference', positivePrompt: 'A'.repeat(8000) });
      assert.equal(long.status, 201);
      const board = (await owner('POST', `/projects/${project.id}/boards`, { title: 'Prompt board' })).data;
      const node = {
        id: randomUUID(),
        type: 'note',
        position: { x: 0, y: 0 },
        width: 250,
        height: 280,
        data: {
          text: long.data.revision.positivePrompt,
          prompt: {
            negativePrompt: body.negativePrompt,
            source: body.source,
            promptLibraryRevisionId: long.data.revision.id,
          },
        },
      };
      const input = { title: board.title, expectedRevision: 1, layout: { ...board.layout, nodes: [node] } };
      const savedBoard = await owner('POST', `/boards/${board.id}/revisions`, input);
      assert.equal(savedBoard.status, 201, JSON.stringify(savedBoard.data));
      assert.equal(savedBoard.data.layout.nodes[0].data.text.length, 8000);
      const corrupt = structuredClone(input);
      corrupt.expectedRevision = 2;
      corrupt.layout.nodes[0].data.text = 'changed';
      assert.equal((await owner('POST', `/boards/${board.id}/revisions`, corrupt)).status, 409);
      corrupt.layout.nodes[0].data.prompt.promptLibraryRevisionId = randomUUID();
      assert.equal((await owner('POST', `/boards/${board.id}/revisions`, corrupt)).status, 404);
      delete corrupt.layout.nodes[0].data.prompt.promptLibraryRevisionId;
      assert.equal((await owner('POST', `/boards/${board.id}/revisions`, corrupt)).status, 201);
    });
    await t.test(
      'search treats special characters literally and both lists paginate without duplicates',
      async () => {
        await create({ ...body, title: 'Literal 100% result' });
        for (let n = 0; n < 22; n++)
          assert.equal((await create({ ...body, title: `Library item ${n}`, tags: ['batch'] })).status, 201);
        const first = (await owner('GET', `/projects/${project.id}/prompt-library?tag=batch`)).data;
        assert.equal(first.items.length, 20);
        assert.equal(first.items[0].positivePrompt, undefined);
        assert.ok(first.items[0].preview);
        const next = (
          await owner('GET', `/projects/${project.id}/prompt-library?tag=batch&cursor=${first.nextCursor}`)
        ).data;
        assert.equal(next.items.length, 2);
        assert.equal(new Set([...first.items, ...next.items].map((row) => row.id)).size, 22);
        const search = (await owner('GET', `/projects/${project.id}/prompt-library?q=Literal%20100%25`)).data;
        assert.equal(search.items.length, 1);
        assert.equal(
          (await owner('GET', `/projects/${project.id}/prompt-library?cursor=${randomUUID()}`)).status,
          400,
        );
        for (let n = 4; n < 25; n++)
          assert.equal((await revise({ ...body, title: `Text revision ${n + 1}` }, n)).status, 201);
        const h = (await owner('GET', `/prompt-library/${saved.entryId}/revisions`)).data;
        assert.equal(h.items.length, 20);
        const h2 = (await owner('GET', `/prompt-library/${saved.entryId}/revisions?before=${h.nextCursor}`))
          .data;
        assert.equal(new Set([...h.items, ...h2.items].map((row) => row.version)).size, 25);
      },
    );
    await t.test(
      'restart and backup preserve immutable text while membership and trash revoke access',
      async () => {
        await app.close();
        await start();
        assert.equal(
          (await owner('GET', `/prompt-library/${saved.entryId}/revisions/1`)).data.revision.positivePrompt,
          body.positivePrompt,
        );
        const { backupDatabase } = await import('../dist/db/backup.js'),
          backup = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backup')),
          restored = new DatabaseService({ databasePath: backup });
        try {
          for (const table of ['prompt_library_entries', 'prompt_library_revisions'])
            assert.deepEqual(
              restored.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
              db().prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
            );
          assert.deepEqual(restored.sqlite.pragma('foreign_key_check'), []);
        } finally {
          restored.onModuleDestroy();
        }
        await owner('DELETE', `/projects/${project.id}/members/${editorId}`, { expectedRole: 'EDITOR' });
        assert.equal((await editor('GET', `/prompt-library/${saved.entryId}`)).status, 404);
        await owner('POST', `/projects/${project.id}/trash`, { expectedVersion: project.version });
        assert.equal((await owner('GET', `/prompt-library/${saved.entryId}`)).status, 404);
        assert.equal((await reader('GET', `/prompt-library-revisions/${saved.revision.id}`)).status, 404);
      },
    );
  } finally {
    await app?.close();
    await remote?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
