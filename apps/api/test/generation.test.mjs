import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import {
  startComfyMock,
  fixtureWorkflow,
  fixtureI2V,
  fixtureParameterized,
} from '../../../tests/fixtures/comfy-mock.mjs';
const execute = promisify(execFile);

test('ComfyUI jobs freeze inputs, recover safely and archive actual image and video drafts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-generation-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'isolated-generation-fixture-token-2026';
  process.env.COOKIE_SECURE = 'false';
  process.env.PROVIDER_MASTER_KEY = '5'.repeat(64);
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { AppConfig } = await import('../dist/config.js');
  const { GenerationWorker } = await import('../dist/generation/generation-worker.js');
  let app,
    remote,
    base,
    project,
    workspace,
    shot,
    prompt,
    connectionId,
    imageWorkflow,
    videoWorkflow,
    viewerId;
  const client = () => {
    let cookies = '',
      csrf = '';
    return async (method, path, body, headers = {}) => {
      const binary = Buffer.isBuffer(body);
      const res = await fetch(base + '/api/v1' + path, {
        method,
        headers: {
          'Content-Type': binary ? 'application/octet-stream' : 'application/json',
          'X-Studio-Request': '1',
          'X-CSRF-Token': csrf,
          Cookie: cookies,
          ...headers,
        },
        body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      });
      const incoming = res.headers.getSetCookie();
      if (incoming.length) cookies = incoming.map((value) => value.split(';')[0]).join('; ');
      if (res.ok && method === 'GET' && path.includes('/content'))
        return { status: res.status, data: Buffer.from(await res.arrayBuffer()) };
      const data = await res.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: res.status, data };
    };
  };
  const owner = client(),
    viewer = client();
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  const queue = (workflowId, key = randomUUID(), actor = owner, imageVersionId) =>
    actor(
      'POST',
      `/shots/${shot.id}/generation-jobs`,
      { workflowId, promptId: prompt.id, imageVersionId, confirmed: true },
      { 'Idempotency-Key': key },
    );
  const read = async (id) => (await owner('GET', `/generation-jobs/${id}`)).data;
  const tick = () => app.get(GenerationWorker).tick();
  const control = (id, action, body = {}) => owner('POST', `/generation-jobs/${id}/${action}`, body);
  const db = () => app.get(DatabaseService).sqlite;
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
        email: 'owner@generation.test',
        password: 'Studio8!',
        name: 'Owner',
        workspaceName: 'Team',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Street scene' })).data;
    const invite = (
      await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: 'viewer@generation.test' })
    ).data;
    viewerId = (
      await viewer('POST', '/invitations/accept', {
        token: invite.token,
        name: 'Viewer',
        password: 'Studio8!',
      })
    ).data.user.id;
    await owner('POST', `/projects/${project.id}/members`, { userId: viewerId, role: 'VIEWER' });
    shot = (
      await owner('POST', `/projects/${project.id}/shots`, {
        description: 'A bicycle passes a storefront.',
        durationHint: 3,
      })
    ).data;
    const editor = (await owner('GET', `/shots/${shot.id}/card/editor`)).data;
    shot = (
      await owner('PATCH', `/shots/${shot.id}/card`, { expectedVersion: shot.version, body: editor.body })
    ).data.shot;
    prompt = (
      await owner('POST', `/shots/${shot.id}/prompts/compile`, {
        mode: 'commit',
        expectedShotVersion: shot.version,
        expectedProjectVersion: project.version,
        profileRevisionId: null,
      })
    ).data;
    await t.test('instance-approved endpoint and remote input/output node validation', async () => {
      const path = `/projects/${project.id}/generation-connections`;
      const input = {
        name: 'Local ComfyUI mock',
        baseUrl: remote.baseUrl,
        trustedPrivate: true,
        token: 'fixture-private-token',
      };
      assert.equal((await viewer('POST', path, input)).status, 403);
      assert.equal((await owner('POST', path, { ...input, trustedPrivate: false })).status, 400);
      const created = await owner('POST', path, input);
      assert.equal(created.status, 201, JSON.stringify(created.data));
      connectionId = created.data.id;
      assert.equal((await owner('POST', `/generation-connections/${connectionId}/test`, {})).status, 201);
      assert.ok(
        !JSON.stringify((await owner('GET', `/projects/${project.id}/generation-config`)).data).includes(
          input.token,
        ),
      );
      assert.ok(
        !db()
          .prepare('SELECT encrypted_secret FROM generation_connections')
          .get()
          .encrypted_secret.includes(input.token),
      );
      const workflowPath = `/projects/${project.id}/generation-workflows`,
        image = fixtureWorkflow(connectionId);
      assert.equal(
        (await owner('POST', workflowPath, { ...image, positive: { node: '9', input: 'text' } })).status,
        400,
      );
      const wrong = structuredClone(image);
      wrong.graph['3'].class_type = 'UnknownNode';
      assert.equal((await owner('POST', workflowPath, wrong)).data.code, 'WORKFLOW_NODE_UNAVAILABLE');
      const result = await owner('POST', workflowPath, image);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      imageWorkflow = result.data.id;
      videoWorkflow = (await owner('POST', workflowPath, fixtureWorkflow(connectionId, true))).data.id;
      assert.equal(
        (await viewer('GET', `/projects/${project.id}/generation-config`)).data.connections.length,
        0,
      );
    });
    await t.test(
      'one idempotent submission survives worker and API restart and archives PNG as a draft',
      async () => {
        assert.equal((await queue(imageWorkflow, randomUUID(), viewer)).status, 403);
        const key = randomUUID();
        const [first, second] = await Promise.all([queue(imageWorkflow, key), queue(imageWorkflow, key)]);
        assert.equal(first.status, 201, JSON.stringify(first.data));
        assert.equal(second.data.id, first.data.id);
        const id = first.data.id;
        assert.equal((await queue(videoWorkflow, key)).data.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal((await queue(videoWorkflow)).data.code, 'GENERATION_ACTIVE');
        const workerFile = fileURLToPath(new URL('../dist/generation-worker.js', import.meta.url));
        await execute(process.execPath, [workerFile, '--once'], { timeout: 25000, windowsHide: true });
        assert.equal((await read(id)).state, 'submitted');
        assert.equal(remote.mock.submissions.length, 1);
        assert.equal(remote.mock.submissions[0].prompt['1'].inputs.text, prompt.rendered.positivePrompt);
        assert.equal(remote.mock.submissions[0].prompt['2'].inputs.text, prompt.rendered.negativePrompt);
        await app.close();
        await start();
        await tick();
        assert.equal((await read(id)).state, 'fetching');
        await tick();
        const complete = await read(id);
        assert.equal(complete.state, 'completed', JSON.stringify(complete));
        assert.ok(complete.takeId);
        const media = (await owner('GET', `/media-versions/${complete.mediaVersionId}`)).data;
        assert.equal(media.origin, 'generation');
        assert.equal(media.mediaType, 'image');
        assert.deepEqual(
          (await owner('GET', media.contentUrl.replace('/api/v1', ''))).data,
          fixtures['image.png'].bytes,
        );
        const takes = (await owner('GET', `/shots/${shot.id}/takes`)).data.items;
        assert.equal(takes.find((take) => take.id === complete.takeId).state, 'draft');
        assert.equal(remote.mock.submissions.length, 1);
      },
    );
    await t.test(
      'lost submit response is reconciled from correlated history without a second POST',
      async () => {
        remote.mock.mode = 'legacy-lost';
        const queued = await queue(videoWorkflow);
        assert.equal(queued.status, 201);
        const id = queued.data.id;
        await tick();
        assert.equal((await read(id)).state, 'needs_reconciliation');
        const oldId = [...remote.mock.history.keys()][0];
        assert.equal((await control(id, 'reconcile', { remoteId: oldId })).status, 201);
        await tick();
        assert.equal((await read(id)).errorCode, 'REMOTE_JOB_UNVERIFIED');
        const actualId = [...remote.mock.history.keys()].at(-1);
        await control(id, 'reconcile', { remoteId: actualId });
        await tick();
        assert.equal((await read(id)).state, 'fetching');
        const uploadCount = db().prepare('SELECT COUNT(*) n FROM media_versions').get().n;
        db().exec(
          "CREATE TRIGGER fixture_job_completion BEFORE INSERT ON audit_events WHEN NEW.action='generation.job.complete' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;",
        );
        try {
          await tick();
          assert.equal((await read(id)).state, 'needs_reconciliation');
        } finally {
          db().exec('DROP TRIGGER fixture_job_completion');
        }
        const upload = db().prepare('SELECT id, state FROM media_uploads WHERE generation_job_id=?').get(id);
        assert.equal(upload.state, 'complete');
        assert.equal(
          (await owner('PUT', `/media-uploads/${upload.id}/content`, Buffer.from('bad'))).status,
          403,
        );
        assert.equal((await owner('POST', `/media-uploads/${upload.id}/reconcile`, {})).status, 403);
        assert.ok(
          !(await owner('GET', `/projects/${project.id}/media-uploads`)).data.items.some(
            (item) => item.id === upload.id,
          ),
        );
        assert.equal(db().prepare('SELECT COUNT(*) n FROM media_versions').get().n, uploadCount + 1);
        const downloads = remote.mock.requests.filter((path) => path === '/view').length;
        await control(id, 'reconcile');
        await tick();
        const complete = await read(id);
        assert.equal(complete.state, 'completed', JSON.stringify(complete));
        assert.equal(remote.mock.requests.filter((path) => path === '/view').length, downloads);
        const media = (await owner('GET', `/media-versions/${complete.mediaVersionId}`)).data;
        assert.equal(media.mediaType, 'video');
        assert.equal(media.metadata.hasAudio, true);
        assert.deepEqual(
          (await owner('GET', media.contentUrl.replace('/api/v1', ''))).data,
          fixtures['clip.mp4'].bytes,
        );
        assert.equal(remote.mock.submissions.length, 2);
        remote.mock.mode = 'normal';
      },
    );
    await t.test(
      'cancel, expired submit lease and unsafe outputs do not trigger unintended writes',
      async () => {
        const canceled = (await queue(imageWorkflow)).data;
        await control(canceled.id, 'cancel');
        assert.equal((await read(canceled.id)).state, 'canceled');
        const expired = (await queue(imageWorkflow)).data;
        db()
          .prepare("UPDATE generation_jobs SET state='submitting',lease_id=?,lease_until=1 WHERE id=?")
          .run(randomUUID(), expired.id);
        await tick();
        assert.equal((await read(expired.id)).state, 'needs_reconciliation');
        assert.equal(remote.mock.submissions.length, 2);
        await control(expired.id, 'stop');
        remote.mock.mode = 'unsafe';
        const unsafe = (await queue(imageWorkflow)).data;
        await tick();
        await tick();
        assert.equal((await read(unsafe.id)).errorCode, 'WORKFLOW_OUTPUT_INVALID');
        assert.equal(
          db().prepare('SELECT COUNT(*) n FROM media_uploads WHERE generation_job_id=?').get(unsafe.id).n,
          0,
        );
        await control(unsafe.id, 'stop');
        assert.equal((await viewer('POST', `/generation-jobs/${unsafe.id}/stop`, {})).status, 403);
        remote.mock.mode = 'normal';
      },
    );
    await t.test(
      'explicit validation failures and uncertain server errors take different paths',
      async () => {
        remote.mock.mode = 'reject';
        const rejected = (await queue(imageWorkflow)).data;
        await tick();
        assert.equal((await read(rejected.id)).state, 'failed');
        assert.equal((await read(rejected.id)).errorCode, 'COMFY_REQUEST_REJECTED');
        remote.mock.mode = 'server-error';
        const uncertain = (await queue(imageWorkflow)).data;
        await tick();
        assert.equal((await read(uncertain.id)).state, 'needs_reconciliation');
        const before = remote.mock.submissions.length;
        await tick();
        assert.equal(remote.mock.submissions.length, before);
        await control(uncertain.id, 'stop');
        remote.mock.mode = 'normal';
      },
    );
    await t.test(
      'image to video sends only the frozen image and archives native SaveVideo history',
      async () => {
        const configPath = `/projects/${project.id}/generation-workflows`;
        const definition = fixtureI2V(connectionId);
        assert.equal(
          (await owner('POST', configPath, { ...definition, image: { node: '1', input: 'image' } })).status,
          400,
        );
        const saved = await owner('POST', configPath, definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const workflowId = saved.data.id;
        assert.equal((await queue(workflowId)).data.code, 'REFERENCE_IMAGE_REQUIRED');
        const imagePage = (await owner('GET', `/projects/${project.id}/generation-images`)).data;
        assert.equal(imagePage.items.length, 1);
        const source = imagePage.items[0];
        const videoId = db().prepare("SELECT id FROM media_versions WHERE media_type='video'").get().id;
        assert.equal(
          (await queue(workflowId, randomUUID(), owner, videoId)).data.code,
          'REFERENCE_IMAGE_INVALID',
        );
        const other = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Other' })).data;
        const bytes = fixtures['image.png'].bytes;
        const intent = (
          await owner(
            'POST',
            `/projects/${other.id}/media-uploads`,
            { fileName: 'cross.png', byteLength: bytes.length },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const foreign = (await owner('PUT', `/media-uploads/${intent.id}/content`, bytes)).data.mediaVersion;
        assert.equal((await queue(workflowId, randomUUID(), owner, foreign.id)).status, 404);
        const key = randomUUID();
        const queued = await queue(workflowId, key, owner, source.id);
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        assert.equal(queued.data.image.id, source.id);
        assert.equal((await queue(workflowId, key, owner, foreign.id)).data.code, 'IDEMPOTENCY_CONFLICT');
        await tick();
        assert.equal((await read(queued.data.id)).state, 'submitted');
        const upload = remote.mock.uploads.at(-1);
        assert.equal(upload.overwrite, 'false');
        assert.equal(upload.type, 'input');
        assert.deepEqual(upload.bytes, bytes);
        assert.equal(
          remote.mock.submissions.at(-1).prompt['4'].inputs.image,
          `pullet-studio/${queued.data.id}.png`,
        );
        assert.equal(
          JSON.parse(
            db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(queued.data.id)
              .snapshot_json,
          ).image.id,
          source.id,
        );
        await tick();
        await tick();
        assert.equal((await read(queued.data.id)).state, 'completed');
        const count = remote.mock.submissions.length;
        remote.mock.mode = 'unsafe-upload';
        const invalid = (await queue(workflowId, randomUUID(), owner, source.id)).data;
        await tick();
        assert.equal((await read(invalid.id)).errorCode, 'COMFY_IMAGE_UPLOAD_INVALID');
        assert.equal(remote.mock.submissions.length, count);
        remote.mock.mode = 'normal';

        const custom = structuredClone(definition);
        custom.name = 'Custom image loader';
        custom.image = { node: '4', input: 'source.file' };
        custom.graph['4'] = { class_type: 'Plain Filename', inputs: { 'source.file': 'placeholder.png' } };
        const incompatible = await owner('POST', configPath, custom);
        assert.equal(incompatible.data.code, 'WORKFLOW_IMAGE_BINDING_INVALID');
        custom.graph['4'].class_type = 'Custom Input';
        const customSaved = await owner('POST', configPath, custom);
        assert.equal(customSaved.status, 201, JSON.stringify(customSaved.data));
        const customJob = await queue(customSaved.data.id, randomUUID(), owner, source.id);
        assert.equal(customJob.status, 201);
        await tick();
        assert.equal(
          remote.mock.submissions.at(-1).prompt['4'].inputs['source.file'],
          `pullet-studio/${customJob.data.id}.png`,
        );
        await tick();
        await tick();
        assert.equal((await read(customJob.data.id)).state, 'completed');
      },
    );
    await t.test(
      'parameter bindings validate constants, distinct targets and remote constraints',
      async () => {
        const path = `/projects/${project.id}/generation-workflows`;
        const original = fixtureParameterized(connectionId);
        for (const mutate of [
          (w) => {
            w.parameters[0].node = 'missing';
          },
          (w) => {
            w.graph['7'].inputs.value = ['1', 0];
          },
          (w) => {
            w.graph['8'].inputs.noise_seed = Number.MAX_SAFE_INTEGER + 1;
          },
          (w) => {
            w.parameters[1].min = 31;
          },
          (w) => {
            w.parameters[0].options[1].value = w.parameters[0].options[0].value;
          },
          (w) => {
            w.parameters[2] = { ...w.parameters[1] };
          },
          (w) => {
            w.parameters[0].node = '1';
            w.parameters[0].input = 'text';
            w.parameters[0].options[0].value = w.graph['1'].inputs.text;
          },
          (w) => {
            w.parameters[2].node = '7';
            w.parameters[2].input = 'value';
          },
          (w) => {
            w.capability = 'image.text_to_image';
          },
        ]) {
          const input = structuredClone(original);
          mutate(input);
          const response = await owner('POST', path, input);
          assert.equal(response.status, 400, JSON.stringify(response.data));
        }
        for (const mutate of [
          (w) => {
            w.parameters[0].options[1].value = 'unsupported';
          },
          (w) => {
            w.parameters[1].max = 31;
          },
          (w) => {
            w.graph['8'].class_type = 'SecondsInput';
            w.graph['8'].inputs = { value: 37 };
            w.parameters[2].input = 'value';
          },
        ]) {
          const input = structuredClone(original);
          mutate(input);
          assert.equal((await owner('POST', path, input)).data.code, 'WORKFLOW_PARAMETER_BINDING_INVALID');
        }
        // A STRING primitive can carry a custom workflow's aspect ratio as well.
        const stringInput = structuredClone(original);
        stringInput.graph['6'] = { class_type: 'Text', inputs: { text: '1:1 (Square)' } };
        stringInput.parameters[0].input = 'text';
        assert.equal((await owner('POST', path, stringInput)).status, 201);
        assert.equal((await viewer('POST', path, original)).status, 403);
      },
    );
    await t.test(
      'parameters freeze across restart, preserve frame expressions and distinguish retries',
      async () => {
        const workflow = fixtureParameterized(connectionId);
        const saved = await owner('POST', `/projects/${project.id}/generation-workflows`, workflow);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const id = saved.data.id;
        const config = (await viewer('GET', `/projects/${project.id}/generation-config`)).data;
        const publicWorkflow = config.workflows.find((item) => item.id === id);
        assert.equal(publicWorkflow.parameters[1].defaultValue, 2.5);
        assert.equal(publicWorkflow.parameters[2].defaultValue, 37);
        assert.equal(publicWorkflow.graph, undefined);
        assert.equal(publicWorkflow.definitionJson, undefined);
        const submit = (values, key = randomUUID(), workflowId = id) =>
          owner(
            'POST',
            `/shots/${shot.id}/generation-jobs`,
            {
              workflowId,
              promptId: prompt.id,
              confirmed: true,
              ...(values === undefined ? {} : { parameterValues: values }),
            },
            { 'Idempotency-Key': key },
          );
        const defaults = await submit();
        assert.equal(defaults.status, 201, JSON.stringify(defaults.data));
        assert.deepEqual(defaults.data.parameterValues, {
          aspectRatio: '1:1 (Square)',
          durationSeconds: 2.5,
          seed: 37,
        });
        const stored = db()
          .prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?')
          .get(defaults.data.id);
        assert.equal(JSON.parse(stored.snapshot_json).graph['8'].inputs.noise_seed, 37);
        await control(defaults.data.id, 'cancel');
        for (const values of [
          { seed: -1 },
          { seed: 1.2 },
          { seed: 4294967296 },
          { seed: Number.MAX_SAFE_INTEGER + 1 },
          { durationSeconds: 0 },
          { durationSeconds: 31 },
          { durationSeconds: 2.25 },
          { durationSeconds: '' },
          { durationSeconds: null },
          { aspectRatio: '16:9' },
          { width: 640 },
        ])
          assert.equal((await submit(values)).status, 400, JSON.stringify(values));
        assert.equal(
          (await submit({ seed: 1 }, randomUUID(), videoWorkflow)).data.code,
          'WORKFLOW_PARAMETER_INVALID',
        );
        const key = randomUUID();
        const requested = { aspectRatio: '16:9 (Landscape)', durationSeconds: 3.5, seed: 0 };
        const queued = await submit(requested, key);
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        assert.equal(
          (await submit({ seed: 0, durationSeconds: 3.5, aspectRatio: '16:9 (Landscape)' }, key)).data.id,
          queued.data.id,
        );
        assert.equal((await submit({ ...requested, seed: 1 }, key)).data.code, 'IDEMPOTENCY_CONFLICT');
        assert.equal(
          (await submit({ ...requested, durationSeconds: 4 }, key)).data.code,
          'IDEMPOTENCY_CONFLICT',
        );
        await app.close();
        await start();
        const before = remote.mock.submissions.length;
        await tick();
        assert.equal(remote.mock.submissions.length, before + 1);
        const graph = remote.mock.submissions.at(-1).prompt;
        assert.equal(graph['6'].inputs.aspect_ratio, requested.aspectRatio);
        assert.equal(graph['7'].inputs.value, 3.5);
        assert.equal(graph['8'].inputs.noise_seed, 0);
        assert.deepEqual(graph['9'], workflow.graph['9']);
        await tick();
        await tick();
        const completed = await read(queued.data.id);
        assert.equal(completed.state, 'completed', JSON.stringify(completed));
        assert.deepEqual(completed.parameterValues, requested);
        const media = (await owner('GET', `/media-versions/${completed.mediaVersionId}`)).data;
        assert.deepEqual(completed.result.metadata, media.metadata);
        assert.ok(completed.result.metadata.width > 0);
        assert.ok(completed.result.metadata.durationMs > 0);
        const reviewPath = `/takes/${completed.takeId}/reviews`;
        const submittedReview = await owner(
          'POST',
          reviewPath,
          {
            action: 'submit',
            reason: 'Review frozen generation output.',
            expectedDecisionVersion: 0,
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(submittedReview.status, 201, JSON.stringify(submittedReview.data));
        const review = (await owner('GET', reviewPath)).data;
        assert.equal(review.context.generationJobId, completed.id);
        assert.equal(review.context.promptId, prompt.id);
        assert.equal(review.source.shotVersion, shot.version);
        assert.equal(
          (
            await owner(
              'POST',
              reviewPath,
              {
                action: 'approve',
                reason: 'Accept returned output.',
                expectedDecisionVersion: 1,
              },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await owner(
              'POST',
              `/shots/${shot.id}/take-selection`,
              {
                takeId: completed.takeId,
                expectedSelectionVersion: 0,
                reason: 'Deliver selected output.',
              },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          201,
        );
        const packagePath = `/projects/${project.id}/media-packages`;
        const scope = { type: 'shots', shotIds: [shot.id] };
        const preflight = (await owner('POST', packagePath + '/preview', { scope })).data;
        const exported = await owner(
          'POST',
          packagePath,
          { scope, expectedSnapshotHash: preflight.snapshotHash },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(exported.status, 201, JSON.stringify(exported.data));
        const delivered = (await owner('GET', `/media-packages/${exported.data.id}`)).data.manifest;
        assert.deepEqual(delivered.shots[0].source.parameterValues, requested);
        assert.equal(delivered.shots[0].source.prompt.id, prompt.id);
        assert.equal(delivered.shots[0].source.workflow.id, id);
        assert.equal(delivered.shots[0].source.workflow.graph, undefined);
        assert.ok(!JSON.stringify(delivered).includes('fixture-private-token'));
        const legacy = (await owner('GET', `/shots/${shot.id}/generation-jobs`)).data.find(
          (item) => item.workflowName === 'Mock image',
        );
        assert.deepEqual(legacy.parameterValues, {});
        const { generationJobs } = await import('../dist/db/schema.js');
        const database = app.get(DatabaseService).db;
        const oldRow = database
          .select()
          .from(generationJobs)
          .all()
          .find((row) => row.id === legacy.id);
        const oldSnapshot = JSON.parse(oldRow.snapshotJson);
        delete oldSnapshot.parameterValues;
        const legacyId = randomUUID(),
          legacyKey = randomUUID();
        database
          .insert(generationJobs)
          .values({
            ...oldRow,
            id: legacyId,
            requestKey: legacyKey,
            state: 'canceled',
            snapshotJson: JSON.stringify(oldSnapshot),
            mediaVersionId: null,
            takeId: null,
          })
          .run();
        assert.deepEqual((await read(legacyId)).parameterValues, {});
        assert.equal((await submit(undefined, legacyKey, imageWorkflow)).data.id, legacyId);
        assert.equal((await submit({}, key)).data.code, 'IDEMPOTENCY_CONFLICT');
        const defaultReplayKey = db()
          .prepare('SELECT request_key FROM generation_jobs WHERE id=?')
          .get(defaults.data.id).request_key;
        assert.equal(
          (await submit(defaults.data.parameterValues, defaultReplayKey)).data.id,
          defaults.data.id,
        );
      },
    );
    await t.test('changed approvals prevent submission and removal revokes job reads', async () => {
      const entity = (
        await owner(
          'POST',
          `/projects/${project.id}/entities`,
          { kind: 'character', body: { name: 'Cyclist' } },
          { 'Idempotency-Key': randomUUID() },
        )
      ).data;
      shot = (
        await owner('POST', `/shots/${shot.id}/asset-bindings`, {
          expectedShotCardVersion: shot.version,
          bindings: [{ revisionId: entity.revision.id, purpose: 'Cyclist' }],
        })
      ).data.shot;
      prompt = (
        await owner('POST', `/shots/${shot.id}/prompts/compile`, {
          mode: 'commit',
          expectedShotVersion: shot.version,
          expectedProjectVersion: project.version,
          profileRevisionId: null,
        })
      ).data;
      assert.equal((await queue(imageWorkflow)).data.code, 'ASSET_NOT_READY');
      const path = `/entities/${entity.id}/revisions/1/decisions`;
      const decide = (action, expectedDecisionVersion) =>
        owner(
          'POST',
          path,
          { action, expectedDecisionVersion, reason: 'Fixture review' },
          { 'Idempotency-Key': randomUUID() },
        );
      assert.equal((await decide('approve', 0)).status, 201);
      const queued = await queue(imageWorkflow);
      assert.equal(queued.status, 201);
      await decide('revoke', 1);
      const before = remote.mock.submissions.length;
      await tick();
      assert.equal((await read(queued.data.id)).errorCode, 'ASSET_NOT_READY');
      assert.equal(remote.mock.submissions.length, before);
      const visible = await viewer('GET', `/generation-jobs/${queued.data.id}`);
      assert.equal(visible.status, 200);
      assert.equal(visible.data.canControl, false);
      await owner('DELETE', `/projects/${project.id}/members/${viewerId}`, { expectedRole: 'VIEWER' });
      assert.equal((await viewer('GET', `/generation-jobs/${queued.data.id}`)).status, 404);
    });
  } finally {
    if (app) await app.close();
    if (remote) await remote.close();
    await rm(directory, { recursive: true, force: true });
  }
});
