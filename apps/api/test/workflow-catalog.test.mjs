import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import {
  startComfyMock,
  fixtureWorkflow,
  fixtureCreativeFields,
  fixtureI2V,
} from '../../../tests/fixtures/comfy-mock.mjs';
test('workflow catalog revisions, creative schemas and dependency inspection preserve generation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-workflow-catalog-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'isolated-workflow-catalog-setup-2026';
  process.env.COOKIE_SECURE = 'false';
  process.env.PROVIDER_MASTER_KEY = '5'.repeat(64);
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { AppConfig } = await import('../dist/config.js');
  const { GenerationWorker } = await import('../dist/generation/generation-worker.js');
  let app, base, remote, workspace, project, connection, definition, saved, shot, prompt, completed;
  const db = () => app.get(DatabaseService).sqlite;
  function client() {
    let cookies = '',
      csrf = '';
    return async (method, path, body, headers = {}) => {
      const result = await fetch(base + '/api/v1' + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Request': '1',
          'X-CSRF-Token': csrf,
          Cookie: cookies,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (result.headers.getSetCookie().length)
        cookies = result.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
      const data = result.headers.get('content-type')?.includes('application/json')
        ? await result.json()
        : Buffer.from(await result.arrayBuffer());
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: result.status, data };
    };
  }
  const owner = client(),
    reviewer = client(),
    reader = client(),
    outsider = client();
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  const create = (body, key = randomUUID(), actor = owner) =>
    actor('POST', `/projects/${project.id}/generation-workflows`, body, { 'Idempotency-Key': key });
  const read = async (id) => (await owner('GET', `/generation-workflows/${id}/definition`)).data;
  const revise = (body, key = randomUUID(), actor = owner) =>
    actor('POST', `/workflow-catalogs/${saved.familyId}/revisions`, body, { 'Idempotency-Key': key });
  const queue = (workflowId, fieldValues, key = randomUUID(), canvasShotVersion) =>
    owner(
      'POST',
      `/shots/${shot.id}/generation-jobs`,
      {
        workflowId,
        promptId: prompt.id,
        confirmed: true,
        canvasShotVersion,
        ...(fieldValues ? { fieldValues } : {}),
      },
      { 'Idempotency-Key': key },
    );
  try {
    const fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    remote = await startComfyMock({
      'image.png': fixtures['image.png'].bytes,
      'clip.mp4': fixtures['clip.mp4'].bytes,
    });
    await start();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@workflow.test',
        name: 'Creator',
        password: 'Studio8!',
        workspaceName: 'Workflow team',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Station study' })).data;
    for (const [actor, name, role] of [
      [reader, 'Reader', 'VIEWER'],
      [reviewer, 'Reviewer', 'REVIEWER'],
      [outsider, 'Outside', null],
    ]) {
      const invite = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: `${name}@workflow.test` })
      ).data;
      const joined = (
        await actor('POST', '/invitations/accept', { token: invite.token, name, password: 'Studio8!' })
      ).data;
      if (role) await owner('POST', `/projects/${project.id}/members`, { userId: joined.user.id, role });
    }
    connection = (
      await owner('POST', `/projects/${project.id}/generation-connections`, {
        name: 'Private fixture',
        baseUrl: remote.baseUrl,
        token: 'private-fixture-only',
        trustedPrivate: true,
      })
    ).data;
    await t.test(
      'empty project creation reuses jobs and storage without shots, prompts or release approvals',
      async () => {
        const freeProject = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Empty free creation' })
        ).data;
        const freeDefinition = {
          ...fixtureWorkflow(connection.id),
          reviewRequired: true,
          name: 'Unpublished free workflow',
        };
        const freeWorkflow = (
          await owner('POST', `/projects/${freeProject.id}/generation-workflows`, freeDefinition)
        ).data;
        const board = (
          await owner(
            'POST',
            `/projects/${freeProject.id}/boards`,
            { title: 'Free study' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        assert.ok(board.id);
        const path = `/projects/${freeProject.id}/generation-jobs`;
        const body = {
          workflowId: freeWorkflow.id,
          positivePrompt: 'A station under soft morning light',
          negativePrompt: 'text',
          source: 'External writing tool',
          boardId: board.id,
          confirmed: true,
        };
        const key = randomUUID();
        const submit = (input = body, requestKey = key, actor = owner) =>
          actor('POST', path, input, { 'Idempotency-Key': requestKey });
        let job = await submit();
        assert.equal(job.status, 201, JSON.stringify(job.data));
        const id = job.data.id;
        assert.equal(job.data.shotId, null);
        assert.equal(job.data.promptId, null);
        assert.equal(job.data.boardId, board.id);
        assert.equal((await submit()).data.id, id);
        assert.equal((await submit({ ...body, positivePrompt: 'changed' })).status, 409);
        assert.equal((await submit({ ...body, boardId: randomUUID() }, randomUUID())).status, 404);
        assert.equal((await submit({ ...body, positivePrompt: ' ' }, randomUUID())).status, 400);
        const snapshot = JSON.parse(
          db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(id).snapshot_json,
        );
        assert.equal(snapshot.graph['1'].inputs.text, body.positivePrompt);
        assert.equal(snapshot.graph['2'].inputs.text, body.negativePrompt);
        assert.throws(
          () => db().prepare('UPDATE generation_jobs SET board_id=NULL WHERE id=?').run(id),
          /immutable/,
        );
        assert.throws(
          () => db().prepare("UPDATE generation_jobs SET lease_id='old-worker' WHERE id=?").run(id),
          /updated.*worker/,
        );
        for (let n = 0; n < 3; n++) {
          db().prepare('UPDATE generation_jobs SET next_at=0 WHERE id=?').run(id);
          await app.get(GenerationWorker).tick();
        }
        job = await owner('GET', `/generation-jobs/${id}`);
        assert.equal(job.data.state, 'completed', JSON.stringify(job.data));
        assert.equal(job.data.takeId, null);
        assert.equal(job.data.inLibrary, false);
        assert.equal((await owner('GET', `/projects/${freeProject.id}/media-assets`)).data.items.length, 0);
        assert.equal((await owner('GET', path + '?boardId=' + board.id)).data.items[0].id, id);
        const file = await owner('GET', job.data.result.contentUrl.replace('/api/v1', ''));
        assert.equal(file.status, 200);
        assert.ok(Buffer.isBuffer(file.data));
        for (let n = 0; n < 2; n++) {
          const adoption = await owner('POST', `/generation-jobs/${id}/save-to-library`, {});
          assert.equal(adoption.status, 201, JSON.stringify(adoption.data));
          assert.equal(adoption.data.inLibrary, true);
        }
        assert.equal((await owner('GET', `/projects/${freeProject.id}/media-assets`)).data.items.length, 1);
        assert.equal(
          db()
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='generation.candidate.save' AND target_id=?",
            )
            .get(id).n,
          1,
        );
        assert.equal(
          db().prepare('SELECT count(*) AS n FROM shots WHERE project_id=?').get(freeProject.id).n,
          0,
        );
        assert.equal(
          db().prepare('SELECT count(*) AS n FROM prompt_artifacts WHERE project_id=?').get(freeProject.id).n,
          0,
        );
        assert.equal(
          db().prepare('SELECT count(*) AS n FROM takes WHERE project_id=?').get(freeProject.id).n,
          0,
        );
        assert.equal(
          (await owner('GET', `/generation-workflows/${freeWorkflow.id}/routing-options?context=exploration`))
            .status,
          200,
        );
        assert.equal(
          (await owner('GET', `/generation-workflows/${freeWorkflow.id}/routing-options`)).status,
          409,
        );
        const trial = await owner(
          'POST',
          `/projects/${freeProject.id}/workflow-trials`,
          { ...body, boardId: undefined },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(trial.status, 201, JSON.stringify(trial.data));
        for (let n = 0; n < 3; n++) {
          db().prepare('UPDATE generation_jobs SET next_at=0 WHERE id=?').run(trial.data.id);
          await app.get(GenerationWorker).tick();
        }
        assert.equal((await owner('GET', `/generation-jobs/${trial.data.id}`)).data.state, 'test_completed');
        assert.equal(
          (await owner('POST', `/generation-jobs/${trial.data.id}/save-to-library`, {})).status,
          409,
        );
        assert.equal(
          (await owner('GET', `/generation-workflows/${freeWorkflow.id}/test-jobs`)).data[0].shotId,
          null,
        );
        const videoWorkflow = (
          await owner('POST', `/projects/${freeProject.id}/generation-workflows`, fixtureI2V(connection.id))
        ).data;
        const videoBody = { ...body, workflowId: videoWorkflow.id, imageVersionId: job.data.mediaVersionId };
        const priorSubmissions = remote.mock.submissions.length;
        remote.mock.mode = 'lost';
        const videoJob = (await submit(videoBody, randomUUID())).data;
        await app.get(GenerationWorker).tick();
        assert.equal(
          (await owner('GET', `/generation-jobs/${videoJob.id}`)).data.state,
          'needs_reconciliation',
        );
        remote.mock.mode = 'normal';
        await app.close();
        await start();
        assert.equal((await owner('POST', `/generation-jobs/${videoJob.id}/reconcile`, {})).status, 201);
        for (let n = 0; n < 2; n++) {
          db().prepare('UPDATE generation_jobs SET next_at=0 WHERE id=?').run(videoJob.id);
          await app.get(GenerationWorker).tick();
        }
        const videoResult = (await owner('GET', `/generation-jobs/${videoJob.id}`)).data;
        assert.equal(videoResult.state, 'completed', JSON.stringify(videoResult));
        assert.equal(videoResult.takeId, null);
        assert.equal(videoResult.result.mediaType, 'video');
        assert.equal(videoResult.image.id, job.data.mediaVersionId);
        assert.equal(remote.mock.submissions.length, priorSubmissions + 1);
        assert.equal((await owner('GET', `/projects/${freeProject.id}/media-assets`)).data.items.length, 1);
        const readerId = db().prepare('SELECT id FROM users WHERE email=?').get('reader@workflow.test').id;
        await owner('POST', `/projects/${freeProject.id}/members`, { userId: readerId, role: 'VIEWER' });
        assert.equal((await reader('GET', path)).status, 200);
        assert.equal((await reader('POST', path, body, { 'Idempotency-Key': randomUUID() })).status, 403);
        assert.equal(
          (await reader('POST', `/generation-jobs/${videoJob.id}/save-to-library`, {})).status,
          403,
        );
        assert.equal(
          (
            await reader(
              'POST',
              `/projects/${freeProject.id}/workflow-trials`,
              { ...body, boardId: undefined },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          403,
        );
        assert.equal((await outsider('GET', path)).status, 404);
        const freshKey = randomUUID();
        const cancelJob = (await submit(body, freshKey)).data;
        assert.equal(
          (await owner('POST', `/generation-jobs/${cancelJob.id}/cancel`, {})).data.state,
          'canceled',
        );
        await app.close();
        await start();
        assert.equal((await owner('GET', path)).data.items.find((item) => item.id === id).inLibrary, true);
        assert.equal((await submit()).data.id, id);
        assert.deepEqual(db().pragma('foreign_key_check'), []);
      },
    );
    definition = fixtureCreativeFields(connection.id);
    const basic = (
      await owner('POST', `/projects/${project.id}/shots`, { description: 'A commuter waits in daylight.' })
    ).data;
    const editor = (await owner('GET', `/shots/${basic.id}/card/editor`)).data;
    shot = (
      await owner('PATCH', `/shots/${basic.id}/card`, { expectedVersion: basic.version, body: editor.body })
    ).data.shot;
    prompt = (
      await owner('POST', `/shots/${shot.id}/prompts/compile`, {
        mode: 'commit',
        expectedShotVersion: shot.version,
        expectedProjectVersion: project.version,
        profileRevisionId: null,
      })
    ).data;
    await t.test(
      'create/save replays are stable; catalog CAS, history and restore never rewrite old definitions',
      async () => {
        const key = randomUUID(),
          first = await create(definition, key);
        assert.equal(first.status, 201, JSON.stringify(first.data));
        saved = first.data;
        assert.deepEqual((await create(definition, key)).data, saved);
        assert.equal((await create({ ...definition, name: 'Changed' }, key)).status, 409);
        const original = db()
          .prepare('SELECT definition_json FROM generation_workflows WHERE id=?')
          .get(saved.id).definition_json;
        const body = {
            expectedVersion: 1,
            summary: 'Tune labels',
            definition: { ...definition, name: 'Revision two' },
          },
          revisionKey = randomUUID();
        const [a, b] = await Promise.all([
          revise(body, revisionKey),
          revise({ ...body, summary: 'Other writer' }),
        ]);
        assert.deepEqual([a.status, b.status].sort(), [201, 409]);
        const winner = a.status === 201 ? a.data : b.data;
        if (a.status === 201) assert.equal((await revise(body, revisionKey)).data.id, winner.id);
        assert.equal(
          db().prepare('SELECT definition_json FROM generation_workflows WHERE id=?').get(saved.id)
            .definition_json,
          original,
        );
        const head = await read(winner.id);
        const restored = await owner(
          'POST',
          `/workflow-catalogs/${saved.familyId}/restore`,
          {
            expectedVersion: head.catalog.version,
            workflowId: saved.id,
            summary: 'Restore original as new version',
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(restored.status, 201, JSON.stringify(restored.data));
        assert.equal(restored.data.revision, 3);
        assert.notEqual(restored.data.id, saved.id);
        assert.equal(
          (await owner('GET', `/workflow-catalogs/${saved.familyId}/revisions`)).data.items.length,
          3,
        );
        assert.equal((await read(restored.data.id)).definition.name, definition.name);
        assert.throws(() => db().exec('UPDATE workflow_catalog_revisions SET summary=summary'), /immutable/);
        assert.throws(() => db().exec('DELETE FROM workflow_catalog_revisions'), /immutable/);
        assert.throws(
          () => db().exec('UPDATE workflow_catalogs SET revision=revision+1,version=version+1'),
          /history/,
        );
      },
    );
    await t.test(
      'project/manager checks guard definitions, histories, inspection, revision and archive',
      async () => {
        for (const path of [
          `/generation-workflows/${saved.id}/definition`,
          `/workflow-catalogs/${saved.familyId}/revisions`,
        ]) {
          assert.equal((await reader('GET', path)).status, 403);
          assert.equal((await outsider('GET', path)).status, 404);
        }
        assert.equal((await reader('POST', `/generation-workflows/${saved.id}/inspection`, {})).status, 403);
        assert.equal(
          (
            await reader('PATCH', `/workflow-catalogs/${saved.familyId}`, {
              expectedVersion: 3,
              archived: true,
            })
          ).status,
          403,
        );
        const config = (await reader('GET', `/projects/${project.id}/generation-config`)).data;
        assert.equal(config.workflows.length, 1);
        assert.equal(config.workflows[0].fields.length, 4);
        assert.equal(config.connections.length, 0);
        assert.ok(!JSON.stringify(config).includes('private-fixture-only'));
        assert.ok(!JSON.stringify(config).includes(remote.baseUrl));
        assert.ok(!Object.hasOwn(config.workflows[0].fields[0], 'node'));
        const other = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Other' })).data;
        const foreign = await owner('POST', `/projects/${other.id}/generation-workflows`, definition, {
          'Idempotency-Key': randomUUID(),
        });
        const state = (await read(saved.id)).catalog;
        assert.equal(
          (
            await owner(
              'POST',
              `/workflow-catalogs/${saved.familyId}/restore`,
              { expectedVersion: state.version, workflowId: foreign.data.id, summary: 'Cross family' },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      'scalar schemas enforce defaults, targets, types, range/step, secret fields and remote declarations',
      async () => {
        const invalid = [
          (copy) => (copy.fields[0].id = copy.fields[1].id),
          (copy) => (copy.fields[0].input = 'api_key'),
          (copy) => (copy.fields[0].node = 'missing'),
          (copy) => (copy.fields[1].max = 2),
          (copy) => (copy.fields[1].integer = false),
          (copy) => (copy.fields[3].options = ['draft', 'missing']),
          (copy) => (copy.fields[0].maxLength = 2),
          (copy) => (copy.fields[0].input = 'text'),
        ];
        for (const mutate of invalid) {
          const copy = structuredClone(definition);
          mutate(copy);
          const result = await create(copy);
          assert.equal(result.status, 400, JSON.stringify(result));
        }
        const wrongValues = [
          { [definition.fields[1].id]: '7' },
          { [definition.fields[1].id]: 7.5 },
          { [definition.fields[1].id]: 100 },
          { [definition.fields[2].id]: 'false' },
          { [definition.fields[3].id]: 'missing' },
          { [definition.fields[0].id]: 'x'.repeat(101) },
          { [randomUUID()]: 2 },
        ];
        for (const values of wrongValues) assert.equal((await queue(saved.id, values)).status, 400);
      },
    );
    await t.test(
      'field overrides freeze, survive restart, reach one remote prompt and archive a real draft',
      async () => {
        const values = Object.fromEntries(
          definition.fields.map((field, index) => [field.id, ['Overcast platform', 7, false, 'high'][index]]),
        );
        const key = randomUUID(),
          result = await queue(saved.id, values, key);
        assert.equal(result.status, 201, JSON.stringify(result.data));
        const id = result.data.id;
        assert.deepEqual(result.data.fieldValues, values);
        assert.deepEqual(
          result.data.creativeParameters,
          definition.fields.map((field) => ({
            label: field.label,
            value: values[field.id],
          })),
        );
        assert.equal((await queue(saved.id, values, key)).data.id, id);
        completed = { id, key, values };
        assert.equal(
          (await queue(saved.id, { ...values, [definition.fields[2].id]: true }, key)).status,
          409,
        );
        const raw = db()
          .prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?')
          .get(id).snapshot_json;
        assert.equal(JSON.parse(raw).graph['5'].inputs.enabled, false);
        await app.close();
        await start();
        await app.get(GenerationWorker).tick();
        await app.get(GenerationWorker).tick();
        await app.get(GenerationWorker).tick();
        const complete = (await owner('GET', `/generation-jobs/${id}`)).data;
        assert.equal(complete.state, 'completed', JSON.stringify(complete));
        assert.deepEqual(complete.fieldValues, values);
        assert.equal(complete.workflowRevision, 1);
        assert.deepEqual(remote.mock.submissions.at(-1).prompt['5'].inputs, {
          note: 'Overcast platform',
          iterations: 7,
          enabled: false,
          quality: 'high',
        });
        assert.ok(complete.takeId);
        assert.ok(complete.mediaVersionId);
        assert.equal(
          db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(id).snapshot_json,
          raw,
        );
      },
    );
    await t.test(
      'worker rejects changed field declarations before submit and recovers lost responses with frozen values',
      async () => {
        const before = remote.mock.submissions.length,
          queued = await queue(saved.id, completed.values);
        remote.mock.objectInfoOverrides = {
          CreativeControls: {
            input: {
              required: {
                note: ['STRING'],
                iterations: ['INT', { min: 1, max: 20 }],
                enabled: ['BOOLEAN'],
                quality: [['draft']],
              },
            },
          },
        };
        try {
          await app.get(GenerationWorker).tick();
          const read = (await owner('GET', `/generation-jobs/${queued.data.id}`)).data;
          assert.equal(read.state, 'failed');
          assert.equal(read.errorCode, 'WORKFLOW_FIELD_BINDING_INVALID');
          assert.equal(remote.mock.submissions.length, before);
        } finally {
          remote.mock.objectInfoOverrides = {};
        }
        const key = randomUUID(),
          lost = await queue(saved.id, completed.values, key);
        remote.mock.mode = 'lost';
        try {
          await app.get(GenerationWorker).tick();
          assert.equal(
            (await owner('GET', `/generation-jobs/${lost.data.id}`)).data.state,
            'needs_reconciliation',
          );
          assert.equal((await queue(saved.id, completed.values, key)).data.id, lost.data.id);
          assert.equal(remote.mock.submissions.length, before + 1);
        } finally {
          remote.mock.mode = 'normal';
        }
        assert.equal((await owner('POST', `/generation-jobs/${lost.data.id}/reconcile`, {})).status, 201);
        await app.get(GenerationWorker).tick();
        await app.get(GenerationWorker).tick();
        assert.equal((await owner('GET', `/generation-jobs/${lost.data.id}`)).data.state, 'completed');
        assert.equal(remote.mock.submissions.length, before + 1);
      },
    );
    await t.test(
      'legacy workflow definitions and job snapshots without field metadata remain readable and replayable',
      async () => {
        const legacyDefinition = fixtureWorkflow(connection.id),
          legacy = (await create(legacyDefinition)).data;
        const row = {
          ...db().prepare('SELECT * FROM generation_jobs WHERE id=?').get(completed.id),
          id: randomUUID(),
          workflow_id: legacy.id,
          request_key: randomUUID(),
          state: 'canceled',
          media_version_id: null,
          take_id: null,
          remote_id: null,
          result_json: null,
        };
        const { renderWorkflow } = await import('../dist/generation/generation-contract.js');
        row.snapshot_json = JSON.stringify({
          graph: renderWorkflow(
            legacyDefinition,
            prompt.rendered.positivePrompt,
            prompt.rendered.negativePrompt,
          ),
          approvals: [],
          parameterValues: {},
        });
        const keys = Object.keys(row);
        db()
          .prepare(
            `INSERT INTO generation_jobs (${keys.map((key) => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
          )
          .run(...keys.map((key) => row[key]));
        assert.deepEqual((await owner('GET', `/generation-jobs/${row.id}`)).data.fieldValues, {});
        assert.equal((await queue(legacy.id, undefined, row.request_key)).data.id, row.id);
        assert.equal(
          db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(row.id).snapshot_json,
          row.snapshot_json,
        );
      },
    );
    await t.test(
      'inspection distinguishes model options, missing nodes, cycles and unknown metadata without prompt submission',
      async () => {
        const before = remote.mock.submissions.length;
        const report = (await owner('POST', `/generation-workflows/${saved.id}/inspection`, {})).data;
        assert.equal(report.status, 'compatible', JSON.stringify(report));
        remote.mock.objectInfoOverrides = { CreativeControls: null };
        const missing = (await owner('POST', `/generation-workflows/${saved.id}/inspection`, {})).data;
        assert.equal(missing.status, 'incompatible');
        remote.mock.objectInfoOverrides = {};
        const model = structuredClone(definition);
        model.graph['6'] = {
          class_type: 'CheckpointLoaderSimple',
          inputs: { ckpt_name: 'not-installed.safetensors' },
        };
        const created = await create(model);
        assert.equal(created.status, 201);
        const unavailable = (await owner('POST', `/generation-workflows/${created.data.id}/inspection`, {}))
          .data;
        assert.ok(
          unavailable.nodes.some((node) => node.issues.some((issue) => issue.code === 'OPTION_UNAVAILABLE')),
        );
        remote.mock.objectInfoOverrides = {
          CreativeControls: { input: { required: { dynamic: ['CUSTOM_DYNAMIC'] } } },
        };
        const unknown = (await owner('POST', `/generation-workflows/${saved.id}/inspection`, {})).data;
        assert.equal(unknown.status, 'incompatible');
        remote.mock.objectInfoOverrides = {};
        const { inspectWorkflow } = await import('../dist/generation/workflow-inspection.js');
        const disconnected = await inspectWorkflow(definition, async () => {
          throw new Error('private endpoint address must never appear');
        });
        assert.equal(disconnected.status, 'unverified');
        assert.ok(!JSON.stringify(disconnected).includes('private endpoint'));
        const cyclic = {
          ...definition,
          graph: {
            a: { class_type: 'A', inputs: { input: ['b', 0] } },
            b: { class_type: 'A', inputs: { input: ['a', 0] } },
          },
          fields: [],
        };
        assert.equal(
          (
            await inspectWorkflow(cyclic, async () => ({
              input: { required: { input: ['X'] } },
              output: ['X'],
            }))
          ).status,
          'incompatible',
        );
        assert.equal(remote.mock.submissions.length, before);
        assert.ok(!JSON.stringify(report).includes(remote.baseUrl));
      },
    );
    await t.test(
      'archiving blocks new submissions and preserves retries, old records and audit atomicity',
      async () => {
        const state = (await read(saved.id)).catalog;
        assert.equal(
          (
            await owner('PATCH', `/workflow-catalogs/${saved.familyId}`, {
              expectedVersion: state.version,
              archived: true,
            })
          ).status,
          200,
        );
        assert.equal((await queue(saved.id)).data.code, 'WORKFLOW_ARCHIVED');
        assert.equal((await queue(saved.id, completed.values, completed.key)).data.id, completed.id);
        assert.equal(
          (await reader('GET', `/projects/${project.id}/generation-config`)).data.workflows.find(
            (item) => item.familyId === saved.familyId,
          ).enabled,
          false,
        );
        assert.equal(
          (
            await owner('PATCH', `/workflow-catalogs/${saved.familyId}`, {
              expectedVersion: state.version,
              archived: false,
            })
          ).status,
          409,
        );
        const current = (await read(saved.id)).catalog;
        const count = db().prepare('SELECT COUNT(*) n FROM generation_workflows').get().n;
        db().exec(
          "CREATE TRIGGER catalog_fixture_failure BEFORE INSERT ON audit_events WHEN NEW.action='generation.workflow.revise' BEGIN SELECT RAISE(ABORT,'fixture'); END",
        );
        try {
          assert.equal(
            (await revise({ expectedVersion: current.version, summary: 'Fail audit', definition })).status,
            409,
          );
          assert.equal(db().prepare('SELECT COUNT(*) n FROM generation_workflows').get().n, count);
          assert.equal((await read(saved.id)).catalog.version, current.version);
        } finally {
          db().exec('DROP TRIGGER catalog_fixture_failure');
        }
        assert.equal(
          (
            await owner('PATCH', `/workflow-catalogs/${saved.familyId}`, {
              expectedVersion: current.version,
              archived: false,
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      'controlled tests isolate output and project reviewers publish a fixed revision',
      async () => {
        const managed = await create({ ...definition, name: 'Managed workflow', reviewRequired: true });
        assert.equal(managed.status, 201, JSON.stringify(managed.data));
        const { id, familyId } = managed.data;
        const configPath = `/projects/${project.id}/generation-config`;
        const releasePath = `/workflow-catalogs/${familyId}/releases`;
        const trialPath = `/generation-workflows/${id}/test-jobs`;
        const trialInput = { shotId: shot.id, promptId: prompt.id, confirmed: true };
        const release = (body, actor = reviewer, key = randomUUID()) =>
          actor('POST', releasePath, body, { 'Idempotency-Key': key });
        const config = async () => (await reader('GET', configPath)).data;
        assert.equal(
          (await config()).productionWorkflows.some((item) => item.id === id),
          false,
        );
        assert.equal((await queue(id)).data.code, 'WORKFLOW_NOT_PUBLISHED');
        assert.equal(
          (await queue(saved.id, undefined, randomUUID(), shot.version)).data.code,
          'WORKFLOW_NOT_PUBLISHED',
        );
        assert.equal(
          (await queue(id, undefined, randomUUID(), shot.version + 1)).data.code,
          'CANVAS_SHOT_OUTDATED',
        );
        assert.equal((await outsider('GET', trialPath)).status, 404);
        assert.equal(
          (await reviewer('POST', trialPath, trialInput, { 'Idempotency-Key': randomUUID() })).status,
          403,
        );
        const testKey = randomUUID();
        assert.equal(
          (
            await owner(
              'POST',
              trialPath,
              { ...trialInput, confirmed: false },
              { 'Idempotency-Key': testKey },
            )
          ).status,
          400,
        );
        const trial = await owner('POST', trialPath, trialInput, { 'Idempotency-Key': testKey });
        assert.equal(trial.status, 201, JSON.stringify(trial.data));
        const publish = {
          action: 'publish',
          expectedVersion: 1,
          workflowId: id,
          testJobId: trial.data.id,
          reason: 'Preview checked',
        };
        assert.equal((await release(publish, reader)).status, 403);
        assert.equal((await release(publish)).data.code, 'WORKFLOW_TEST_REQUIRED');
        assert.equal((await queue(id, undefined, testKey)).data.code, 'IDEMPOTENCY_CONFLICT');
        const before = remote.mock.submissions.length;
        for (let index = 0; index < 3; index++) await app.get(GenerationWorker).tick();
        assert.equal(remote.mock.submissions.length, before + 1);
        const evidence = (await reviewer('GET', trialPath)).data[0];
        assert.equal(evidence.state, 'test_completed', JSON.stringify(evidence));
        assert.equal(evidence.evidenceCurrent, true);
        assert.equal(evidence.takeId, null);
        const evidenceId = evidence.mediaVersionId;
        assert.equal(
          (await owner('POST', trialPath, trialInput, { 'Idempotency-Key': testKey })).data.id,
          evidence.id,
        );
        assert.deepEqual(
          (await reviewer('GET', evidence.result.contentUrl.replace('/api/v1', ''))).data,
          fixtures['image.png'].bytes,
        );
        assert.equal((await outsider('GET', evidence.result.contentUrl.replace('/api/v1', ''))).status, 404);
        const assets = (await owner('GET', `/projects/${project.id}/media-assets`)).data.items;
        assert.ok(!assets.some((asset) => asset.latest.id === evidenceId));
        const inputs = (await owner('GET', `/projects/${project.id}/generation-images`)).data.items;
        assert.ok(!inputs.some((image) => image.id === evidenceId));
        const jobs = (await owner('GET', `/shots/${shot.id}/generation-jobs`)).data;
        assert.ok(!jobs.some((job) => job.id === evidence.id));
        assert.equal(
          (
            await owner('POST', `/shots/${shot.id}/takes`, {
              mediaVersionId: evidenceId,
              expectedShotVersion: shot.version,
            })
          ).data.code,
          'WORKFLOW_TEST_MEDIA',
        );
        assert.throws(
          () => db().prepare("UPDATE generation_jobs SET purpose='production' WHERE id=?").run(evidence.id),
          /workflow test job/,
        );
        assert.equal(
          (await release({ ...publish, testJobId: completed.id })).data.code,
          'WORKFLOW_TEST_REQUIRED',
        );
        const releaseKey = randomUUID();
        const [accepted, raced] = await Promise.all([
          release(publish, reviewer, releaseKey),
          release({ ...publish, reason: 'Concurrent approval' }),
        ]);
        const winner = accepted.status === 201 ? accepted : raced;
        assert.equal(winner.status, 201, JSON.stringify(winner.data));
        assert.equal([accepted, raced].filter((result) => result.status === 409).length, 1);
        if (accepted.status === 201)
          assert.deepEqual((await release(publish, reviewer, releaseKey)).data, accepted.data);
        assert.ok((await config()).productionWorkflows.some((item) => item.id === id));
        const draft = await owner(
          'POST',
          `/workflow-catalogs/${familyId}/revisions`,
          {
            expectedVersion: 2,
            summary: 'New draft',
            definition,
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(draft.status, 201, JSON.stringify(draft.data));
        assert.equal((await read(draft.data.id)).definition.reviewRequired, true);
        assert.equal((await queue(draft.data.id)).data.code, 'WORKFLOW_NOT_PUBLISHED');
        assert.ok((await config()).productionWorkflows.some((item) => item.id === id));
        const canvasKey = randomUUID();
        const production = await queue(id, undefined, canvasKey, shot.version);
        assert.equal(production.status, 201, JSON.stringify(production.data));
        const revoked = await release({
          expectedVersion: 3,
          action: 'revoke',
          reason: 'Retire published revision',
        });
        assert.equal(revoked.status, 201, JSON.stringify(revoked.data));
        assert.equal((await queue(id)).data.code, 'WORKFLOW_NOT_PUBLISHED');
        assert.equal(
          (await queue(id, undefined, randomUUID(), shot.version)).data.code,
          'WORKFLOW_NOT_PUBLISHED',
        );
        assert.equal((await queue(id, undefined, canvasKey, shot.version)).data.id, production.data.id);
        for (let index = 0; index < 3; index++) await app.get(GenerationWorker).tick();
        const finished = (await owner('GET', `/generation-jobs/${production.data.id}`)).data;
        assert.equal(finished.state, 'completed', JSON.stringify(finished));
        assert.ok(finished.takeId);
        const history = (await reviewer('GET', releasePath)).data;
        assert.deepEqual(
          history.items.map((event) => event.action),
          ['revoke', 'publish'],
        );
        assert.equal(history.items[1].testJobId, evidence.id);
        assert.throws(
          () => db().prepare('DELETE FROM workflow_release_events WHERE id=?').run(revoked.data.id),
          /immutable/,
        );
      },
    );
    await t.test(
      'two scoped instances report exact workflow compatibility and bounded queue evidence',
      async () => {
        const alternate = await startComfyMock({});
        try {
          const register = (name, baseUrl, projectId = project.id) =>
            owner('POST', `/projects/${projectId}/generation-connections`, {
              name,
              baseUrl,
              token: 'never-return-instance-token',
              trustedPrivate: true,
            });
          const second = (await register('Second instance', alternate.baseUrl)).data;
          const duplicate = (await register('Duplicate instance', remote.baseUrl)).data;
          const poolPath = (id) => `/generation-connections/${id}/pool`;
          const pool = { poolEnabled: true, expectedPoolVersion: 1, maxRunning: 1, maxPending: 2 };
          const workflow = structuredClone(definition);
          workflow.name = 'Fixed matching fixture';
          workflow.graph['6'] = {
            class_type: 'CheckpointLoaderSimple',
            inputs: { ckpt_name: 'fixture.safetensors' },
          };
          const created = await create(workflow);
          assert.equal(created.status, 201, JSON.stringify(created.data));
          const checks = `/generation-workflows/${created.data.id}/instance-checks`;
          const inspect = (id) => owner('POST', `${checks}/${id}`, {});
          assert.deepEqual((await owner('GET', checks)).data.items, []);
          assert.equal((await inspect(connection.id)).data.code, 'INSTANCE_NOT_ENABLED');
          assert.equal((await reader('GET', checks)).status, 403);
          assert.equal((await reader('PATCH', poolPath(connection.id), pool)).status, 403);
          assert.equal((await outsider('GET', checks)).status, 404);
          const beforeVersion = db()
            .prepare('SELECT version FROM generation_connections WHERE id=?')
            .get(connection.id).version;
          assert.equal(
            (await owner('PATCH', poolPath(connection.id), { ...pool, maxRunning: 17 })).status,
            400,
          );
          assert.equal((await owner('PATCH', poolPath(connection.id), pool)).data.poolVersion, 2);
          assert.equal(
            db().prepare('SELECT version FROM generation_connections WHERE id=?').get(connection.id).version,
            beforeVersion,
          );
          assert.equal(
            (await owner('PATCH', poolPath(connection.id), pool)).data.code,
            'INSTANCE_POOL_VERSION_CONFLICT',
          );
          assert.equal(
            (await owner('PATCH', poolPath(duplicate.id), pool)).data.code,
            'INSTANCE_POOL_DUPLICATE',
          );
          assert.equal((await owner('PATCH', poolPath(second.id), pool)).status, 200);
          const otherWorkspace = (await owner('POST', '/workspaces', { name: 'Separate instance workspace' }))
            .data;
          const otherProject = (
            await owner('POST', '/projects', { workspaceId: otherWorkspace.id, title: 'Foreign instance' })
          ).data;
          const foreign = (await register('Foreign instance', alternate.baseUrl, otherProject.id)).data;
          assert.equal((await owner('PATCH', poolPath(foreign.id), pool)).status, 200);
          assert.equal((await inspect(foreign.id)).status, 404);
          alternate.mock.objectInfoOverrides = {
            CheckpointLoaderSimple: {
              input: { required: { ckpt_name: [['different.safetensors']] } },
              output: ['MODEL'],
            },
          };
          alternate.mock.queue = { queue_running: [['private-queue-data']], queue_pending: [[], []] };
          const beforeSubmissions = remote.mock.submissions.length;
          const [matched, mismatched] = await Promise.all([inspect(connection.id), inspect(second.id)]);
          assert.equal(matched.status, 201, JSON.stringify(matched.data));
          assert.equal(matched.data.check.status, 'compatible');
          assert.equal(matched.data.capacity, 'available');
          assert.equal(mismatched.status, 201, JSON.stringify(mismatched.data));
          assert.equal(mismatched.data.check.status, 'incompatible');
          assert.equal(mismatched.data.capacity, 'busy');
          assert.ok(
            mismatched.data.check.report.nodes.some((node) =>
              node.issues.some((issue) => issue.code === 'OPTION_UNAVAILABLE'),
            ),
          );
          const list = (await owner('GET', checks)).data.items;
          assert.equal(list.length, 2);
          for (const value of [
            'private-queue-data',
            remote.baseUrl,
            alternate.baseUrl,
            'never-return-instance-token',
            'different.safetensors',
          ]) {
            assert.ok(!JSON.stringify(list).includes(value));
          }
          alternate.mock.queue = { unexpected: true };
          const unknownQueue = (await inspect(second.id)).data;
          assert.equal(unknownQueue.check.reachable, true);
          assert.equal(unknownQueue.check.pending, null);
          assert.equal(unknownQueue.capacity, 'unverified');
          alternate.mock.mode = 'probe-down';
          const down = (await inspect(second.id)).data;
          assert.equal(down.check.reachable, false);
          assert.equal(down.check.status, 'unverified');
          assert.equal(remote.mock.submissions.length, beforeSubmissions);
          assert.equal(alternate.mock.submissions.length, 0);
          db()
            .prepare(
              'UPDATE generation_instance_checks SET checked_at=? WHERE workflow_id=? AND connection_id=?',
            )
            .run(Date.now() - 16 * 60 * 1000, created.data.id, connection.id);
          assert.equal(
            (await owner('GET', checks)).data.items.find((item) => item.id === connection.id).fresh,
            false,
          );
          assert.equal((await inspect(connection.id)).data.fresh, true);
          let releaseQueue;
          const blockedQueue = new Promise((resolve) => {
            releaseQueue = resolve;
          });
          let entered;
          const enteredQueue = new Promise((resolve) => {
            entered = resolve;
          });
          remote.mock.beforeQueue = () => {
            entered();
            return blockedQueue;
          };
          const inFlight = inspect(connection.id);
          await enteredQueue;
          try {
            assert.equal((await inspect(connection.id)).data.code, 'INSTANCE_CHECK_BUSY');
            assert.equal(
              (
                await owner('PATCH', poolPath(connection.id), {
                  ...pool,
                  maxRunning: 2,
                  expectedPoolVersion: 2,
                })
              ).status,
              200,
            );
          } finally {
            releaseQueue();
            delete remote.mock.beforeQueue;
          }
          assert.equal((await inFlight).data.code, 'INSTANCE_CHECK_OUTDATED');
          assert.equal(
            (await owner('GET', checks)).data.items.find((item) => item.id === connection.id).fresh,
            false,
          );
        } finally {
          await alternate.close();
        }
      },
    );
    await t.test('pool reservations serialize capacity and recover on the assigned instance', async () => {
      const a = await startComfyMock({ 'image.png': fixtures['image.png'].bytes });
      const b = await startComfyMock({ 'image.png': fixtures['image.png'].bytes });
      try {
        const register = async (name, remote) => {
          const created = await owner('POST', `/projects/${project.id}/generation-connections`, {
            name,
            baseUrl: remote.baseUrl,
            trustedPrivate: true,
          });
          assert.equal(created.status, 201);
          assert.equal(
            (
              await owner('PATCH', `/generation-connections/${created.data.id}/pool`, {
                expectedPoolVersion: 1,
                poolEnabled: true,
                maxRunning: 1,
                maxPending: 1,
              })
            ).status,
            200,
          );
          return created.data.id;
        };
        const aId = await register('Routing A', a),
          bId = await register('Routing B', b);
        const created = await create(fixtureWorkflow(aId));
        assert.equal(created.status, 201);
        const workflowId = created.data.id;
        const check = (id) => owner('POST', `/generation-workflows/${workflowId}/instance-checks/${id}`, {});
        a.mock.queue = { queue_running: [[]], queue_pending: [] };
        assert.equal((await check(aId)).data.capacity, 'busy');
        assert.equal((await check(bId)).data.capacity, 'available');
        const optionsPath = `/generation-workflows/${workflowId}/routing-options`;
        assert.deepEqual(
          (await owner('GET', optionsPath)).data.items.map(({ id, available }) => [id, available]).sort(),
          [
            [aId, false],
            [bId, true],
          ].sort(),
        );
        assert.equal((await reader('GET', optionsPath)).status, 403);
        assert.equal((await outsider('GET', optionsPath)).status, 404);
        const makeShot = async (description) => {
          const basic = (await owner('POST', `/projects/${project.id}/shots`, { description })).data;
          const editor = (await owner('GET', `/shots/${basic.id}/card/editor`)).data;
          const shot = (
            await owner('PATCH', `/shots/${basic.id}/card`, {
              expectedVersion: basic.version,
              body: editor.body,
            })
          ).data.shot;
          const prompt = (
            await owner('POST', `/shots/${shot.id}/prompts/compile`, {
              mode: 'commit',
              expectedShotVersion: shot.version,
              expectedProjectVersion: project.version,
              profileRevisionId: null,
            })
          ).data;
          return { shot, prompt };
        };
        const submit = (input, routing, key = randomUUID()) =>
          owner(
            'POST',
            `/shots/${input.shot.id}/generation-jobs`,
            {
              workflowId,
              promptId: input.prompt.id,
              routing,
              confirmed: true,
            },
            { 'Idempotency-Key': key },
          );
        const first = await makeShot('First routed shot');
        const second = await makeShot('Second routed shot');
        const third = await makeShot('Third routed shot');
        const fourth = await makeShot('Parallel instance shot');
        assert.equal(
          (await submit(first, { mode: 'manual', connectionId: aId })).data.code,
          'MANUAL_INSTANCE_UNAVAILABLE',
        );
        const key = randomUUID();
        const automatic = await submit(first, { mode: 'auto' }, key);
        assert.equal(automatic.status, 201, JSON.stringify(automatic.data));
        assert.deepEqual(automatic.data.instance, { id: bId, name: 'Routing B', mode: 'auto' });
        const manualB = { mode: 'manual', connectionId: bId };
        const attempts = await Promise.all([submit(second, manualB), submit(third, manualB)]);
        const accepted = attempts.find((result) => result.status === 201);
        assert.ok(accepted, JSON.stringify(attempts));
        assert.equal(attempts.filter((result) => result.status === 201).length, 1);
        assert.equal(
          attempts.find((result) => result.status === 409).data.code,
          'MANUAL_INSTANCE_UNAVAILABLE',
        );
        assert.equal((await submit(first, { mode: 'auto' }, key)).data.id, automatic.data.id);
        assert.equal((await submit(first, manualB, key)).data.code, 'IDEMPOTENCY_CONFLICT');
        assert.throws(
          () =>
            db()
              .prepare('UPDATE generation_jobs SET lease_id=? WHERE id=?')
              .run(randomUUID(), automatic.data.id),
          /requires updated generation worker/,
        );
        assert.throws(
          () =>
            db()
              .prepare('UPDATE generation_job_routes SET connection_id=? WHERE job_id=?')
              .run(aId, automatic.data.id),
          /immutable/,
        );
        const tick = async (id) => {
          db()
            .prepare('UPDATE generation_jobs SET next_at=? WHERE state=? AND id<>?')
            .run(Date.now() + 120000, 'queued', id);
          db().prepare('UPDATE generation_jobs SET next_at=0 WHERE id=?').run(id);
          await app.get(GenerationWorker).tick();
          return (await owner('GET', `/generation-jobs/${id}`)).data;
        };
        b.mock.queue = { queue_running: [[]], queue_pending: [] };
        let state = await tick(automatic.data.id);
        assert.equal(state.state, 'queued');
        assert.equal(state.errorCode, 'INSTANCE_WAITING');
        assert.equal(b.mock.submissions.length, 0);
        b.mock.queue = { queue_running: [], queue_pending: [] };
        b.mock.mode = 'lost';
        state = await tick(automatic.data.id);
        assert.equal(state.state, 'needs_reconciliation');
        assert.equal(state.instance.id, bId);
        assert.equal((await tick(accepted.data.id)).errorCode, 'INSTANCE_WAITING');
        a.mock.queue = { queue_running: [], queue_pending: [] };
        await check(aId);
        const parallel = await submit(fourth, { mode: 'auto' });
        assert.equal(parallel.data.instance.id, aId);
        assert.equal((await tick(parallel.data.id)).state, 'submitted');
        assert.equal((await tick(parallel.data.id)).state, 'fetching');
        assert.equal((await tick(parallel.data.id)).state, 'completed');
        assert.equal(a.mock.submissions.length, 1);
        await app.close();
        await start();
        assert.equal(
          (await owner('POST', `/generation-jobs/${automatic.data.id}/reconcile`, {})).status,
          201,
        );
        assert.equal((await tick(automatic.data.id)).state, 'fetching');
        state = await tick(automatic.data.id);
        assert.equal(state.state, 'completed');
        assert.ok(state.takeId);
        assert.equal(state.instance.id, bId);
        assert.equal(b.mock.submissions.length, 1);
        assert.equal(a.mock.submissions.length, 1);
        await owner('PATCH', `/generation-connections/${bId}`, { expectedVersion: 1, enabled: false });
        state = await tick(accepted.data.id);
        assert.equal(state.state, 'failed');
        assert.equal(state.errorCode, 'CONNECTION_DISABLED');
        assert.equal(state.instance.id, bId);
        assert.equal(a.mock.submissions.length, 1);
        assert.equal(b.mock.submissions.length, 1);
        const free = await owner(
          'POST',
          `/projects/${project.id}/generation-jobs`,
          {
            workflowId,
            positivePrompt: 'Explore without a shot',
            confirmed: true,
            routing: { mode: 'manual', connectionId: aId },
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(free.status, 201, JSON.stringify(free.data));
        assert.equal(free.data.shotId, null);
        assert.throws(
          () =>
            db()
              .prepare("UPDATE generation_jobs SET lease_id='pool:old-worker' WHERE id=?")
              .run(free.data.id),
          /requires updated generation worker/,
        );
        assert.equal((await tick(free.data.id)).state, 'submitted');
        assert.equal((await tick(free.data.id)).state, 'fetching');
        const freeResult = await tick(free.data.id);
        assert.equal(freeResult.state, 'completed');
        assert.equal(freeResult.takeId, null);
        assert.equal(freeResult.instance.id, aId);
        // New workflow defaults retain the old bound execution path for fixed instances,
        // and reuse the existing checked pool for automatic dispatch and idempotent retry.
        a.mock.queue = { queue_running: [], queue_pending: [] };
        const fixedWorkflow = await create({
          ...fixtureWorkflow(aId),
          name: 'Fixed workflow policy',
          defaultRouting: 'fixed',
        });
        assert.equal(fixedWorkflow.status, 201, JSON.stringify(fixedWorkflow.data));
        const fixedBody = {
          workflowId: fixedWorkflow.data.id,
          positivePrompt: 'Keep this workstation',
          confirmed: true,
        };
        assert.equal(
          (
            await owner(
              'POST',
              `/projects/${project.id}/generation-jobs`,
              { ...fixedBody, routing: { mode: 'auto' } },
              { 'Idempotency-Key': randomUUID() },
            )
          ).data.code,
          'WORKFLOW_INSTANCE_FIXED',
        );
        const fixedJob = await owner('POST', `/projects/${project.id}/generation-jobs`, fixedBody, {
          'Idempotency-Key': randomUUID(),
        });
        assert.equal(fixedJob.status, 201, JSON.stringify(fixedJob.data));
        assert.equal(fixedJob.data.instance, null);
        await tick(fixedJob.data.id);
        await tick(fixedJob.data.id);
        assert.equal((await tick(fixedJob.data.id)).state, 'completed');
        const automaticWorkflow = await create({
          ...fixtureWorkflow(aId),
          name: 'Automatic workflow policy',
          defaultRouting: 'auto',
        });
        assert.equal(automaticWorkflow.status, 201);
        const automaticId = automaticWorkflow.data.id;
        assert.equal(
          (await owner('POST', `/generation-workflows/${automaticId}/instance-checks/${aId}`, {})).status,
          201,
        );
        const automaticBody = {
          workflowId: automaticId,
          positivePrompt: 'Choose a checked workstation',
          confirmed: true,
        };
        const automaticKey = { 'Idempotency-Key': randomUUID() };
        const defaultJob = await owner(
          'POST',
          `/projects/${project.id}/generation-jobs`,
          automaticBody,
          automaticKey,
        );
        assert.equal(defaultJob.status, 201, JSON.stringify(defaultJob.data));
        assert.equal(defaultJob.data.instance.id, aId);
        assert.equal(defaultJob.data.instance.mode, 'auto');
        assert.equal(
          (await owner('POST', `/projects/${project.id}/generation-jobs`, automaticBody, automaticKey)).data
            .id,
          defaultJob.data.id,
        );
        await tick(defaultJob.data.id);
        await tick(defaultJob.data.id);
        assert.equal((await tick(defaultJob.data.id)).state, 'completed');
        const currentVersion = db()
          .prepare('SELECT version FROM generation_connections WHERE id=?')
          .get(aId).version;
        await owner('PATCH', `/generation-connections/${aId}`, {
          expectedVersion: currentVersion,
          enabled: false,
        });
        assert.equal(
          (
            await owner('POST', `/projects/${project.id}/generation-jobs`, fixedBody, {
              'Idempotency-Key': randomUUID(),
            })
          ).data.code,
          'CONNECTION_DISABLED',
        );
        assert.equal(
          (
            await owner('POST', `/projects/${project.id}/generation-jobs`, automaticBody, {
              'Idempotency-Key': randomUUID(),
            })
          ).data.code,
          'INSTANCE_POOL_UNAVAILABLE',
        );
        const fixedSummary = (
          await owner('GET', `/projects/${project.id}/generation-config?workflowId=${fixedWorkflow.data.id}`)
        ).data.pinnedWorkflow;
        assert.equal(fixedSummary.defaultRouting, 'fixed');
      } finally {
        await Promise.all([a.close(), b.close()]);
      }
    });
    await t.test(
      'history pagination and independent backup preserve catalogs and immutable definitions',
      async () => {
        let head = (await owner('GET', `/projects/${project.id}/generation-config`)).data.workflows.find(
          (item) => item.familyId === saved.familyId,
        );
        for (let index = 0; index < 21; index++) {
          const result = await revise({
            expectedVersion: head.catalogVersion,
            summary: `Revision ${index}`,
            definition,
          });
          assert.equal(result.status, 201, JSON.stringify(result.data));
          head = { catalogVersion: (await read(result.data.id)).catalog.version };
        }
        const first = (await owner('GET', `/workflow-catalogs/${saved.familyId}/revisions`)).data,
          next = (
            await owner('GET', `/workflow-catalogs/${saved.familyId}/revisions?before=${first.nextCursor}`)
          ).data;
        assert.equal(first.items.length, 20);
        assert.ok(next.items.length > 0);
        assert.equal(
          new Set([...first.items, ...next.items].map((row) => row.id)).size,
          first.items.length + next.items.length,
        );
        const { backupDatabase } = await import('../dist/db/backup.js');
        const path = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backup'));
        const restored = new DatabaseService({ databasePath: path });
        try {
          for (const name of [
            'workflow_catalogs',
            'workflow_catalog_revisions',
            'generation_workflows',
            'generation_jobs',
            'workflow_release_events',
            'generation_instance_checks',
            'generation_job_routes',
          ]) {
            const key =
              name === 'generation_job_routes'
                ? 'job_id'
                : name === 'workflow_catalog_revisions'
                  ? 'workflow_id'
                  : name === 'generation_instance_checks'
                    ? 'workflow_id,connection_id'
                    : 'id';
            assert.deepEqual(
              restored.sqlite.prepare(`SELECT * FROM ${name} ORDER BY ${key}`).all(),
              db().prepare(`SELECT * FROM ${name} ORDER BY ${key}`).all(),
            );
          }
        } finally {
          restored.onModuleDestroy();
        }
      },
    );
  } finally {
    await app?.close();
    await remote?.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
