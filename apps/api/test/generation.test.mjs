import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';
import { readPackageZip } from '../../../tests/fixtures/read-zip.mjs';
import { createHash } from 'node:crypto';
import {
  startComfyMock,
  fixtureWorkflow,
  fixtureI2V,
  fixtureParameterized,
  fixtureReferenceImages,
  fixtureOptionalImages,
  fixtureRequiredMedia,
  fixtureOptionalMedia,
  fixtureExtendedOutputs,
  fixturePrimaryBatch,
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
      if (
        res.ok &&
        method === 'GET' &&
        (path.includes('/content') || res.headers.get('content-type')?.startsWith('application/zip'))
      )
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
      'sound.mp3': fixtures['sound.mp3'].bytes,
      'image.jpg': fixtures['image.jpg'].bytes,
      'extra.png': fixtures['image.png'].bytes,
      'clip2.mp4': fixtures['clip.mp4'].bytes,
      'sound2.mp3': fixtures['sound.mp3'].bytes,
      ...Object.fromEntries(
        Array.from({ length: 40 }, (_, i) => ['batch' + i + '.png', fixtures['image.png'].bytes]),
      ),
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
      'multiple fixed reference images survive preparation recovery and archive one result',
      async () => {
        const definition = fixtureReferenceImages(connectionId);
        const projectPath = `/projects/${project.id}`;
        const saved = await owner('POST', `${projectPath}/generation-workflows`, definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const [character, scene] = definition.mediaSchema.inputs;
        const first = (await owner('GET', `${projectPath}/generation-images`)).data.items[0];
        const bytes = fixtures['image.jpg'].bytes;
        async function upload(projectId) {
          const intent = await owner(
            'POST',
            `/projects/${projectId}/media-uploads`,
            { fileName: 'reference.jpg', byteLength: bytes.length },
            { 'Idempotency-Key': randomUUID() },
          );
          const result = await owner('PUT', `/media-uploads/${intent.data.id}/content`, bytes);
          assert.equal(result.status, 200, JSON.stringify(result.data));
          return result.data.mediaVersion;
        }
        const second = await upload(project.id);
        const foreignProject = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Reference isolation' })
        ).data;
        const foreign = await upload(foreignProject.id);
        const videoId = db()
          .prepare("SELECT id FROM media_versions WHERE project_id=? AND media_type='video'")
          .get(project.id).id;
        const body = { workflowId: saved.data.id, positivePrompt: 'Two references', confirmed: true };
        const submit = (refs, key = randomUUID(), actor = owner, endpoint = 'generation-jobs') =>
          actor(
            'POST',
            `${projectPath}/${endpoint}`,
            { ...body, referenceImageVersions: refs },
            { 'Idempotency-Key': key },
          );
        assert.equal((await submit({ [character.id]: first.id })).data.code, 'REFERENCE_SLOT_REQUIRED');
        assert.equal((await submit({ [randomUUID()]: first.id })).data.code, 'REFERENCE_SLOT_UNKNOWN');
        assert.equal((await submit({ [character.id]: first.id, [scene.id]: foreign.id })).status, 404);
        assert.equal(
          (await submit({ [character.id]: first.id, [scene.id]: videoId })).data.code,
          'REFERENCE_IMAGE_INVALID',
        );
        const refs = { [scene.id]: second.id, [character.id]: first.id };
        const key = randomUUID();
        const queued = await submit(refs, key);
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        const id = queued.data.id;
        assert.equal((await submit({ [character.id]: first.id, [scene.id]: second.id }, key)).data.id, id);
        assert.equal(
          (await submit({ [character.id]: second.id, [scene.id]: first.id }, key)).data.code,
          'IDEMPOTENCY_CONFLICT',
        );
        assert.deepEqual(
          queued.data.referenceImages.map((item) => item.slotId),
          [character.id, scene.id],
        );
        assert.ok(!JSON.stringify(queued.data).includes('sha256'));
        assert.throws(
          () => db().prepare("UPDATE generation_jobs SET lease_id='free:old' WHERE id=?").run(id),
          /updated generation worker/,
        );
        const snapshot = () =>
          db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(id).snapshot_json;
        const frozen = snapshot();
        assert.deepEqual(
          JSON.parse(frozen).referenceImages.map((item) => item.id),
          [first.id, second.id],
        );
        assert.equal(JSON.parse(frozen).graph['6'].inputs.image, '');
        db()
          .prepare(
            "UPDATE generation_jobs SET state='preparing', lease_id='free:media-v1:expired', lease_until=0 WHERE id=?",
          )
          .run(id);
        const before = remote.mock.submissions.length;
        remote.mock.mode = 'lost';
        await tick();
        assert.equal((await read(id)).state, 'needs_reconciliation');
        assert.equal(remote.mock.submissions.length, before + 1);
        const graph = remote.mock.submissions.at(-1).prompt;
        assert.equal(graph['6'].inputs.image, `pullet-studio/${id}-${character.id}.png`);
        assert.equal(graph['7'].inputs.image, `pullet-studio/${id}-${scene.id}.jpg`);
        assert.deepEqual(remote.mock.uploads.at(-2).bytes, fixtures['image.png'].bytes);
        assert.deepEqual(remote.mock.uploads.at(-1).bytes, bytes);
        remote.mock.mode = 'normal';
        assert.equal((await owner('POST', `/generation-jobs/${id}/reconcile`, {})).status, 201);
        await tick();
        await tick();
        assert.equal((await read(id)).state, 'completed');
        assert.equal(remote.mock.submissions.length, before + 1);
        assert.equal(snapshot(), frozen);
        assert.equal(
          (await owner('POST', `/generation-jobs/${id}/save-to-library`, {})).data.inLibrary,
          true,
        );

        const trial = await submit(refs, randomUUID(), owner, 'workflow-trials');
        assert.equal(trial.status, 201, JSON.stringify(trial.data));
        await tick();
        await tick();
        await tick();
        assert.equal((await read(trial.data.id)).state, 'test_completed');
        const evidence = (await read(trial.data.id)).mediaVersionId;
        assert.equal((await submit({ ...refs, [scene.id]: evidence })).data.code, 'REFERENCE_IMAGE_INVALID');

        const artist = client();
        const invitation = (
          await owner('POST', `/workspaces/${workspace.id}/invitations`, {
            email: 'reference-artist@generation.test',
          })
        ).data;
        const joined = await artist('POST', '/invitations/accept', {
          token: invitation.token,
          name: 'Reference artist',
          password: 'Studio8!',
        });
        const memberId = joined.data.user.id;
        const membership = `${projectPath}/members`;
        assert.equal((await owner('POST', membership, { userId: memberId, role: 'EDITOR' })).status, 201);
        const revoked = await submit(refs, randomUUID(), artist);
        assert.equal(revoked.status, 201, JSON.stringify(revoked.data));
        const uploadsBefore = remote.mock.uploads.length;
        const submitsBefore = remote.mock.submissions.length;
        remote.mock.afterUpload = async () => {
          const removal = await owner('DELETE', `${membership}/${memberId}`, { expectedRole: 'EDITOR' });
          assert.equal(removal.status, 200);
        };
        try {
          await tick();
        } finally {
          remote.mock.afterUpload = undefined;
        }
        assert.equal((await read(revoked.data.id)).state, 'failed');
        assert.equal(remote.mock.uploads.length, uploadsBefore + 1);
        assert.equal(remote.mock.submissions.length, submitsBefore);
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
    await t.test(
      'ModelScope submits a saved board node once, resumes polling and archives the image',
      async () => {
        const { ModelScopeProvider, modelScopeImage } =
          await import('../dist/generation/modelscope-provider.js');
        const blocked = new ModelScopeProvider({
          resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        });
        await assert.rejects(
          blocked.download({ url: 'https://images.example.test/out.png' }, 1024, AbortSignal.timeout(2000)),
          { code: 'MODELSCOPE_ADDRESS_BLOCKED' },
        );
        const workspacePath = `/workspaces/${workspace.id}/modelscope-generation`;
        const projectPath = `/projects/${project.id}`;
        const token = 'fixture-modelscope-secret';
        assert.equal((await viewer('POST', workspacePath, { token })).status, 403);
        assert.equal(
          (await owner('POST', projectPath + '/modelscope-generation')).data.code,
          'MODELSCOPE_KEY_REQUIRED',
        );
        assert.equal((await owner('POST', workspacePath, { token })).status, 201);
        const credential = (await owner('GET', workspacePath)).data;
        assert.equal(credential.configured, true);
        assert.ok(!JSON.stringify(credential).includes(token));
        const { id: workflowId } = (await owner('POST', projectPath + '/modelscope-generation')).data;
        assert.equal((await owner('POST', projectPath + '/modelscope-generation')).data.id, workflowId);
        const config = (await owner('GET', projectPath + '/generation-config?workflowId=' + workflowId)).data;
        assert.equal(config.pinnedWorkflow.provider, 'modelscope');
        assert.ok(!config.workflows.some((workflow) => workflow.id === workflowId));
        const key = () => ({ 'Idempotency-Key': randomUUID() });
        const board = (await owner('POST', projectPath + '/boards', { title: 'API image test' }, key())).data;
        const nodeId = randomUUID();
        const noteId = randomUUID();
        const positivePrompt = 'A red ceramic sphere';
        const saved = await owner(
          'POST',
          `/boards/${board.id}/revisions`,
          {
            title: board.title,
            expectedRevision: board.revision,
            layout: {
              ...board.layout,
              nodes: [
                {
                  id: noteId,
                  type: 'note',
                  position: { x: 0, y: 0 },
                  width: 240,
                  height: 160,
                  data: { text: positivePrompt },
                },
                {
                  id: nodeId,
                  type: 'generation',
                  position: { x: 280, y: 0 },
                  width: 240,
                  height: 160,
                  data: { generation: { workflowId } },
                },
              ],
              edges: [
                {
                  id: randomUUID(),
                  kind: 'input_binding',
                  source: noteId,
                  target: nodeId,
                  sourcePort: 'text',
                  targetPort: 'prompt',
                },
              ],
            },
          },
          key(),
        );
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const jobPath = `/boards/${board.id}/nodes/${nodeId}/generation-jobs`;
        const run = (requestKey = key()) =>
          owner(
            'POST',
            jobPath,
            {
              expectedRevision: saved.data.revision,
              confirmed: true,
            },
            requestKey,
          );
        const once = key();
        const queued = await run(once);
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        const id = queued.data.id;
        assert.equal((await run(once)).data.id, id);
        assert.throws(
          () => db().prepare("UPDATE generation_jobs SET lease_id='free:old' WHERE id=?").run(id),
          /MODEL_SCOPE_WORKER_UPGRADE_REQUIRED/,
        );
        const output = 'https://images.example.test/signed.png?signature=fixture';
        const bytes = fixtures['image.png'].bytes;
        let submissions = 0,
          polls = 0;
        const transport = app.get(ModelScopeProvider);
        transport.send = async (url, _signal, headers, body) => {
          if (url.href === output) {
            assert.deepEqual(headers, {});
            return Object.assign(Readable.from([bytes]), {
              statusCode: 200,
              headers: { 'content-length': bytes.length },
            });
          }
          assert.equal(headers.Authorization, `Bearer ${token}`);
          if (url.pathname.endsWith('/images/generations')) {
            submissions++;
            assert.equal(headers['X-ModelScope-Async-Mode'], 'true');
            assert.deepEqual(JSON.parse(body), { model: modelScopeImage, prompt: positivePrompt });
            const data =
              submissions === 1
                ? { task_id: 'test-cloud-job-1' }
                : { errors: { message: 'Please bind your Alibaba Cloud account before use.' } };
            return Object.assign(Readable.from([Buffer.from(JSON.stringify(data))]), {
              statusCode: submissions === 1 ? 200 : 401,
            });
          }
          assert.ok(url.pathname.endsWith('/tasks/test-cloud-job-1'));
          assert.equal(headers['X-ModelScope-Task-Type'], 'image_generation');
          const data =
            ++polls === 1 ? { task_status: 'RUNNING' } : { task_status: 'SUCCEED', output_images: [output] };
          return Object.assign(Readable.from([Buffer.from(JSON.stringify(data))]), { statusCode: 200 });
        };
        await tick();
        assert.equal((await read(id)).state, 'submitted');
        assert.equal((await read(id)).remoteId, 'test-cloud-job-1');
        await tick();
        assert.equal((await read(id)).state, 'submitted');
        db().prepare('UPDATE generation_jobs SET next_at=0 WHERE id=?').run(id);
        await tick();
        await tick();
        const complete = await read(id);
        assert.equal(complete.state, 'completed');
        assert.equal(complete.result.mediaType, 'image');
        assert.deepEqual((await owner('GET', complete.result.contentUrl.replace('/api/v1', ''))).data, bytes);
        assert.ok(!JSON.stringify(complete).includes('signature='));
        assert.equal(complete.boardExecution.nodeId, nodeId);
        assert.equal(
          (await owner('POST', `/generation-jobs/${id}/save-to-library`, {})).data.inLibrary,
          true,
        );
        assert.equal(submissions, 1);
        const rejected = await run();
        await tick();
        assert.equal((await read(rejected.data.id)).errorCode, 'MODELSCOPE_ACCOUNT_BINDING_REQUIRED');
        assert.equal((await read(rejected.data.id)).state, 'failed');
        assert.equal(submissions, 2);
      },
    );
    await t.test(
      'optional image detaches from the submitted graph and rejects required downstream inputs',
      async () => {
        const definition = fixtureOptionalImages(connectionId);
        const projectPath = `/projects/${project.id}`;
        const workflowPath = projectPath + '/generation-workflows';
        const unsafe = structuredClone(definition);
        unsafe.graph[unsafe.output.node].inputs.conditioning = ['7', 0];
        const rejected = await owner('POST', workflowPath, unsafe);
        assert.equal(rejected.data.code, 'WORKFLOW_MEDIA_DISCONNECT_INVALID');
        const saved = await owner('POST', workflowPath, definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const [required, optional] = definition.mediaSchema.inputs;
        const [first, second] = (await owner('GET', projectPath + '/generation-images')).data.items;
        const submit = (references, key = randomUUID()) =>
          owner(
            'POST',
            projectPath + '/generation-jobs',
            {
              workflowId: saved.data.id,
              positivePrompt: 'Reference study',
              confirmed: true,
              referenceImageVersions: references,
            },
            { 'Idempotency-Key': key },
          );
        assert.equal((await submit({ [optional.id]: second.id })).data.code, 'REFERENCE_SLOT_REQUIRED');
        const key = randomUUID();
        const one = await submit({ [required.id]: first.id }, key);
        assert.equal(one.status, 201, JSON.stringify(one.data));
        assert.equal((await submit({ [required.id]: first.id }, key)).data.id, one.data.id);
        assert.equal(
          (await submit({ [required.id]: first.id, [optional.id]: second.id }, key)).data.code,
          'IDEMPOTENCY_CONFLICT',
        );
        assert.throws(
          () =>
            db()
              .prepare("UPDATE generation_jobs SET lease_id='free:media-v1:old' WHERE id=?")
              .run(one.data.id),
          /optional reference images require updated generation worker/,
        );
        const before = remote.mock.uploads.length;
        for (let i = 0; i < 3; i++) await tick();
        assert.equal((await read(one.data.id)).state, 'completed');
        assert.equal(remote.mock.uploads.length, before + 1);
        const submitted = remote.mock.submissions.at(-1).prompt;
        assert.equal(submitted['7'], undefined);
        assert.equal(submitted[definition.output.node].inputs['references.image_1'], undefined);
        assert.deepEqual(submitted[definition.output.node].inputs['references.image_0'], ['6', 0]);
        const stored = db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(one.data.id);
        assert.deepEqual(
          JSON.parse(stored.snapshot_json).graph[definition.output.node].inputs['references.image_1'],
          ['7', 0],
        );
        const two = await submit({ [required.id]: first.id, [optional.id]: second.id });
        assert.equal(two.status, 201, JSON.stringify(two.data));
        for (let i = 0; i < 3; i++) await tick();
        assert.equal((await read(two.data.id)).state, 'completed');
        assert.equal(remote.mock.uploads.length, before + 3);
        assert.deepEqual(
          remote.mock.submissions.at(-1).prompt[definition.output.node].inputs['references.image_1'],
          ['7', 0],
        );
        const allOptional = structuredClone(definition);
        Object.assign(allOptional.mediaSchema.inputs[0], { required: false, onMissing: 'disconnect' });
        const emptyWorkflow = await owner('POST', workflowPath, allOptional);
        assert.equal(emptyWorkflow.status, 201, JSON.stringify(emptyWorkflow.data));
        const empty = await owner(
          'POST',
          projectPath + '/generation-jobs',
          { workflowId: emptyWorkflow.data.id, positivePrompt: 'No references', confirmed: true },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(empty.status, 201, JSON.stringify(empty.data));
        for (let i = 0; i < 3; i++) await tick();
        assert.equal((await read(empty.data.id)).state, 'completed');
        assert.equal(remote.mock.uploads.length, before + 3);
        const emptyGraph = remote.mock.submissions.at(-1).prompt;
        assert.equal(emptyGraph['6'], undefined);
        assert.equal(emptyGraph['7'], undefined);
        const changed = await submit({ [required.id]: first.id });
        const previousOverrides = remote.mock.objectInfoOverrides;
        try {
          remote.mock.objectInfoOverrides = {
            ImageOutput: { output_node: true, input: { required: { 'references.image_1': ['IMAGE'] } } },
          };
          const count = remote.mock.submissions.length;
          await tick();
          assert.equal((await read(changed.data.id)).errorCode, 'WORKFLOW_MEDIA_DISCONNECT_INVALID');
          assert.equal(remote.mock.submissions.length, count);
          assert.equal(remote.mock.uploads.length, before + 3);
        } finally {
          remote.mock.objectInfoOverrides = previousOverrides;
        }
      },
    );
    await t.test(
      'mixed reference media pin typed versions and upload actual bytes through the same job',
      async () => {
        const path = `/projects/${project.id}`;
        const fixture = fixtureRequiredMedia(connectionId);
        const workflow = await owner('POST', path + '/generation-workflows', fixture);
        assert.equal(workflow.status, 201, JSON.stringify(workflow.data));
        const sound = fixtures['sound.wav'].bytes;
        const intent = await owner(
          'POST',
          path + '/media-uploads',
          {
            fileName: 'mixed-reference.wav',
            byteLength: sound.length,
          },
          { 'Idempotency-Key': randomUUID() },
        );
        const upload = await owner('PUT', `/media-uploads/${intent.data.id}/content`, sound);
        assert.equal(upload.status, 200, JSON.stringify(upload.data));
        const types = ['image', 'video', 'audio'];
        const media = await Promise.all(
          types.map(
            async (type) =>
              (await owner('GET', path + '/generation-reference-media?type=' + type)).data.items[0],
          ),
        );
        assert.equal(media[2].id, upload.data.mediaVersion.id);
        assert.equal(
          (await owner('GET', path + '/generation-reference-media?type=audio&cursor=' + media[0].id)).data
            .code,
          'INVALID_CURSOR',
        );
        const [imageSlot, videoSlot, audioSlot] = fixture.mediaSchema.inputs;
        const references = {
          [audioSlot.id]: media[2].id,
          [imageSlot.id]: media[0].id,
          [videoSlot.id]: media[1].id,
        };
        const key = randomUUID();
        const submit = (values, requestKey = randomUUID(), actor = owner) =>
          actor(
            'POST',
            path + '/generation-jobs',
            {
              workflowId: workflow.data.id,
              positivePrompt: 'Mixed reference study',
              confirmed: true,
              referenceMediaVersions: values,
            },
            { 'Idempotency-Key': requestKey },
          );
        assert.equal(
          (await submit({ ...references, [audioSlot.id]: media[1].id })).data.code,
          'REFERENCE_MEDIA_INVALID',
        );
        const queued = await submit(references, key);
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        const id = queued.data.id;
        assert.equal((await submit(references, key)).data.id, id);
        assert.deepEqual(
          queued.data.referenceMedia.map((item) => item.mediaType),
          types,
        );
        assert.ok(!JSON.stringify(queued.data).includes('sha256'));
        assert.throws(
          () =>
            db()
              .prepare("UPDATE generation_jobs SET lease_id='free:media-v1:disconnect:old' WHERE id=?")
              .run(id),
          /reference media require updated generation worker/,
        );
        const before = remote.mock.uploads.length;
        await tick();
        assert.equal((await read(id)).state, 'submitted');
        const graph = remote.mock.submissions.at(-1).prompt;
        assert.equal(graph['7'].inputs.file, `pullet-studio-${id}-${videoSlot.id}.mp4`);
        assert.equal(graph['8'].inputs.audio, `pullet-studio-${id}-${audioSlot.id}.wav`);
        const uploads = remote.mock.uploads.slice(before);
        assert.deepEqual(
          uploads.map((item) => item.subfolder),
          ['pullet-studio', '', ''],
        );
        assert.deepEqual(
          uploads.map((item) => item.mime),
          ['image/png', 'video/mp4', 'audio/wav'],
        );
        assert.deepEqual(uploads[2].bytes, sound);
        assert.deepEqual(
          uploads[1].bytes,
          (await owner('GET', `/media-versions/${media[1].id}/content`)).data,
        );
        await tick();
        await tick();
        assert.equal((await read(id)).state, 'completed');
        assert.equal(
          (await owner('POST', `/generation-jobs/${id}/save-to-library`, {})).data.inLibrary,
          true,
        );
        remote.mock.mode = 'lost';
        const retry = await submit(references);
        assert.equal(retry.status, 201, JSON.stringify(retry.data));
        const count = remote.mock.submissions.length;
        await tick();
        assert.equal((await read(retry.data.id)).state, 'needs_reconciliation');
        remote.mock.mode = 'normal';
        assert.equal((await control(retry.data.id, 'reconcile')).status, 201);
        await tick();
        await tick();
        assert.equal((await read(retry.data.id)).state, 'completed');
        assert.equal(remote.mock.submissions.length, count + 1);
        const editor = client();
        const invitation = (
          await owner('POST', `/workspaces/${workspace.id}/invitations`, {
            email: 'media-editor@generation.test',
          })
        ).data;
        const joined = await editor('POST', '/invitations/accept', {
          token: invitation.token,
          name: 'Media editor',
          password: 'Studio8!',
        });
        assert.equal(
          (await owner('POST', path + '/members', { userId: joined.data.user.id, role: 'EDITOR' })).status,
          201,
        );
        const queuedBeforeProtection = await submit(references, randomUUID(), editor);
        assert.equal(queuedBeforeProtection.status, 201, JSON.stringify(queuedBeforeProtection.data));
        const voice = await owner(
          'POST',
          path + '/entities',
          {
            kind: 'voice',
            body: {
              name: 'Protected voice',
              attributes: {},
              media: [{ role: 'voice_sample', mediaVersionId: media[2].id }],
            },
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(voice.status, 201, JSON.stringify(voice.data));
        const hidden = (await editor('GET', path + '/generation-reference-media?type=audio')).data.items;
        assert.ok(!hidden.some((item) => item.id === media[2].id));
        assert.ok(
          (await owner('GET', path + '/generation-reference-media?type=audio')).data.items.some(
            (item) => item.id === media[2].id,
          ),
        );
        assert.equal((await submit(references, randomUUID(), editor)).data.code, 'VOICE_SAMPLE_RESTRICTED');
        const uploadsBefore = remote.mock.uploads.length;
        await tick();
        assert.equal((await read(queuedBeforeProtection.data.id)).errorCode, 'VOICE_SAMPLE_RESTRICTED');
        assert.equal(remote.mock.uploads.length, uploadsBefore);
      },
    );

    await t.test(
      'optional video and audio detach independently with fixed snapshots and worker guards',
      async () => {
        const path = '/projects/' + project.id;
        const definition = fixtureOptionalMedia(connectionId);
        const saved = await owner('POST', path + '/generation-workflows', definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const [video, audio] = definition.mediaSchema.inputs;
        const videoVersion = (await owner('GET', path + '/generation-reference-media?type=video')).data
          .items[0];
        const audioVersion = (await owner('GET', path + '/generation-reference-media?type=audio')).data
          .items[0];
        const submit = (refs, key = randomUUID()) =>
          owner(
            'POST',
            path + '/generation-jobs',
            {
              workflowId: saved.data.id,
              positivePrompt: 'A quiet station',
              confirmed: true,
              referenceMediaVersions: refs,
            },
            { 'Idempotency-Key': key },
          );
        let uploaded = remote.mock.uploads.length;
        for (const refs of [
          {},
          { [video.id]: videoVersion.id },
          { [audio.id]: audioVersion.id },
          { [video.id]: videoVersion.id, [audio.id]: audioVersion.id },
        ]) {
          const key = randomUUID();
          const queued = await submit(refs, key);
          assert.equal(queued.status, 201, JSON.stringify(queued.data));
          assert.equal((await submit(refs, key)).data.id, queued.data.id);
          assert.throws(
            () =>
              db()
                .prepare(
                  "UPDATE generation_jobs SET lease_id='free:media-v1:disconnect:multimodal:legacy' WHERE id=?",
                )
                .run(queued.data.id),
            /optional media and audio output require updated generation worker/,
          );
          const original = JSON.parse(
            db().prepare('SELECT snapshot_json FROM generation_jobs WHERE id=?').get(queued.data.id)
              .snapshot_json,
          );
          assert.equal(original.optionalReferenceMedia, true);
          for (let i = 0; i < 3; i++) await tick();
          assert.equal((await read(queued.data.id)).state, 'completed');
          const graph = remote.mock.submissions.at(-1).prompt;
          for (const slot of [video, audio]) {
            const field = slot.mediaType + '_reference';
            assert.deepEqual(
              graph[definition.output.node].inputs[field],
              refs[slot.id] ? [slot.node, 0] : undefined,
            );
            assert.equal(Boolean(graph[slot.node]), Boolean(refs[slot.id]));
            assert.deepEqual(original.graph[definition.output.node].inputs[field], [slot.node, 0]);
          }
          uploaded += Object.keys(refs).length;
          assert.equal(remote.mock.uploads.length, uploaded);
        }
        const readback = (await owner('GET', '/generation-workflows/' + saved.data.id + '/definition')).data;
        assert.deepEqual(readback.definition.graph, definition.graph);
      },
    );
    await t.test(
      'optional media rejects ambiguous loaders and changed downstream declarations before uploads',
      async () => {
        const path = '/projects/' + project.id + '/generation-workflows';
        const definition = fixtureOptionalMedia(connectionId);
        const [video, audio] = definition.mediaSchema.inputs;
        for (const mutate of [
          (w) => (w.graph[audio.node].inputs.extra = 'not dedicated'),
          (w) => (w.graph[audio.node].class_type = 'Custom Input'),
          (w) => (w.graph[w.output.node].inputs.audio_reference = [audio.node, 1]),
          (w) => w.mediaSchema.inputs.push({ ...w.mediaSchema.inputs[0], id: randomUUID() }),
        ]) {
          const invalid = structuredClone(definition);
          mutate(invalid);
          assert.equal((await owner('POST', path, invalid)).status, 400);
        }
        const overrides = remote.mock.objectInfoOverrides;
        try {
          for (const declarations of [
            { required: { audio_reference: ['AUDIO'] } },
            { optional: { audio_reference: ['VIDEO'], video_reference: ['VIDEO'] } },
          ]) {
            remote.mock.objectInfoOverrides = { ImageOutput: { output_node: true, input: declarations } };
            assert.equal(
              (await owner('POST', path, definition)).data.code,
              'WORKFLOW_MEDIA_DISCONNECT_INVALID',
            );
          }
          remote.mock.objectInfoOverrides = overrides;
          const saved = await owner('POST', path, definition);
          const queued = await owner(
            'POST',
            '/projects/' + project.id + '/generation-jobs',
            {
              workflowId: saved.data.id,
              positivePrompt: 'No optional files',
              confirmed: true,
            },
            { 'Idempotency-Key': randomUUID() },
          );
          assert.equal(queued.status, 201, JSON.stringify(queued.data));
          remote.mock.objectInfoOverrides = {
            ImageOutput: { output_node: true, input: { required: { audio_reference: ['AUDIO'] } } },
          };
          const before = [remote.mock.uploads.length, remote.mock.submissions.length];
          await tick();
          assert.equal((await read(queued.data.id)).errorCode, 'WORKFLOW_MEDIA_DISCONNECT_INVALID');
          assert.deepEqual([remote.mock.uploads.length, remote.mock.submissions.length], before);
          const report = await owner('POST', '/generation-workflows/' + saved.data.id + '/inspection', {});
          assert.ok(JSON.stringify(report.data).includes('MEDIA_DISCONNECT_INVALID'));
        } finally {
          remote.mock.objectInfoOverrides = overrides;
        }
      },
    );
    await t.test(
      'audio main output archives real MP3 once and keeps trials outside the media library',
      async () => {
        const path = '/projects/' + project.id;
        const definition = fixtureOptionalMedia(connectionId, true);
        const saved = await owner('POST', path + '/generation-workflows', definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        assert.equal((await queue(saved.data.id)).data.code, 'WORKFLOW_MEDIA_UNSUPPORTED');
        const submit = (endpoint = 'generation-jobs', key = randomUUID(), actor = owner) =>
          actor(
            'POST',
            path + '/' + endpoint,
            {
              workflowId: saved.data.id,
              positivePrompt: 'Gentle instrumental',
              confirmed: true,
            },
            { 'Idempotency-Key': key },
          );
        assert.equal((await submit('generation-jobs', randomUUID(), viewer)).status, 403);
        const key = randomUUID();
        const queued = await submit('generation-jobs', key);
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        assert.throws(
          () =>
            db().prepare("UPDATE generation_jobs SET lease_id='free:legacy' WHERE id=?").run(queued.data.id),
          /updated generation worker/,
        );
        const before = remote.mock.submissions.length;
        remote.mock.mode = 'lost';
        await tick();
        assert.equal((await read(queued.data.id)).state, 'needs_reconciliation');
        assert.equal(remote.mock.submissions.length, before + 1);
        remote.mock.mode = 'normal';
        assert.equal((await control(queued.data.id, 'reconcile')).status, 201);
        for (let i = 0; i < 3; i++) await tick();
        const done = await read(queued.data.id);
        assert.equal(done.state, 'completed', JSON.stringify(done));
        assert.equal(done.result.mediaType, 'audio');
        assert.equal(done.result.metadata.width, null);
        assert.ok(done.result.metadata.durationMs > 0);
        assert.deepEqual(
          (await owner('GET', done.result.contentUrl.replace('/api/v1', ''))).data,
          fixtures['sound.mp3'].bytes,
        );
        assert.equal((await submit('generation-jobs', key)).data.mediaVersionId, done.mediaVersionId);
        assert.equal(
          db().prepare('SELECT count(*) n FROM media_uploads WHERE generation_job_id=?').get(done.id).n,
          1,
        );
        assert.equal(
          (await owner('POST', '/generation-jobs/' + done.id + '/save-to-library', {})).data.inLibrary,
          true,
        );
        const trial = await submit('workflow-trials');
        assert.equal(trial.status, 201, JSON.stringify(trial.data));
        for (let i = 0; i < 3; i++) await tick();
        const evidence = await read(trial.data.id);
        assert.equal(evidence.state, 'test_completed');
        assert.equal(evidence.result.mediaType, 'audio');
        assert.notEqual(
          (await owner('POST', '/generation-jobs/' + trial.data.id + '/save-to-library', {})).status,
          201,
        );
        assert.ok(
          !(await owner('GET', path + '/generation-reference-media?type=audio')).data.items.some(
            (v) => v.id === evidence.mediaVersionId,
          ),
        );
        assert.equal(remote.mock.submissions.length, before + 2);

        const plain = fixtureWorkflow(connectionId);
        plain.capability = 'audio.music';
        plain.name = 'Text to audio';
        plain.graph[plain.output.node].class_type = 'AudioOutput';
        plain.output.field = 'audio';
        const pure = await owner('POST', path + '/generation-workflows', plain);
        assert.equal(pure.status, 201, JSON.stringify(pure.data));
        const pureJob = await owner(
          'POST',
          path + '/generation-jobs',
          {
            workflowId: pure.data.id,
            positivePrompt: 'Piano',
            confirmed: true,
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(pureJob.status, 201, JSON.stringify(pureJob.data));
        for (let i = 0; i < 3; i++) await tick();
        assert.equal((await read(pureJob.data.id)).state, 'completed');
        assert.equal((await read(pureJob.data.id)).result.mediaType, 'audio');
        const mismatch = await submit();
        await tick();
        const remoteId = (await read(mismatch.data.id)).remoteId;
        const record = remote.mock.history.get(remoteId);
        record.outputs[definition.output.node].audio[0].filename = 'image.png';
        await tick();
        await tick();
        const failed = await read(mismatch.data.id);
        assert.notEqual(failed.state, 'completed');
        assert.equal(failed.mediaVersionId, null);
        assert.equal(
          db()
            .prepare(
              'SELECT count(*) n FROM media_versions WHERE id IN (SELECT media_version_id FROM media_uploads WHERE generation_job_id=?)',
            )
            .get(failed.id).n,
          0,
        );
      },
    );

    await t.test(
      'extended outputs archive typed fixed files independently and retain main result compatibility',
      async () => {
        const path = '/projects/' + project.id;
        const definition = fixtureExtendedOutputs(connectionId);
        const saved = await owner('POST', path + '/generation-workflows', definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        assert.equal((await queue(saved.data.id)).data.code, 'WORKFLOW_MEDIA_UNSUPPORTED');
        const submit = (endpoint = 'generation-jobs') =>
          owner(
            'POST',
            path + '/' + endpoint,
            { workflowId: saved.data.id, positivePrompt: 'A production with artifacts', confirmed: true },
            { 'Idempotency-Key': randomUUID() },
          );
        const queued = await submit();
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        assert.throws(
          () => db().prepare("UPDATE generation_jobs SET lease_id='free:old' WHERE id=?").run(queued.data.id),
          /extended outputs require updated generation worker/,
        );
        for (let i = 0; i < 3; i++) await tick();
        const done = await read(queued.data.id);
        assert.equal(done.state, 'completed', JSON.stringify(done));
        assert.equal(done.result.mediaType, 'video');
        assert.equal(done.outputs.length, 3);
        assert.deepEqual(
          done.outputs.map((o) => [o.label, o.index, o.result.mediaType]),
          [
            ['Storyboard', 0, 'image'],
            ['Storyboard', 1, 'image'],
            ['Music', 0, 'audio'],
          ],
        );
        for (const [i, name] of ['image.jpg', 'extra.png', 'sound.mp3'].entries()) {
          const expected = fixtures[name === 'extra.png' ? 'image.png' : name].bytes;
          assert.deepEqual(
            (await owner('GET', done.outputs[i].result.contentUrl.replace('/api/v1', ''))).data,
            expected,
          );
          assert.equal(done.outputs[i].inLibrary, false);
        }
        const archived = await owner('POST', '/generation-jobs/' + done.id + '/save-to-library', {
          outputId: done.outputs[1].id,
        });
        assert.equal(archived.status, 201, JSON.stringify(archived.data));
        assert.equal(archived.data.inLibrary, false);
        assert.deepEqual(
          archived.data.outputs.map((o) => o.inLibrary),
          [false, true, false],
        );
        assert.equal(
          (
            await owner('POST', '/generation-jobs/' + done.id + '/save-to-library', {
              outputId: randomUUID(),
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await viewer('POST', '/generation-jobs/' + done.id + '/save-to-library', {
              outputId: done.outputs[0].id,
            })
          ).status,
          403,
        );
        const raw = db().prepare('SELECT * FROM generation_outputs WHERE job_id=?').all(done.id);
        const upload = (await owner('GET', '/media-uploads/' + raw[0].upload_id)).data;
        assert.equal(upload.mediaVersion.origin, 'generation');
        assert.equal(
          (await owner('PUT', '/media-uploads/' + raw[0].upload_id + '/content', fixtures['image.jpg'].bytes))
            .data.code,
          'GENERATION_UPLOAD_RESERVED',
        );
        assert.equal(
          (await owner('POST', '/media-uploads/' + raw[0].upload_id + '/reconcile', {})).data.code,
          'GENERATION_UPLOAD_RESERVED',
        );
        assert.throws(
          () => db().prepare("UPDATE generation_outputs SET label='changed' WHERE id=?").run(raw[0].id),
          /identity is immutable/,
        );
        assert.throws(
          () => db().prepare("UPDATE generation_jobs SET result_json='{}' WHERE id=?").run(done.id),
          /manifest is immutable/,
        );
        const trial = await submit('workflow-trials');
        assert.equal(trial.status, 201, JSON.stringify(trial.data));
        for (let i = 0; i < 3; i++) await tick();
        const evidence = await read(trial.data.id);
        assert.equal(evidence.state, 'test_completed', JSON.stringify(evidence));
        assert.equal(evidence.outputs.length, 3);
        for (const file of evidence.outputs)
          assert.notEqual(
            (
              await owner('POST', '/generation-jobs/' + evidence.id + '/save-to-library', {
                outputId: file.id,
              })
            ).status,
            201,
          );
        const evidenceIds = evidence.outputs.map((o) => o.mediaVersionId);
        for (const type of ['image', 'audio'])
          assert.ok(
            !(await owner('GET', path + '/generation-reference-media?type=' + type)).data.items.some((o) =>
              evidenceIds.includes(o.id),
            ),
          );
        assert.equal(
          db()
            .prepare(
              "SELECT count(*) n FROM media_versions WHERE id IN (SELECT media_version_id FROM generation_outputs WHERE job_id=?) AND origin='workflow_test'",
            )
            .get(evidence.id).n,
          3,
        );

        const board = (
          await owner(
            'POST',
            path + '/boards',
            { title: 'Fixed output references' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const node = (outputId, jobId = done.id) => ({
          id: outputId,
          type: 'result',
          position: { x: 0, y: 0 },
          width: 250,
          height: 280,
          data: { jobId, outputId },
        });
        const save = (nodes, expectedRevision = board.revision) =>
          owner(
            'POST',
            '/boards/' + board.id + '/revisions',
            { title: board.title, expectedRevision, layout: { ...board.layout, nodes } },
            { 'Idempotency-Key': randomUUID() },
          );
        assert.equal((await save([node(done.outputs[0].id, randomUUID())])).status, 404);
        assert.equal((await save([node(evidence.outputs[0].id, evidence.id)])).status, 404);
        const pinned = await save([node(done.outputs[0].id)]);
        assert.equal(pinned.status, 201, JSON.stringify(pinned.data));
        assert.equal(pinned.data.resolved[done.outputs[0].id].media.id, done.outputs[0].mediaVersionId);
        const elsewhere = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Unrelated outputs' })
        ).data;
        const foreignBoard = (
          await owner(
            'POST',
            '/projects/' + elsewhere.id + '/boards',
            { title: 'Foreign output' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        assert.equal(
          (
            await owner(
              'POST',
              '/boards/' + foreignBoard.id + '/revisions',
              {
                title: foreignBoard.title,
                expectedRevision: foreignBoard.revision,
                layout: { ...foreignBoard.layout, nodes: [node(done.outputs[0].id)] },
              },
              { 'Idempotency-Key': randomUUID() },
            )
          ).status,
          404,
        );
        assert.deepEqual(db().pragma('foreign_key_check'), []);
      },
    );
    await t.test(
      'partial output downloads and archive registration resume without refetching completed files',
      async () => {
        const path = '/projects/' + project.id;
        const saved = await owner(
          'POST',
          path + '/generation-workflows',
          fixtureExtendedOutputs(connectionId),
        );
        const submit = () =>
          owner(
            'POST',
            path + '/generation-jobs',
            { workflowId: saved.data.id, positivePrompt: 'Recover all artifacts', confirmed: true },
            { 'Idempotency-Key': randomUUID() },
          );
        const queued = await submit();
        const start = remote.mock.downloads.length;
        remote.mock.missingFile = 'sound.mp3';
        try {
          for (let i = 0; i < 3; i++) await tick();
        } finally {
          remote.mock.missingFile = undefined;
        }
        const partial = await read(queued.data.id);
        assert.equal(partial.state, 'needs_reconciliation');
        assert.equal(partial.mediaVersionId, null);
        assert.deepEqual(partial.outputs, []);
        assert.equal(
          db()
            .prepare(
              'SELECT count(*) n FROM generation_outputs WHERE job_id=? AND media_version_id IS NOT NULL',
            )
            .get(queued.data.id).n,
          2,
        );
        const frozen = db()
          .prepare('SELECT result_json FROM generation_jobs WHERE id=?')
          .get(queued.data.id).result_json;
        const record = remote.mock.history.get((await read(queued.data.id)).remoteId);
        record.outputs['8'].images = [];
        assert.equal((await control(queued.data.id, 'reconcile')).status, 201);
        await tick();
        const done = await read(queued.data.id);
        assert.equal(done.state, 'completed', JSON.stringify(done));
        assert.deepEqual(remote.mock.downloads.slice(start), [
          'clip.mp4',
          'image.jpg',
          'extra.png',
          'sound.mp3',
          'sound.mp3',
        ]);
        assert.equal(
          db().prepare('SELECT result_json FROM generation_jobs WHERE id=?').get(done.id).result_json,
          frozen,
        );
        assert.equal(
          db()
            .prepare(
              'SELECT count(*) n FROM media_uploads WHERE id IN (SELECT upload_id FROM generation_outputs WHERE job_id=?)',
            )
            .get(done.id).n,
          3,
        );
        const retry = await submit();
        db().exec(
          "CREATE TRIGGER fixture_output_registration BEFORE INSERT ON media_versions WHEN NEW.file_name='sound.mp3' BEGIN SELECT RAISE(ABORT,'fixture archive registration'); END;",
        );
        try {
          for (let i = 0; i < 3; i++) await tick();
        } finally {
          db().exec('DROP TRIGGER fixture_output_registration');
        }
        assert.equal((await read(retry.data.id)).state, 'needs_reconciliation');
        const pending = db()
          .prepare(
            "SELECT u.* FROM media_uploads u JOIN generation_outputs o ON o.upload_id=u.id WHERE o.job_id=? AND o.media_type='audio'",
          )
          .get(retry.data.id);
        assert.equal(pending.state, 'needs_reconciliation');
        const downloads = remote.mock.downloads.length;
        await control(retry.data.id, 'reconcile');
        await tick();
        assert.equal((await read(retry.data.id)).state, 'completed');
        assert.equal(remote.mock.downloads.length, downloads);
      },
    );
    await t.test(
      'missing excessive duplicate and incorrect output types never become successful jobs',
      async () => {
        const path = '/projects/' + project.id;
        const saved = await owner(
          'POST',
          path + '/generation-workflows',
          fixtureExtendedOutputs(connectionId),
        );
        for (const change of [
          (row) => (row.outputs['8'].images = []),
          (row) => (row.outputs['8'].images = Array.from({ length: 9 }, () => row.outputs['8'].images[0])),
          (row) => (row.outputs['9'].audio[0].filename = 'image.jpg'),
          (row) => (row.outputs['9'].audio[0].filename = 'image.png'),
          (row) => (row.outputs['9'].audio[0].filename = '../sound.mp3'),
        ]) {
          const q = await owner(
            'POST',
            path + '/generation-jobs',
            { workflowId: saved.data.id, positivePrompt: 'Reject bad artifacts', confirmed: true },
            { 'Idempotency-Key': randomUUID() },
          );
          await tick();
          change(remote.mock.history.get((await read(q.data.id)).remoteId));
          await tick();
          await tick();
          const result = await read(q.data.id);
          assert.equal(result.state, 'needs_reconciliation');
          assert.equal(result.mediaVersionId, null);
        }
      },
    );

    await t.test(
      'optional mixed references and audio output coexist with the extended worker contract',
      async () => {
        const definition = fixtureOptionalMedia(connectionId, true);
        definition.graph['9'] = { class_type: 'ImagesOutput', inputs: { conditioning: ['1', 0] } };
        definition.mediaSchema.outputs = [
          {
            id: randomUUID(),
            label: 'Cover study',
            role: 'preview',
            mediaType: 'image',
            node: '9',
            field: 'images',
            multiple: true,
          },
        ];
        const saved = await owner('POST', '/projects/' + project.id + '/generation-workflows', definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        const queued = await owner(
          'POST',
          '/projects/' + project.id + '/generation-jobs',
          { workflowId: saved.data.id, positivePrompt: 'Music and cover studies', confirmed: true },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        for (let i = 0; i < 3; i++) await tick();
        const done = await read(queued.data.id);
        assert.equal(done.state, 'completed', JSON.stringify(done));
        assert.equal(done.result.mediaType, 'audio');
        assert.equal(done.outputs.length, 2);
      },
    );
    await t.test(
      'primary batches retain old result identities and archive each main candidate independently',
      async () => {
        const path = '/projects/' + project.id;
        const definition = fixturePrimaryBatch(connectionId);
        const conflicting = structuredClone(definition);
        conflicting.fields = [
          {
            id: definition.output.batch.id,
            node: '1',
            input: 'text',
            label: 'Duplicate id',
            type: 'text',
            maxLength: 200,
          },
        ];
        assert.equal((await owner('POST', path + '/generation-workflows', conflicting)).status, 400);
        const saved = await owner('POST', path + '/generation-workflows', definition);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        assert.equal((await queue(saved.data.id)).data.code, 'WORKFLOW_MEDIA_UNSUPPORTED');
        const submit = (endpoint = 'generation-jobs') =>
          owner(
            'POST',
            path + '/' + endpoint,
            { workflowId: saved.data.id, positivePrompt: 'Batch main images', confirmed: true },
            { 'Idempotency-Key': randomUUID() },
          );
        const queued = await submit();
        assert.equal(queued.status, 201, JSON.stringify(queued.data));
        assert.throws(
          () => db().prepare("UPDATE generation_jobs SET lease_id='old:b6' WHERE id=?").run(queued.data.id),
          /primary batch requires updated generation worker/,
        );
        for (let i = 0; i < 3; i++) await tick();
        const done = await read(queued.data.id);
        assert.equal(done.state, 'completed', JSON.stringify(done));
        assert.equal(done.result.mediaType, 'image');
        assert.equal(done.outputs.length, 1);
        const second = done.outputs[0];
        assert.equal(second.role, 'primary');
        assert.equal(second.index, 1);
        assert.equal(second.slotId, definition.output.batch.id);
        assert.notEqual(second.mediaVersionId, done.mediaVersionId);
        assert.deepEqual(
          (await owner('GET', second.result.contentUrl.replace('/api/v1', ''))).data,
          fixtures['image.png'].bytes,
        );
        const archived = await control(done.id, 'save-to-library', { outputId: second.id });
        assert.equal(archived.status, 201, JSON.stringify(archived.data));
        assert.equal(archived.data.inLibrary, false);
        assert.equal(archived.data.outputs[0].inLibrary, true);
        assert.equal(
          (await viewer('POST', '/generation-jobs/' + done.id + '/save-to-library', { outputId: second.id }))
            .status,
          403,
        );
        const raw = db().prepare('SELECT * FROM generation_outputs WHERE id=?').get(second.id);
        assert.equal(raw.primary_index, 1);
        assert.throws(
          () => db().prepare('UPDATE generation_outputs SET primary_index=NULL WHERE id=?').run(second.id),
          /identity is immutable/,
        );
        const board = (
          await owner(
            'POST',
            path + '/boards',
            { title: 'Batch candidates' },
            { 'Idempotency-Key': randomUUID() },
          )
        ).data;
        const pinned = await owner(
          'POST',
          '/boards/' + board.id + '/revisions',
          {
            title: board.title,
            expectedRevision: board.revision,
            layout: {
              ...board.layout,
              nodes: [
                {
                  id: done.id,
                  type: 'result',
                  position: { x: 0, y: 0 },
                  width: 250,
                  height: 280,
                  data: { jobId: done.id },
                },
                {
                  id: second.id,
                  type: 'result',
                  position: { x: 300, y: 0 },
                  width: 250,
                  height: 280,
                  data: { jobId: done.id, outputId: second.id },
                },
              ],
            },
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(pinned.status, 201, JSON.stringify(pinned.data));
        assert.equal(pinned.data.resolved[done.id].media.id, done.mediaVersionId);
        assert.equal(pinned.data.resolved[second.id].media.id, second.mediaVersionId);
        const trial = await submit('workflow-trials');
        for (let i = 0; i < 3; i++) await tick();
        const evidence = await read(trial.data.id);
        assert.equal(evidence.state, 'test_completed', JSON.stringify(evidence));
        assert.equal(evidence.outputs[0].role, 'primary');
        assert.equal(
          (await control(evidence.id, 'save-to-library', { outputId: evidence.outputs[0].id })).status,
          409,
        );
        assert.equal(
          db().prepare('SELECT origin FROM media_versions WHERE id=?').get(evidence.outputs[0].mediaVersionId)
            .origin,
          'workflow_test',
        );
        assert.ok(
          !(await owner('GET', path + '/generation-reference-media?type=image')).data.items.some(
            (o) => o.id === evidence.outputs[0].mediaVersionId,
          ),
        );
      },
    );

    await t.test(
      'batch contracts support a single file the upper limit and combined video audio artifacts',
      async () => {
        const path = '/projects/' + project.id;
        for (const kind of ['single', 'eight', 'forty', 'video', 'audio']) {
          const definition =
            kind === 'video' ? fixtureExtendedOutputs(connectionId) : fixturePrimaryBatch(connectionId);
          definition.output.batch ??= { id: randomUUID() };
          if (kind === 'audio') {
            definition.capability = 'audio.music';
            definition.graph['3'].class_type = 'AudioOutput';
            definition.output.field = 'audio';
          }
          const names =
            kind === 'single'
              ? ['image.jpg']
              : kind === 'eight' || kind === 'forty'
                ? Array.from({ length: 8 }, (_, i) => 'batch' + i + '.png')
                : kind === 'video'
                  ? ['clip.mp4', 'clip2.mp4']
                  : ['sound.mp3', 'sound2.mp3'];
          const extraFiles = {};
          if (kind === 'forty') {
            definition.mediaSchema = { version: 'studio.workflow-media.v1', inputs: [], outputs: [] };
            for (let slot = 0; slot < 4; slot++) {
              const node = String(slot + 8);
              definition.graph[node] = { class_type: 'ImagesOutput', inputs: { conditioning: ['1', 0] } };
              definition.mediaSchema.outputs.push({
                id: randomUUID(),
                label: 'Study ' + slot,
                role: 'preview',
                mediaType: 'image',
                node,
                field: 'images',
                multiple: true,
              });
              extraFiles[node] = Array.from({ length: 8 }, (_, i) => 'batch' + ((slot + 1) * 8 + i) + '.png');
            }
          }
          const saved = await owner('POST', path + '/generation-workflows', definition);
          assert.equal(saved.status, 201, JSON.stringify(saved.data));
          remote.mock.outputFiles = { 3: names, ...extraFiles };
          let queued;
          try {
            queued = await owner(
              'POST',
              path + '/generation-jobs',
              { workflowId: saved.data.id, positivePrompt: 'Typed main batch', confirmed: true },
              { 'Idempotency-Key': randomUUID() },
            );
            for (let i = 0; i < 3; i++) await tick();
          } finally {
            remote.mock.outputFiles = undefined;
          }
          const done = await read(queued.data.id);
          assert.equal(done.state, 'completed', JSON.stringify(done));
          assert.equal(done.outputs.filter((o) => o.role === 'primary').length, names.length - 1);
          assert.equal(
            done.outputs.length,
            names.length - 1 + (kind === 'video' ? 3 : kind === 'forty' ? 32 : 0),
          );
          const type = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image';
          assert.equal(done.result.mediaType, type);
          assert.ok(
            done.outputs.filter((o) => o.role === 'primary').every((o) => o.result.mediaType === type),
          );
        }
      },
    );

    await t.test(
      'invalid primary batches fail explicitly while partial downloads resume a fixed manifest',
      async () => {
        const path = '/projects/' + project.id;
        const definition = fixturePrimaryBatch(connectionId);
        const saved = await owner('POST', path + '/generation-workflows', definition);
        const submit = () =>
          owner(
            'POST',
            path + '/generation-jobs',
            { workflowId: saved.data.id, positivePrompt: 'Recover primary batch', confirmed: true },
            { 'Idempotency-Key': randomUUID() },
          );
        const single = structuredClone(definition);
        delete single.output.batch;
        const legacy = await owner('POST', path + '/generation-workflows', single);
        for (const names of [
          [],
          Array(9).fill('image.jpg'),
          ['image.jpg', 'image.jpg'],
          ['image.jpg', '../extra.png'],
          ['image.jpg', 'sound.mp3'],
        ]) {
          remote.mock.outputFiles = { 3: names };
          let q;
          try {
            q = await submit();
            for (let i = 0; i < 3; i++) await tick();
          } finally {
            remote.mock.outputFiles = undefined;
          }
          const done = await read(q.data.id);
          assert.equal(done.state, 'needs_reconciliation', JSON.stringify(done));
          assert.equal(done.mediaVersionId, null);
          assert.deepEqual(done.outputs, []);
        }
        const old = await owner(
          'POST',
          path + '/generation-jobs',
          { workflowId: legacy.data.id, positivePrompt: 'Legacy single remains strict', confirmed: true },
          { 'Idempotency-Key': randomUUID() },
        );
        for (let i = 0; i < 2; i++) await tick();
        assert.equal((await read(old.data.id)).errorCode, 'WORKFLOW_OUTPUT_COUNT');
        const q = await submit();
        const start = remote.mock.downloads.length;
        remote.mock.missingFile = 'extra.png';
        try {
          for (let i = 0; i < 3; i++) await tick();
        } finally {
          remote.mock.missingFile = undefined;
        }
        assert.equal((await read(q.data.id)).state, 'needs_reconciliation');
        remote.mock.history.get((await read(q.data.id)).remoteId).outputs['3'].images = [];
        await control(q.data.id, 'reconcile');
        await tick();
        const done = await read(q.data.id);
        assert.equal(done.state, 'completed', JSON.stringify(done));
        assert.deepEqual(remote.mock.downloads.slice(start), ['image.jpg', 'extra.png', 'extra.png']);
        assert.equal(done.outputs[0].role, 'primary');
        const retry = await submit();
        db().exec(
          "CREATE TRIGGER fixture_batch_registration BEFORE INSERT ON media_versions WHEN NEW.file_name='extra.png' BEGIN SELECT RAISE(ABORT,'fixture batch registration'); END;",
        );
        try {
          for (let i = 0; i < 3; i++) await tick();
        } finally {
          db().exec('DROP TRIGGER fixture_batch_registration');
        }
        assert.equal((await read(retry.data.id)).state, 'needs_reconciliation');
        const downloadCount = remote.mock.downloads.length;
        await control(retry.data.id, 'reconcile');
        await tick();
        assert.equal((await read(retry.data.id)).state, 'completed');
        assert.equal(remote.mock.downloads.length, downloadCount);
        assert.deepEqual(db().pragma('foreign_key_check'), []);
      },
    );

    await t.test(
      'selected outputs archive atomically and stream only the requested original files',
      async () => {
        const path = '/projects/' + project.id;
        const workflow = await owner(
          'POST',
          path + '/generation-workflows',
          fixtureExtendedOutputs(connectionId),
        );
        const submit = (endpoint = 'generation-jobs') =>
          owner(
            'POST',
            path + '/' + endpoint,
            { workflowId: workflow.data.id, positivePrompt: 'Package original files', confirmed: true },
            { 'Idempotency-Key': randomUUID() },
          );
        const queued = await submit();
        const archive = (id, outputIds, actor = owner) =>
          actor('POST', '/generation-jobs/' + id + '/save-outputs-to-library', { outputIds });
        const preview = (id, ids, actor = owner) =>
          actor(
            'GET',
            '/generation-jobs/' +
              id +
              '/output-package/preview?outputIds=' +
              encodeURIComponent(ids.map((x) => x ?? 'main').join(',')),
          );
        assert.equal((await preview(queued.data.id, [null])).status, 409);
        for (let i = 0; i < 3; i++) await tick();
        const done = await read(queued.data.id),
          first = done.outputs[0],
          audio = done.outputs[2];
        for (const ids of [
          [],
          [null, null],
          [first.id, first.id],
          Array.from({ length: 41 }, () => randomUUID()),
          [randomUUID()],
        ])
          assert.notEqual((await archive(done.id, ids)).status, 201);
        assert.equal((await archive(done.id, [first.id], viewer)).status, 403);
        const other = await submit();
        for (let i = 0; i < 3; i++) await tick();
        assert.equal((await archive(done.id, [null, (await read(other.data.id)).outputs[0].id])).status, 404);
        assert.equal((await read(done.id)).inLibrary, false);
        const failAsset = db()
          .prepare('SELECT asset_id FROM media_versions WHERE id=?')
          .get(first.mediaVersionId).asset_id;
        db().exec(
          `CREATE TRIGGER fixture_batch_archive BEFORE UPDATE OF in_library ON media_assets WHEN NEW.id='${failAsset}' BEGIN SELECT RAISE(ABORT,'fixture archive interruption'); END;`,
        );
        try {
          assert.equal((await archive(done.id, [null, first.id])).status, 409);
        } finally {
          db().exec('DROP TRIGGER fixture_batch_archive');
        }
        let state = await read(done.id);
        assert.equal(state.inLibrary, false);
        assert.ok(state.outputs.every((o) => !o.inLibrary));
        const events = db()
          .prepare(
            "SELECT count(*) n FROM audit_events WHERE action='generation.candidate.save' AND target_id=?",
          )
          .get(done.id).n;
        const saved = await archive(done.id, [null, audio.id]);
        assert.equal(saved.status, 201, JSON.stringify(saved.data));
        assert.equal(saved.data.inLibrary, true);
        assert.deepEqual(
          saved.data.outputs.map((o) => o.inLibrary),
          [false, false, true],
        );
        assert.equal((await archive(done.id, [null, audio.id])).status, 201);
        assert.equal(
          db()
            .prepare(
              "SELECT count(*) n FROM audit_events WHERE action='generation.candidate.save' AND target_id=?",
            )
            .get(done.id).n,
          events + 2,
        );
        const prepared = await preview(done.id, [first.id, audio.id], viewer);
        assert.equal(prepared.status, 200, JSON.stringify(prepared.data));
        assert.equal(prepared.data.fileCount, 2);
        const packed = await viewer('GET', prepared.data.downloadPath.replace('/api/v1', ''));
        assert.equal(packed.status, 200, JSON.stringify(packed.data));
        const zip = readPackageZip(packed.data),
          manifest = JSON.parse(zip.get('manifest.json').toString());
        assert.equal(manifest.schemaVersion, 'studio.generation-output-package.v1');
        assert.equal(manifest.jobId, done.id);
        assert.equal(manifest.workflowId, workflow.data.id);
        assert.equal(zip.size, 3);
        assert.deepEqual(
          manifest.files.map((f) => f.outputId),
          [first.id, audio.id],
        );
        for (const [index, name] of ['image.jpg', 'sound.mp3'].entries()) {
          const file = manifest.files[index];
          assert.deepEqual(zip.get(file.path), fixtures[name].bytes);
          assert.equal(file.sha256, createHash('sha256').update(zip.get(file.path)).digest('hex'));
          assert.ok(file.path.startsWith(index ? '02_Audio/' : '03_Images/'));
        }
        for (const secret of ['encryptedSecret', 'definitionJson', 'objectKey', 'positivePrompt', 'baseUrl'])
          assert.ok(!zip.get('manifest.json').includes(secret));
        const mainPreview = await preview(done.id, [null]);
        const mainZip = readPackageZip(
          (await owner('GET', mainPreview.data.downloadPath.replace('/api/v1', ''))).data,
        );
        const mainManifest = JSON.parse(mainZip.get('manifest.json').toString());
        assert.deepEqual(mainZip.get(mainManifest.files[0].path), fixtures['clip.mp4'].bytes);
        assert.equal(mainManifest.files[0].outputId, null);
        assert.equal((await preview(done.id, [randomUUID()])).status, 404);
        assert.equal((await preview(done.id, [(await read(other.data.id)).outputs[0].id])).status, 404);
        assert.equal((await preview(done.id, [first.id, first.id])).status, 400);
        assert.equal(
          (
            await preview(
              done.id,
              Array.from({ length: 41 }, () => randomUUID()),
            )
          ).status,
          400,
        );
        const voice = await owner(
          'POST',
          path + '/entities',
          {
            kind: 'voice',
            body: {
              name: 'Protected generated sound',
              media: [{ role: 'voice_sample', mediaVersionId: audio.mediaVersionId }],
            },
          },
          { 'Idempotency-Key': randomUUID() },
        );
        assert.equal(voice.status, 201, JSON.stringify(voice.data));
        assert.equal((await preview(done.id, [audio.id], viewer)).status, 403);
        assert.equal((await preview(done.id, [first.id], viewer)).status, 200);
        const trial = await submit('workflow-trials');
        for (let i = 0; i < 3; i++) await tick();
        assert.equal((await preview(trial.data.id, [null])).status, 409);
        assert.equal((await archive(trial.data.id, [null])).status, 409);
        assert.equal((await read(done.id)).outputs[0].inLibrary, false);
        assert.deepEqual(db().pragma('foreign_key_check'), []);
      },
    );

    await t.test(
      'output packages reject corrupt originals and revoke or cancel streams without touching media',
      async () => {
        const { GenerationOutputPackageService } =
          await import('../dist/generation/generation-output-package.service.js');
        const { MediaService } = await import('../dist/assets/media.service.js');
        const { LocalStorage } = await import('../dist/storage/local-storage.js');
        const workflow = await owner(
          'POST',
          '/projects/' + project.id + '/generation-workflows',
          fixturePrimaryBatch(connectionId),
        );
        const queued = await owner(
          'POST',
          '/projects/' + project.id + '/generation-jobs',
          { workflowId: workflow.data.id, positivePrompt: 'Stable package originals', confirmed: true },
          { 'Idempotency-Key': randomUUID() },
        );
        for (let i = 0; i < 3; i++) await tick();
        const done = await read(queued.data.id),
          service = app.get(GenerationOutputPackageService);
        const endpoint = '/generation-jobs/' + done.id + '/output-package?outputIds=main';
        const row = db().prepare('SELECT * FROM media_versions WHERE id=?').get(done.mediaVersionId);
        const originalPath = await app.get(LocalStorage).path(row.object_key),
          bytes = await readFile(originalPath);
        try {
          await writeFile(originalPath, Buffer.alloc(bytes.length));
          assert.equal((await owner('GET', endpoint)).status, 409);
        } finally {
          await writeFile(originalPath, bytes);
        }
        const reader = { id: viewerId, instanceAdmin: false };
        const stream = await service.file(reader, done.id, [null, done.outputs[0].id]);
        db()
          .prepare('DELETE FROM project_members WHERE project_id=? AND user_id=?')
          .run(project.id, viewerId);
        try {
          await assert.rejects(async () => {
            for await (const _ of stream.stream) {
            }
          });
          assert.equal((await viewer('GET', endpoint)).status, 404);
        } finally {
          await owner('POST', '/projects/' + project.id + '/members', { userId: viewerId, role: 'VIEWER' });
        }
        const abort = new AbortController();
        const cancelled = await service.file(reader, done.id, [null], abort.signal);
        abort.abort();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(cancelled.stream.destroyed, true);
        const media = app.get(MediaService),
          old = media.version;
        media.version = function (user, id) {
          const v = old.call(this, user, id);
          return { ...v, byteLength: 3 * 1024 * 1024 * 1024 };
        };
        try {
          assert.throws(() => service.preview(reader, done.id, [null]), /单次原件包最多/);
        } finally {
          media.version = old;
        }
        assert.equal((await read(done.id)).inLibrary, false);
        assert.deepEqual((await owner('GET', done.result.contentUrl.replace('/api/v1', ''))).data, bytes);
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
