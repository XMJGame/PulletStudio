import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fixtureWorkflow,
  fixtureI2V,
  fixtureMediaSchema,
  startComfyMock,
} from '../../../tests/fixtures/comfy-mock.mjs';
import { workflowInput, renderWorkflow } from '../dist/generation/generation-contract.js';
import { mediaInputMatchesMetadata } from '../dist/generation/workflow-media.js';

test('media declarations preserve legacy definitions and refuse unsupported rendering', () => {
  for (const fixture of [fixtureWorkflow, fixtureI2V]) {
    const legacy = fixture(randomUUID());
    assert.deepEqual(workflowInput.parse(legacy), legacy);
    assert.ok(renderWorkflow(legacy, 'A landscape', ''));
  }
  const declared = workflowInput.parse(fixtureMediaSchema(randomUUID()));
  assert.throws(
    () => renderWorkflow(declared, 'A landscape', ''),
    (error) => error.getStatus() === 409 && error.getResponse().code === 'WORKFLOW_MEDIA_UNSUPPORTED',
  );
  assert.ok(
    renderWorkflow(
      { ...declared, mediaSchema: { version: 'studio.workflow-media.v1', inputs: [], outputs: [] } },
      'A landscape',
      '',
    ),
  );
});

const invalidDeclarations = [
  [
    'unknown schema version',
    (w) => {
      w.mediaSchema.version = 'unknown';
    },
  ],
  [
    'duplicate field identifiers',
    (w) => {
      w.mediaSchema.inputs[1].id = w.mediaSchema.inputs[0].id;
    },
  ],
  [
    'identifier overlap with outputs',
    (w) => {
      w.mediaSchema.outputs[0].id = w.mediaSchema.inputs[0].id;
    },
  ],
  [
    'duplicate input targets',
    (w) => {
      w.mediaSchema.inputs.push({ ...w.mediaSchema.inputs[0], id: randomUUID() });
    },
  ],
  [
    'prompt overwrite',
    (w) => {
      Object.assign(w.mediaSchema.inputs[0], w.positive);
    },
  ],
  [
    'missing target',
    (w) => {
      w.mediaSchema.inputs[0].node = 'missing';
    },
  ],
  [
    'linked target',
    (w) => {
      Object.assign(w.mediaSchema.inputs[0], { node: '3', input: 'conditioning' });
    },
  ],
  [
    'required empty handling',
    (w) => {
      w.mediaSchema.inputs[0].onMissing = 'empty';
    },
  ],
  [
    'optional default path fallback',
    (w) => {
      w.mediaSchema.inputs[1].onMissing = 'use_default';
    },
  ],
  [
    'video mask',
    (w) => {
      w.mediaSchema.inputs[1].role = 'mask';
    },
  ],
  [
    'missing output node',
    (w) => {
      w.mediaSchema.outputs[0].node = 'missing';
    },
  ],
  [
    'primary output overwrite',
    (w) => {
      Object.assign(w.mediaSchema.outputs[0], w.output);
    },
  ],
  [
    'output path traversal',
    (w) => {
      w.mediaSchema.outputs[0].field = '../videos';
    },
  ],
  [
    'hidden credential binding',
    (w) => {
      w.graph['6'].inputs.api_key = 'private';
      w.mediaSchema.inputs[0].input = 'api_key';
    },
  ],
  [
    'too many slots',
    (w) => {
      w.mediaSchema.inputs = Array.from({ length: 33 }, () => ({
        ...w.mediaSchema.inputs[0],
        id: randomUUID(),
      }));
    },
  ],
  [
    'scalar field collision',
    (w) => {
      w.fields = [
        { id: randomUUID(), label: 'Note', node: '6', input: 'image', type: 'text', maxLength: 100 },
      ];
    },
  ],
];
for (const [label, mutate] of invalidDeclarations)
  test(`media contract rejects ${label}`, () => {
    const workflow = fixtureMediaSchema(randomUUID());
    mutate(workflow);
    assert.equal(workflowInput.safeParse(workflow).success, false);
  });

test('media upload declarations require exact types and explicit file widgets', () => {
  for (const type of ['image', 'video', 'audio']) {
    assert.equal(mediaInputMatchesMetadata(type, ['STRING', { [`${type}_upload`]: true }]), true);
    assert.equal(mediaInputMatchesMetadata(type, [[], { [`${type}_upload`]: true }]), true);
    assert.equal(mediaInputMatchesMetadata(type, ['STRING', { file_upload: true }]), false);
    assert.equal(mediaInputMatchesMetadata(type, ['INT', { [`${type}_upload`]: true }]), false);
    assert.equal(mediaInputMatchesMetadata(type, ['STRING']), false);
  }
  assert.equal(mediaInputMatchesMetadata('audio', ['STRING', { video_upload: true }]), false);
});

test('versioned media profiles remain private, immutable and unable to enter the generation queue', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-workflow-media-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'isolated-workflow-media-setup-2026';
  process.env.COOKIE_SECURE = 'false';
  process.env.PROVIDER_MASTER_KEY = '5'.repeat(64);
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  let app, base;
  const remote = await startComfyMock({});
  function client() {
    let cookies = '',
      csrf = '';
    return async (method, path, body, key = randomUUID()) => {
      const response = await fetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Studio-Request': '1',
          'X-CSRF-Token': csrf,
          Cookie: cookies,
          'Idempotency-Key': key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.getSetCookie().length)
        cookies = response.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; ');
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  }
  const owner = client(),
    reader = client();
  try {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
    const initialized = await owner('POST', '/setup/initialize', {
      setupToken: process.env.SETUP_TOKEN,
      email: 'owner@media-contract.test',
      name: 'Creator',
      password: 'Studio8!',
      workspaceName: 'Media contracts',
    });
    assert.equal(initialized.status, 201);
    const workspace = initialized.data.workspace;
    const project = (
      await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Media declaration study' })
    ).data;
    const connection = (
      await owner('POST', `/projects/${project.id}/generation-connections`, {
        name: 'Isolated mock',
        baseUrl: remote.baseUrl,
        trustedPrivate: true,
        token: 'private-test-token',
      })
    ).data;
    const definition = fixtureMediaSchema(connection.id);
    const saved = await owner('POST', `/projects/${project.id}/generation-workflows`, definition);
    assert.equal(saved.status, 201, JSON.stringify(saved.data));
    const original = (await owner('GET', `/generation-workflows/${saved.data.id}/definition`)).data;
    assert.deepEqual(original.definition.mediaSchema, definition.mediaSchema);
    const db = app.get(DatabaseService).sqlite;
    const originalJson = db
      .prepare('SELECT definition_json FROM generation_workflows WHERE id=?')
      .get(saved.data.id).definition_json;
    await t.test('new revisions preserve order, identifiers and old JSON', async () => {
      const changed = structuredClone(definition);
      changed.mediaSchema.inputs.reverse();
      changed.mediaSchema.inputs[0].label = 'Updated sound reference';
      const revised = await owner('POST', `/workflow-catalogs/${saved.data.familyId}/revisions`, {
        expectedVersion: 1,
        summary: 'Reorder input slots',
        definition: changed,
      });
      assert.equal(revised.status, 201, JSON.stringify(revised.data));
      assert.deepEqual(
        (await owner('GET', `/generation-workflows/${revised.data.id}/definition`)).data.definition
          .mediaSchema,
        changed.mediaSchema,
      );
      assert.equal(
        db.prepare('SELECT definition_json FROM generation_workflows WHERE id=?').get(saved.data.id)
          .definition_json,
        originalJson,
      );
    });
    await t.test(
      'remote type mismatch and scalar filename widgets cannot be disguised as media slots',
      async () => {
        const changed = structuredClone(definition);
        changed.mediaSchema.inputs[0].mediaType = 'audio';
        const rejected = await owner('POST', `/projects/${project.id}/generation-workflows`, changed);
        assert.equal(rejected.status, 400);
        assert.equal(rejected.data.code, 'WORKFLOW_MEDIA_BINDING_INVALID');
        const output = structuredClone(definition);
        output.mediaSchema.outputs[0].node = '6';
        assert.equal(
          (await owner('POST', `/projects/${project.id}/generation-workflows`, output)).status,
          400,
        );
      },
    );
    await t.test(
      'project, trial and saved Board execution all reject before any job or remote submission',
      async () => {
        const count = db.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get().n;
        for (const path of [
          `/projects/${project.id}/generation-jobs`,
          `/projects/${project.id}/workflow-trials`,
        ]) {
          const rejected = await owner('POST', path, {
            workflowId: saved.data.id,
            positivePrompt: 'A quiet coast',
            confirmed: true,
          });
          assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
          assert.equal(rejected.data.code, 'WORKFLOW_MEDIA_UNSUPPORTED');
        }
        const board = (
          await owner('POST', `/projects/${project.id}/boards`, { title: 'Media configuration board' })
        ).data;
        const note = randomUUID(),
          node = randomUUID();
        const layout = {
          ...board.layout,
          nodes: [
            {
              id: note,
              type: 'note',
              position: { x: 0, y: 0 },
              width: 250,
              height: 200,
              data: { text: 'A quiet coast' },
            },
            {
              id: node,
              type: 'generation',
              position: { x: 300, y: 0 },
              width: 250,
              height: 200,
              data: { generation: { workflowId: saved.data.id } },
            },
          ],
          edges: [
            {
              id: randomUUID(),
              source: note,
              target: node,
              kind: 'input_binding',
              sourcePort: 'text',
              targetPort: 'prompt',
            },
          ],
        };
        const updated = await owner('POST', `/boards/${board.id}/revisions`, {
          title: board.title,
          expectedRevision: board.revision,
          layout,
        });
        assert.equal(updated.status, 201);
        const rejected = await owner('POST', `/boards/${board.id}/nodes/${node}/generation-jobs`, {
          expectedRevision: updated.data.revision,
          confirmed: true,
        });
        assert.equal(rejected.status, 409);
        assert.equal(rejected.data.code, 'WORKFLOW_MEDIA_UNSUPPORTED');
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM generation_jobs').get().n, count);
        assert.equal(remote.submissions.length, 0);
        assert.equal(remote.uploads.length, 0);
      },
    );
    await t.test(
      'read-only summaries omit technical targets and configuration remains restricted',
      async () => {
        const invitation = (
          await owner('POST', `/workspaces/${workspace.id}/invitations`, {
            email: 'reader@media-contract.test',
          })
        ).data;
        const accepted = (
          await reader('POST', '/invitations/accept', {
            token: invitation.token,
            name: 'Reader',
            password: 'Studio8!',
          })
        ).data;
        await owner('POST', `/projects/${project.id}/members`, { userId: accepted.user.id, role: 'VIEWER' });
        const config = await reader('GET', `/projects/${project.id}/generation-config`);
        assert.equal(config.status, 200);
        const workflow = config.data.workflows[0];
        assert.equal(workflow.executable, false);
        assert.equal(workflow.mediaSchema.inputs.length, 3);
        assert.ok(!JSON.stringify(config.data).includes('private-reference'));
        assert.ok(!JSON.stringify(config.data).includes('private-test-token'));
        assert.ok(!Object.hasOwn(workflow.mediaSchema.inputs[0], 'node'));
        assert.ok(!Object.hasOwn(workflow.mediaSchema.outputs[0], 'field'));
        assert.equal((await reader('GET', `/generation-workflows/${saved.data.id}/definition`)).status, 403);
        assert.equal(
          (await reader('POST', `/projects/${project.id}/generation-workflows`, definition)).status,
          403,
        );
      },
    );
  } finally {
    await app?.close();
    await remote.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  }
});
