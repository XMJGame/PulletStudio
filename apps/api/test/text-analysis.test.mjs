import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startTextMock, mockDraft } from '../../../tests/fixtures/text-mock.mjs';

test('bounded source chunks preserve Unicode and source validation rejects invented references', async () => {
  const { sourceChunks, validateShotDraft } = await import('../dist/analysis/analysis-contract.js');
  const text = ('🚆'.repeat(4501) + '\r\nA dialogue.\r\n\r\n').repeat(2);
  const chunks = sourceChunks('revision', text);
  assert.ok(chunks.length > 1); assert.ok(chunks.every(chunk => chunk.endOffset - chunk.startOffset <= 8000));
  assert.equal(chunks.flatMap(chunk => chunk.blocks).map(block => block.text).join(''), text);
  for (const chunk of chunks) for (const block of chunk.blocks) assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(block.text)), block.text);
  assert.deepEqual(chunks, sourceChunks('revision', text));
  assert.equal(validateShotDraft(mockDraft({ chunk: chunks[0] }), chunks[0].blocks).shots[0].sources[0].revisionId, 'revision');
  assert.throws(() => validateShotDraft(mockDraft({ chunk: chunks[0] }, true), chunks[0].blocks), /范围之外/);
});

test('text connection, persistent analysis queue, leases and safe recovery', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-analysis-')); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite'); process.env.SETUP_TOKEN = 'text-analysis-local-test-setup-token-2026'; process.env.COOKIE_SECURE = 'false'; process.env.PROVIDER_MASTER_KEY = 'a'.repeat(64);
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { TextAnalysisWorker } = await import('../dist/analysis/text-analysis-worker.js');
  const { AuthorizationService } = await import('../dist/production/authorization.service.js');
  const { TextConnectionsService } = await import('../dist/providers/text-connections.service.js');
  const { SafeTextHttp } = await import('../dist/providers/safe-text-http.js');
  const { repositoryRoot } = await import('../dist/config.js');
  const mock = await startTextMock(); let app, base, workspace, project, connection, modelId, editorId;
  async function start() { app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); }
  function client() { let cookies = '', csrf = ''; return { async request(method, path, body, key) {
    const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', 'X-CSRF-Token': csrf, Cookie: cookies, ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const incoming = response.headers.getSetCookie(); if (incoming.length) cookies = incoming.map(value => value.split(';')[0]).join('; ');
    const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken; return { status: response.status, data };
  } }; }
  const owner = client(), editor = client(), viewer = client(), outsider = client();
  const queuePath = () => `/projects/${project.id}/analysis-runs`;
  const connectionPath = () => `/workspaces/${workspace.id}/text-connections`;
  const profile = model => ({ name: `Fixture ${model}`, model, outputMode: 'json_schema', maxOutputTokens: 4096, timeoutSeconds: 10 });
  const payload = id => ({ modelProfileId: id || modelId, revisionVersion: 1, chunkIndex: 0, contextSummary: '', expectedProjectVersion: 1, acknowledgeExternalProcessing: true });
  const worker = () => app.get(TextAnalysisWorker);
  async function model(name) { const result = await owner.request('POST', `/text-connections/${connection.id}/models`, profile(name)); assert.equal(result.status, 201); return result.data.id; }
  async function submit(id = modelId) { const result = await editor.request('POST', queuePath(), payload(id), randomUUID()); assert.equal(result.status, 201); return result.data; }
  async function read(id) { return (await owner.request('GET', `/analysis-runs/${id}`)).data; }
  async function waitUntil(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('mock request did not arrive'); }
  try {
    await start(); const setup = await owner.request('POST', '/setup/initialize', { setupToken: process.env.SETUP_TOKEN, email: 'owner@analysis.test', password: 'Studio8!', name: 'Owner', workspaceName: 'Analysis' }); workspace = setup.data.workspace;
    project = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Platform dialogue', workFormat: 'short', narrativeMode: 'dialogue' })).data;
    for (const [target, email, role] of [[editor, 'editor@analysis.test', 'EDITOR'], [viewer, 'viewer@analysis.test', 'VIEWER']]) {
      const invite = await owner.request('POST', `/workspaces/${workspace.id}/invitations`, { email }); const accepted = await target.request('POST', '/invitations/accept', { token: invite.data.token, name: email, password: 'Studio8!' });
      await owner.request('POST', `/projects/${project.id}/members`, { userId: accepted.data.user.id, role }); if (role === 'EDITOR') editorId = accepted.data.user.id;
    }
    const other = (await owner.request('POST', '/workspaces', { name: 'Other' })).data; const invite = await owner.request('POST', `/workspaces/${other.id}/invitations`, { email: 'outside@analysis.test' }); await outsider.request('POST', '/invitations/accept', { token: invite.data.token, name: 'Outside', password: 'Studio8!' });
    await editor.request('POST', `/projects/${project.id}/script`, { title: 'Platform', content: 'Mira waits for the train.\r\nNoah folds an umbrella. 🚆', expectedVersion: 0 });
    await t.test('connection approval, encrypted credentials and model separation', async () => {
      const input = { name: 'Isolated mock', baseUrl: mock.baseUrl, trustedPrivate: true, apiKey: 'fixture-secret', profile: profile('valid') };
      assert.equal((await editor.request('POST', connectionPath(), input)).status, 403);
      assert.equal((await owner.request('POST', connectionPath(), { ...input, trustedPrivate: false })).status, 400);
      const created = await owner.request('POST', connectionPath(), input); assert.equal(created.status, 201); modelId = created.data.profileId;
      connection = (await owner.request('GET', connectionPath())).data.items[0]; assert.equal(connection.hasApiKey, true); assert.ok(!JSON.stringify(connection).includes('fixture-secret')); assert.ok(!('encryptedSecret' in connection));
      const raw = app.get(DatabaseService).sqlite.prepare('SELECT encrypted_secret FROM text_connections').get(); assert.ok(!raw.encrypted_secret.includes('fixture-secret'));
      assert.equal((await viewer.request('GET', connectionPath())).status, 200);
      assert.equal((await outsider.request('GET', connectionPath())).status, 404);
    });
    await t.test('idempotent creation freezes selected source and project settings without generating formal shots', async () => {
      const chunks = await editor.request('GET', `/projects/${project.id}/analysis-chunks?revisionVersion=1`); assert.equal(chunks.data.items.length, 1);
      const key = randomUUID(); const created = await editor.request('POST', queuePath(), payload(), key); assert.equal(created.status, 201);
      const repeated = await editor.request('POST', queuePath(), payload(), key); assert.equal(repeated.data.id, created.data.id);
      assert.equal((await editor.request('POST', queuePath(), { ...payload(), contextSummary: 'changed' }, key)).status, 409);
      assert.equal((await viewer.request('POST', queuePath(), payload(), randomUUID())).status, 403);
      assert.equal((await editor.request('POST', queuePath(), { ...payload(), acknowledgeExternalProcessing: false }, randomUUID())).status, 400);
      await worker().tick(); const result = await read(created.data.id); assert.equal(result.state, 'completed'); assert.equal(result.proposal.status, 'draft'); assert.equal(result.proposal.body.shots[0].sources[0].revisionId, result.revisionId);
      assert.equal(result.settings.narrativeMode, 'dialogue'); assert.equal(result.attempts, 1);
      assert.equal(mock.requests[0].authorization, 'Bearer fixture-secret'); assert.equal(mock.requests[0].body.response_format.type, 'json_schema');
      assert.ok(!JSON.stringify(result).includes('fixture-secret'));
      assert.equal(app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) count FROM shots').get().count, 0);
      assert.equal((await outsider.request('GET', `/analysis-runs/${result.id}`)).status, 404);
      assert.throws(() => app.get(DatabaseService).sqlite.prepare('UPDATE analysis_proposals SET body_json = ?').run('{}'), /immutable/);
    });
    await t.test('invalid model JSON, schema and source references never publish a proposal', async () => {
      for (const [name, code] of [['invalid_json', 'PROVIDER_INVALID_JSON'], ['invalid_schema', 'PROPOSAL_SCHEMA_INVALID'], ['invalid_source', 'PROPOSAL_SOURCE_INVALID']]) {
        const job = await submit(await model(name)); await worker().tick(); const result = await read(job.id); assert.equal(result.state, 'failed'); assert.equal(result.errorCode, code); assert.equal(result.proposal, null);
      }
    });
    await t.test('429 respects Retry-After; server errors and disconnected submissions require reconciliation', async () => {
      const job = await submit(await model('rate_limit')); await worker().tick(); let result = await read(job.id);
      assert.equal(result.state, 'retry_waiting'); assert.ok(result.nextRunAt > Date.now() + 50000); assert.equal(await worker().tick(), false);
      app.get(DatabaseService).sqlite.prepare('UPDATE analysis_runs SET next_run_at = 0 WHERE id = ?').run(job.id);
      await worker().tick(); result = await read(job.id); assert.equal(result.state, 'completed'); assert.equal(result.attempts, 2);
      for (const name of ['server_error', 'disconnect']) { const uncertain = await submit(await model(name)); await worker().tick(); const state = await read(uncertain.id); assert.equal(state.state, 'needs_reconciliation'); assert.ok(!JSON.stringify(state).includes('fixture-secret-error-body')); const hits = mock.requests.length; assert.equal(await worker().tick(), false); assert.equal(mock.requests.length, hits);
        assert.equal((await owner.request('POST', `/analysis-runs/${state.id}/retry`, { expectedVersion: state.version })).status, 400);
      }
    });
    await t.test('lease claim is exclusive and stale in-flight results cannot publish after recovery', async () => {
      const job = await submit(await model('hold')); const running = worker().tick(); await waitUntil(() => mock.pending.length > 0);
      assert.equal((await read(job.id)).state, 'submitted');
      const second = new TextAnalysisWorker(app.get(DatabaseService), app.get(AuthorizationService), app.get(TextConnectionsService), app.get(SafeTextHttp)); assert.equal(second.claim(), undefined);
      app.get(DatabaseService).sqlite.prepare('UPDATE analysis_runs SET lease_until = 0 WHERE id = ?').run(job.id); second.recover();
      mock.pending.shift()(); await running; const result = await read(job.id); assert.equal(result.state, 'needs_reconciliation'); assert.equal(result.proposal, null);
      const retry = await owner.request('POST', `/analysis-runs/${job.id}/retry`, { expectedVersion: result.version, acknowledgePossibleCharge: true }); assert.equal(retry.status, 201); assert.equal(retry.data.state, 'queued');
      await owner.request('POST', `/analysis-runs/${job.id}/cancel`, { expectedVersion: retry.data.version });
    });
    await t.test('stopping an in-flight request prevents publishing without claiming a remote cancellation', async () => {
      const job = await submit(await model('hold')); const running = worker().tick(); await waitUntil(() => mock.pending.length > 0);
      const submitted = await read(job.id); const stopped = await owner.request('POST', `/analysis-runs/${job.id}/cancel`, { expectedVersion: submitted.version });
      assert.equal(stopped.status, 201); assert.match(stopped.data.errorMessage, /不代表远端/);
      mock.pending.shift()(); await running; const result = await read(job.id); assert.equal(result.state, 'cancelled'); assert.equal(result.proposal, null);
    });
    await t.test('queue cancellation, disabled connections and member removal prevent requests', async () => {
      const cancelled = await submit(); assert.equal((await owner.request('POST', `/analysis-runs/${cancelled.id}/cancel`, { expectedVersion: cancelled.version })).status, 201); const hits = mock.requests.length; assert.equal(await worker().tick(), false); assert.equal(mock.requests.length, hits);
      const disabled = await submit(); assert.equal((await owner.request('PATCH', `/text-connections/${connection.id}`, { expectedVersion: 1, enabled: false })).status, 200); await worker().tick(); assert.equal((await read(disabled.id)).errorCode, 'ANALYSIS_CONNECTION_CHANGED');
      await owner.request('PATCH', `/text-connections/${connection.id}`, { expectedVersion: 2, enabled: true });
      const removed = await submit(); await owner.request('DELETE', `/projects/${project.id}/members/${editorId}`, { expectedRole: 'EDITOR' }); await worker().tick(); assert.equal((await read(removed.id)).errorCode, 'ANALYSIS_ACCESS_REVOKED');
      assert.equal((await editor.request('GET', `/analysis-runs/${removed.id}`)).status, 404); await owner.request('POST', `/projects/${project.id}/members`, { userId: editorId, role: 'EDITOR' });
      assert.equal(mock.requests.length, hits);
    });
    await t.test('preparing leases recover and a real independent Worker process resumes a persisted queue after API restart', async () => {
      const job = await submit(); const claim = worker().claim(); assert.equal(claim.id, job.id); app.get(DatabaseService).sqlite.prepare('UPDATE analysis_runs SET lease_until = 0 WHERE id = ?').run(job.id); await app.close(); app = undefined;
      const result = await promisify(execFile)(process.execPath, [join(repositoryRoot, 'apps/api/dist/text-worker.js'), '--once'], { cwd: repositoryRoot, env: { ...process.env }, timeout: 15000 }); assert.match(result.stdout, /worker ready/); assert.ok(!result.stdout.includes('fixture-secret'));
      await start(); assert.equal((await read(job.id)).state, 'completed'); assert.equal((await read(job.id)).attempts, 2);
      assert.equal((await owner.request('GET', `/workspaces/${workspace.id}/analysis-status`)).data.online, true);
      const sqlite = app.get(DatabaseService).sqlite; assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
    });
    await t.test('two independent processes can migrate and start against the same empty database', async () => {
      const env = { ...process.env, DATABASE_PATH: join(directory, 'simultaneous.sqlite') };
      const launch = () => promisify(execFile)(process.execPath, [join(repositoryRoot, 'apps/api/dist/text-worker.js'), '--once'], { cwd: repositoryRoot, env, timeout: 15000 });
      const results = await Promise.all([launch(), launch()]);
      assert.ok(results.every(result => result.stdout.includes('worker ready')));
    });
    await t.test('trashing a project stops a queued analysis before sending any source text', async () => {
      const job = await submit(); const hits = mock.requests.length;
      assert.equal((await owner.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 1 })).status, 201);
      await worker().tick(); assert.equal(mock.requests.length, hits); assert.equal((await owner.request('GET', `/analysis-runs/${job.id}`)).status, 404);
      await owner.request('POST', `/projects/${project.id}/restore`, { expectedVersion: 2 });
      assert.equal((await read(job.id)).errorCode, 'ANALYSIS_ACCESS_REVOKED');
    });
  } finally { if (app) await app.close(); await mock.close(); await rm(directory, { recursive: true, force: true }); }
});
