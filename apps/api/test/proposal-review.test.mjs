import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { startTextMock } from '../../../tests/fixtures/text-mock.mjs';

test('proposal revisions, review gate and atomic shot adoption', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-review-')); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite'); process.env.SETUP_TOKEN = 'proposal-review-local-test-setup-token-2026'; process.env.COOKIE_SECURE = 'false'; process.env.PROVIDER_MASTER_KEY = 'a'.repeat(64);
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { TextAnalysisWorker } = await import('../dist/analysis/text-analysis-worker.js');
  const mock = await startTextMock(); let app, base, workspace, project, proposal, adopted, reviewerId, other;
  async function start() { app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); }
  function client() { let cookies = '', csrf = ''; return { async request(method, path, body, key) {
    const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', 'X-CSRF-Token': csrf, Cookie: cookies, ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const incoming = response.headers.getSetCookie(); if (incoming.length) cookies = incoming.map(value => value.split(';')[0]).join('; ');
    const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken; return { status: response.status, data };
  } }; }
  const owner = client(), editor = client(), reviewer = client(), viewer = client();
  const p = suffix => `/proposals/${proposal.id}${suffix}`;
  const strip = shot => { const { sources, ...fields } = shot; return fields; };
  async function read() { return (await owner.request('GET', p(''))).data; }
  async function generate(model = 'valid', scriptVersion = 1, projectVersion = 1) {
    const connection = await owner.request('POST', `/workspaces/${workspace.id}/text-connections`, { name: `Mock ${model}`, baseUrl: mock.baseUrl, trustedPrivate: true, profile: { name: model, model, outputMode: 'json_schema' } });
    const run = await editor.request('POST', `/projects/${project.id}/analysis-runs`, { modelProfileId: connection.data.profileId, revisionVersion: scriptVersion, expectedProjectVersion: projectVersion, chunkIndex: 0, acknowledgeExternalProcessing: true }, randomUUID());
    assert.equal(run.status, 201); await app.get(TextAnalysisWorker).tick();
    const done = await owner.request('GET', `/analysis-runs/${run.data.id}`); assert.equal(done.data.state, 'completed'); return done.data.proposal;
  }
  try {
    await start(); const setup = await owner.request('POST', '/setup/initialize', { setupToken: process.env.SETUP_TOKEN, email: 'owner@review.test', password: 'Studio8!', name: 'Owner', workspaceName: 'Review' }); workspace = setup.data.workspace;
    project = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Platform' })).data;
    other = (await owner.request('POST', '/projects', { workspaceId: workspace.id, title: 'Other' })).data;
    for (const [target, email, role] of [[editor, 'editor@review.test', 'EDITOR'], [reviewer, 'reviewer@review.test', 'REVIEWER'], [viewer, 'viewer@review.test', 'VIEWER']]) {
      const invite = await owner.request('POST', `/workspaces/${workspace.id}/invitations`, { email }); const accepted = await target.request('POST', '/invitations/accept', { token: invite.data.token, name: email, password: 'Studio8!' });
      await owner.request('POST', `/projects/${project.id}/members`, { userId: accepted.data.user.id, role }); if (role === 'REVIEWER') reviewerId = accepted.data.user.id;
    }
    await editor.request('POST', `/projects/${project.id}/script`, { title: 'Platform', content: 'Mira waits.\r\nNoah waves. 🚆', expectedVersion: 0 }); proposal = await generate();
    await t.test('original v0 stays immutable and reads do not create review rows', async () => {
      const before = app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) count FROM proposal_reviews').get().count;
      const current = await read(); assert.equal(current.version, 0); assert.equal(current.status, 'draft');
      assert.equal(app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) count FROM proposal_reviews').get().count, before);
      const response = await reviewer.request('POST', p('/accept'), { expectedVersion: 0, expectedProjectVersion: 1, unitId: null, acknowledgeCreation: true });
      assert.equal(response.status, 400); assert.equal((await read()).version, 0);
      assert.equal(app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) count FROM shots').get().count, 0);
    });
    await t.test('editing appends revisions, validates sources and uses optimistic locking', async () => {
      const current = await read(); const shot = { ...strip(current.body.shots[0]), durationSeconds: 8, description: 'Human-reviewed platform shot' };
      assert.equal((await viewer.request('PATCH', p('/shots/0'), { expectedVersion: 0, shot })).status, 403);
      assert.equal((await reviewer.request('PATCH', p('/shots/0'), { expectedVersion: 0, shot })).status, 403);
      const saved = await editor.request('PATCH', p('/shots/0'), { expectedVersion: 0, shot, summary: 'Clarify action' }); assert.equal(saved.status, 200); assert.equal(saved.data.version, 1);
      assert.equal((await editor.request('PATCH', p('/shots/0'), { expectedVersion: 0, shot })).status, 409);
      assert.equal((await editor.request('PATCH', p('/shots/0'), { expectedVersion: 1, shot: { ...shot, sourceSpanIds: ['f'.repeat(64)] } })).status, 400);
      const history = await owner.request('GET', p('/versions')); assert.deepEqual(history.data.items.map(row => row.version), [1, 0]);
      assert.notEqual((await owner.request('GET', p('/versions/0'))).data.body.shots[0].description, shot.description);
    });
    await t.test('reviewers can reject/reopen but editors cannot approve or acquire general edit authority', async () => {
      const access = (await reviewer.request('GET', `/projects/${project.id}/access`)).data; assert.equal(access.canReview, true); assert.equal(access.canEdit, false);
      assert.equal((await editor.request('POST', p('/reject'), { expectedVersion: 1, reason: 'Review needed' })).status, 403);
      const reject = await reviewer.request('POST', p('/reject'), { expectedVersion: 1, reason: 'Clarify timing' }); assert.equal(reject.status, 201); assert.equal(reject.data.status, 'rejected');
      assert.equal((await editor.request('PATCH', p('/shots/0'), { expectedVersion: 2, shot: strip(reject.data.body.shots[0]) })).status, 409);
      assert.equal((await reviewer.request('POST', p('/reopen'), { expectedVersion: 2, reason: 'Ready for revision' })).data.version, 3);
      assert.equal((await reviewer.request('POST', `/projects/${project.id}/shots`, {})).status, 403);
    });
    await t.test('changed source/settings need explicit acknowledgment; acceptance creates exact immutable evidence', async () => {
      await editor.request('POST', `/projects/${project.id}/script`, { title: 'New revision', content: 'Changed script must not replace old references.', expectedVersion: 1 });
      await owner.request('PATCH', `/projects/${project.id}`, { title: 'Updated project', expectedVersion: 1 });
      const current = await read(); assert.equal(current.inputChanges.scriptChanged, true); assert.equal(current.inputChanges.projectChanged, true);
      const input = { expectedVersion: 3, expectedProjectVersion: 2, unitId: null, acknowledgeCreation: true };
      assert.equal((await editor.request('POST', p('/accept'), input)).status, 403);
      assert.equal((await reviewer.request('POST', p('/accept'), input)).status, 409);
      const accepted = await reviewer.request('POST', p('/accept'), { ...input, acknowledgeInputChanges: true }); assert.equal(accepted.status, 201); assert.equal(accepted.data.status, 'accepted'); assert.equal(accepted.data.version, 4); adopted = accepted.data.adoptedShots[0];
      const repeated = await reviewer.request('POST', p('/accept'), { ...input, acknowledgeInputChanges: true }); assert.equal(repeated.status, 201); assert.equal(repeated.data.alreadyAccepted, true); assert.equal(repeated.data.adoptedShots[0].id, adopted.id);
      const card = (await viewer.request('GET', `/shots/${adopted.id}/card`)).data;
      assert.equal(card.available, true); assert.equal(card.body.intent, current.body.shots[0].intent); assert.equal(card.body.durationSeconds, 8); assert.equal(card.origin.proposalVersion, 4);
      for (const source of card.sources) assert.equal(source.textHash, createHash('sha256').update(source.text).digest('hex'));
      assert.equal(card.sources[0].revisionVersion, 1);
      assert.equal((await reviewer.request('POST', p('/reopen'), { expectedVersion: 4, reason: 'Unsafe' })).status, 409);
      assert.equal((await editor.request('PATCH', p('/shots/0'), { expectedVersion: 4, shot: strip(current.body.shots[0]) })).status, 409);
    });
    await t.test('legacy shot edits append complete cards without dropping provenance or historical fields', async () => {
      const result = await editor.request('PATCH', `/shots/${adopted.id}`, { description: 'x'.repeat(3000), camera: 'Human camera move', durationHint: 9, expectedVersion: 1 }); assert.equal(result.status, 200);
      const card = (await viewer.request('GET', `/shots/${adopted.id}/card`)).data; assert.equal(card.version, 2); assert.equal(card.body.description.length, 3000); assert.equal(card.body.cameraMovement, 'Human camera move'); assert.equal(card.body.durationSeconds, 9); assert.equal(card.origin.proposalId, proposal.id);
      const old = (await viewer.request('GET', `/shots/${adopted.id}/card/versions/1`)).data; assert.equal(old.body.description, 'Human-reviewed platform shot');
      const editorCard = (await editor.request('GET', `/shots/${adopted.id}/card/editor`)).data;
      const full = await editor.request('PATCH', `/shots/${adopted.id}/card`, { expectedVersion: 2, body: {...editorCard.body, composition:'Human revised full composition', sourceAudioPolicy:'keep'} });
      assert.equal(full.status, 200); assert.equal(full.data.card.version, 3);
      assert.deepEqual(full.data.card.sources, card.sources); assert.deepEqual(full.data.card.origin, card.origin);
      assert.equal((await viewer.request('GET', `/shots/${adopted.id}/card/versions/2`)).data.body.description.length, 3000);
      const db = app.get(DatabaseService).sqlite;
      for (const table of ['proposal_revisions', 'shot_card_revisions', 'script_spans', 'shot_script_spans', 'proposal_adoptions']) assert.throws(() => db.prepare(`DELETE FROM ${table}`).run(), /immutable/);
    });
    await t.test('foreign targets and an injected mid-adoption failure roll back all shots, counters and review records', async () => {
      proposal = await generate('two_shots', 2, 2); let current = await read();
      for (let index = 0; index < 2; index++) { const result = await editor.request('PATCH', p(`/shots/${index}`), { expectedVersion: current.version, shot: { ...strip(current.body.shots[index]), durationSeconds: 7 } }); assert.equal(result.status, 200); current = result.data; }
      const foreign = (await owner.request('POST', `/projects/${other.id}/units`, { kind: 'scene', title: 'Outside' })).data;
      const input = { expectedVersion: 2, expectedProjectVersion: 2, unitId: foreign.id, acknowledgeCreation: true };
      assert.equal((await reviewer.request('POST', p('/accept'), input)).status, 404);
      const unit = (await owner.request('POST', `/projects/${project.id}/units`, { kind: 'scene', title: 'Target scene' })).data;
      const db = app.get(DatabaseService).sqlite; const before = db.prepare('SELECT COUNT(*) count FROM shots').get().count;
      db.exec("CREATE TRIGGER fixture_reject_second BEFORE INSERT ON shot_card_revisions WHEN json_extract(NEW.body_json, '$.title') = 'Second fixture shot' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END;");
      const failed = await reviewer.request('POST', p('/accept'), { ...input, unitId: unit.id }); assert.equal(failed.status, 409);
      assert.equal(db.prepare('SELECT COUNT(*) count FROM shots').get().count, before); assert.equal((await read()).version, 2); assert.equal(db.prepare('SELECT next_shot_number n FROM episodes WHERE id=?').get(unit.id).n, 1);
      db.exec('DROP TRIGGER fixture_reject_second');
      const accepted = await Promise.all([owner, reviewer].map(actor => actor.request('POST', p('/accept'), { ...input, unitId: unit.id })));
      assert.ok(accepted.every(item => item.status === 201)); assert.equal(db.prepare('SELECT COUNT(*) count FROM shots').get().count, before + 2); assert.deepEqual(accepted[0].data.adoptedShots.map(shot => shot.code), ['SH001', 'SH002']);
    });
    await t.test('restart preserves reviews and cards; removed members and trashed projects cannot inspect or act', async () => {
      await app.close(); await start(); assert.equal((await read()).status, 'accepted'); assert.equal((await viewer.request('GET', `/shots/${adopted.id}/card`)).data.version, 3);
      await owner.request('DELETE', `/projects/${project.id}/members/${reviewerId}`, { expectedRole: 'REVIEWER' }); assert.equal((await reviewer.request('GET', p(''))).status, 404);
      await owner.request('POST', `/projects/${project.id}/trash`, { expectedVersion: 2 });
      assert.equal((await owner.request('GET', p(''))).status, 404); assert.equal((await owner.request('GET', `/shots/${adopted.id}/card`)).status, 404);
      const db = app.get(DatabaseService).sqlite; assert.equal(db.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(db.pragma('foreign_key_check'), []);
    });
  } finally { if (app) await app.close(); await mock.close(); await rm(directory, { recursive: true, force: true }); }
});
