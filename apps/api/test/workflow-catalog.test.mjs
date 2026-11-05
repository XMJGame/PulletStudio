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
      const data = await result.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: result.status, data };
    };
  }
  const owner = client(),
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
  const queue = (workflowId, fieldValues, key = randomUUID()) =>
    owner(
      'POST',
      `/shots/${shot.id}/generation-jobs`,
      { workflowId, promptId: prompt.id, confirmed: true, ...(fieldValues ? { fieldValues } : {}) },
      { 'Idempotency-Key': key },
    );
  try {
    const fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    remote = await startComfyMock({ 'image.png': fixtures['image.png'].bytes });
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
          ]) {
            const key = name === 'workflow_catalog_revisions' ? 'workflow_id' : 'id';
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
