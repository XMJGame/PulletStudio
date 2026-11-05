import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';

test('take reviews preserve exact approvals and explicit versioned shot selection', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-take-review-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.MEDIA_ROOT = join(directory, 'media');
  process.env.SETUP_TOKEN = 'isolated-take-review-fixture-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { AppConfig } = await import('../dist/config.js');
  const { backupDatabase } = await import('../dist/db/backup.js');
  let app, base, workspace, project, shot, take, second, otherShot, reviewerId;
  function client() {
    let cookies = '',
      csrf = '';
    return async (method, path, body, headers = {}) => {
      const binary = Buffer.isBuffer(body);
      const response = await fetch(base + '/api/v1' + path, {
        method,
        headers: {
          'Content-Type': binary ? 'application/octet-stream' : 'application/json',
          'X-Studio-Request': '1',
          Cookie: cookies,
          'X-CSRF-Token': csrf,
          ...headers,
        },
        body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
      });
      const incoming = response.headers.getSetCookie();
      if (incoming.length) cookies = incoming.map((value) => value.split(';')[0]).join('; ');
      const data = await response.json();
      if (data.csrfToken) csrf = data.csrfToken;
      return { status: response.status, data };
    };
  }
  const owner = client(),
    editor = client(),
    reviewer = client(),
    reviewer2 = client(),
    viewer = client(),
    outsider = client();
  const start = async () => {
    app = await createApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  };
  const db = () => app.get(DatabaseService).sqlite;
  const state = async (candidate = take, actor = owner) =>
    (await actor('GET', `/takes/${candidate.id}/reviews`)).data;
  const decide = (
    action,
    expectedDecisionVersion,
    actor = owner,
    candidate = take,
    key = randomUUID(),
    reason = 'Checked exact media and context.',
  ) =>
    actor(
      'POST',
      `/takes/${candidate.id}/reviews`,
      { action, expectedDecisionVersion, reason },
      { 'Idempotency-Key': key },
    );
  const selection = async (target = shot, actor = owner) =>
    (await actor('GET', `/shots/${target.id}/take-selection`)).data;
  const select = (
    takeId,
    version,
    actor = owner,
    target = shot,
    key = randomUUID(),
    reason = 'Use the reviewed version.',
  ) =>
    actor(
      'POST',
      `/shots/${target.id}/take-selection`,
      { takeId, expectedSelectionVersion: version, reason },
      { 'Idempotency-Key': key },
    );
  async function fullShot(target = project) {
    const created = (
      await owner('POST', `/projects/${target.id}/shots`, { description: 'A traveler reaches a station.' })
    ).data;
    const card = (await owner('GET', `/shots/${created.id}/card/editor`)).data;
    return (
      await owner('PATCH', `/shots/${created.id}/card`, { expectedVersion: created.version, body: card.body })
    ).data.shot;
  }
  try {
    await start();
    const setup = (
      await owner('POST', '/setup/initialize', {
        setupToken: process.env.SETUP_TOKEN,
        email: 'owner@take.test',
        password: 'Studio8!',
        name: 'Owner',
        workspaceName: 'Film team',
      })
    ).data;
    workspace = setup.workspace;
    project = (await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Station film' })).data;
    for (const [actor, role, name] of [
      [editor, 'EDITOR', 'Artist'],
      [reviewer, 'REVIEWER', 'Director'],
      [reviewer2, 'REVIEWER', 'Reviewer2'],
      [viewer, 'VIEWER', 'Viewer'],
      [outsider, null, 'Outsider'],
    ]) {
      const invite = (
        await owner('POST', `/workspaces/${workspace.id}/invitations`, { email: name + '@take.test' })
      ).data;
      const accepted = (
        await actor('POST', '/invitations/accept', { token: invite.token, name, password: 'Studio8!' })
      ).data;
      if (role) await owner('POST', `/projects/${project.id}/members`, { userId: accepted.user.id, role });
      if (actor === reviewer) reviewerId = accepted.user.id;
    }
    shot = await fullShot();
    const fixtures = await createMediaFixtures(join(directory, 'fixtures'), new AppConfig().ffmpegPath);
    const upload = async (file) => {
      const intent = await owner(
        'POST',
        `/projects/${project.id}/media-uploads`,
        { fileName: file, byteLength: fixtures[file].bytes.length },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal(intent.status, 201, JSON.stringify(intent.data));
      const result = await owner('PUT', `/media-uploads/${intent.data.id}/content`, fixtures[file].bytes);
      assert.equal(result.data.state, 'complete', JSON.stringify(result.data));
      return result.data.mediaVersion;
    };
    const image = await upload('image.png'),
      video = await upload('clip.mp4');
    take = (
      await owner('POST', `/shots/${shot.id}/takes`, {
        mediaVersionId: image.id,
        expectedShotVersion: shot.version,
      })
    ).data;
    second = (
      await owner('POST', `/shots/${shot.id}/takes`, {
        mediaVersionId: video.id,
        expectedShotVersion: shot.version,
      })
    ).data;

    await t.test('legacy drafts require a full card, edit and independent review permissions', async () => {
      assert.equal((await state()).status, 'draft');
      assert.equal((await state()).decisionVersion, 0);
      assert.equal((await decide('submit', 0, viewer)).status, 403);
      assert.equal((await decide('submit', 0, reviewer)).status, 403);
      assert.equal((await decide('approve', 0, editor)).status, 403);
      assert.equal((await decide('approve', 0)).data.code, 'TAKE_REVIEW_TRANSITION');
      assert.equal((await select(take.id, 0)).data.code, 'TAKE_NOT_APPROVED');
      assert.equal((await outsider('GET', `/takes/${take.id}/reviews`)).status, 404);
      assert.equal((await outsider('GET', `/shots/${shot.id}/take-selection`)).status, 404);
      const blank = (await owner('POST', `/projects/${project.id}/shots`, {})).data;
      const raw = (
        await owner('POST', `/shots/${blank.id}/takes`, {
          mediaVersionId: image.id,
          expectedShotVersion: blank.version,
        })
      ).data;
      assert.equal((await decide('submit', 0, editor, raw)).data.code, 'CARD_REQUIRED');
      assert.equal(
        (
          await owner(
            'POST',
            `/takes/${take.id}/reviews`,
            { action: 'submit', reason: ' ', expectedDecisionVersion: 0 },
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        400,
      );
      assert.equal((await decide('submit', 0, editor, take, randomUUID(), 'x')).status, 201);
      const submitted = await state();
      assert.equal(submitted.context.shotVersion, shot.version);
      assert.equal(submitted.context.projectVersion, project.version);
      assert.equal(submitted.context.promptId, null);
      assert.equal(submitted.context.generationJobId, null);
      const sound = await upload('sound.wav');
      const voice = await owner(
        'POST',
        `/projects/${project.id}/entities`,
        {
          kind: 'voice',
          body: { name: 'Narrator sample', media: [{ role: 'voice_sample', mediaVersionId: sound.id }] },
        },
        { 'Idempotency-Key': randomUUID() },
      );
      assert.equal(voice.status, 201, JSON.stringify(voice.data));
      const audio = (
        await owner('POST', `/shots/${shot.id}/takes`, {
          mediaVersionId: sound.id,
          expectedShotVersion: shot.version,
        })
      ).data;
      assert.equal((await decide('submit', 0, editor, audio)).data.code, 'VOICE_SAMPLE_RESTRICTED');
    });
    await t.test('concurrent reviewers accept one decision and retries remain immutable', async () => {
      const key = randomUUID();
      const results = await Promise.all([
        decide('approve', 1, reviewer, take, key),
        decide('reject', 1, reviewer2),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const current = await state();
      assert.equal(current.decisionVersion, 2);
      assert.equal(current.items.length, 2);
      assert.equal(current.items[0].shotVersion, shot.version);
      if (current.status === 'rejected') {
        await decide('submit', 2, editor);
        await decide('approve', 3, reviewer);
      } else {
        assert.equal((await decide('approve', 1, reviewer, take, key)).data.id, results[0].data.id);
        assert.equal(
          (await decide('approve', 1, reviewer, take, key, 'Changed reason')).data.code,
          'IDEMPOTENCY_CONFLICT',
        );
      }
      assert.equal(
        (await decide('submit', (await state()).decisionVersion, editor)).data.code,
        'TAKE_REVIEW_TRANSITION',
      );
      const history = await state(take, viewer);
      assert.equal(history.canEdit, false);
      assert.equal(history.canReview, false);
      assert.ok(history.items.some((r) => r.actorName === 'Director'));
    });
    await t.test('selection is explicit, versioned and protected from new candidates', async () => {
      assert.equal((await select(take.id, 0, editor)).status, 403);
      const key = randomUUID();
      const chosen = await select(take.id, 0, reviewer, shot, key);
      assert.equal(chosen.status, 201, JSON.stringify(chosen.data));
      assert.equal((await select(take.id, 0, reviewer, shot, key)).data.id, chosen.data.id);
      assert.equal((await select(null, 0, reviewer, shot, key)).data.code, 'IDEMPOTENCY_CONFLICT');
      assert.equal((await selection()).valid, true);
      await decide('submit', 0, editor, second);
      await decide('approve', 1, reviewer2, second);
      assert.equal((await selection()).takeId, take.id);
      const concurrent = await Promise.all([select(second.id, 1, reviewer), select(null, 1, reviewer2)]);
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);
      const current = await selection();
      assert.equal(current.version, 2);
      if (current.takeId !== take.id) await select(take.id, current.version);
      const retained = await selection();
      assert.equal(retained.valid, true);
      assert.equal(retained.approvalId, (await state()).decisionId);
      const list = (await owner('GET', `/shots/${shot.id}/takes`)).data.items;
      assert.equal(list.find((item) => item.id === take.id).state, 'draft');
      assert.equal(list.find((item) => item.id === take.id).review.status, 'approved');
    });
    await t.test(
      'revocation invalidates the exact selection and later approval requires reselection',
      async () => {
        const current = await state();
        const oldApproval = current.decisionId;
        await decide('revoke', current.decisionVersion, reviewer);
        assert.equal((await selection()).valid, false);
        assert.equal((await selection()).invalidReason, 'APPROVAL_CHANGED');
        assert.equal((await select(take.id, (await selection()).version)).data.code, 'TAKE_NOT_APPROVED');
        await decide('submit', (await state()).decisionVersion, editor);
        await decide('reject', (await state()).decisionVersion, reviewer);
        await decide('submit', (await state()).decisionVersion, editor);
        await decide('withdraw', (await state()).decisionVersion, editor);
        assert.equal((await state()).status, 'draft');
        await decide('submit', (await state()).decisionVersion, editor);
        await decide('approve', (await state()).decisionVersion, reviewer);
        assert.notEqual((await state()).decisionId, oldApproval);
        assert.equal((await selection()).valid, false);
        await select(take.id, (await selection()).version);
        assert.equal((await selection()).valid, true);
      },
    );
    await t.test(
      'card and project changes invalidate review context and prevent stale approvals',
      async () => {
        await decide(
          'submit',
          0,
          editor,
          (
            await owner('POST', `/shots/${shot.id}/takes`, {
              mediaVersionId: (await upload('image.jpg')).id,
              expectedShotVersion: shot.version,
            })
          ).data,
        );
        const list = (await owner('GET', `/shots/${shot.id}/takes`)).data.items;
        const pending = list.find((item) => item.review.status === 'submitted');
        const card = (await owner('GET', `/shots/${shot.id}/card/editor`)).data;
        card.body.intent = 'A revised intention.';
        shot = (
          await owner('PATCH', `/shots/${shot.id}/card`, { expectedVersion: shot.version, body: card.body })
        ).data.shot;
        assert.equal((await state()).stale, true);
        assert.equal((await selection()).invalidReason, 'INPUT_CHANGED');
        assert.equal((await decide('approve', 1, reviewer, pending)).data.code, 'TAKE_REVIEW_INPUT_CHANGED');
        await decide('withdraw', 1, editor, pending);
        await decide('submit', 2, editor, pending);
        assert.equal((await state(pending)).context.shotVersion, shot.version);
        assert.equal((await decide('approve', 3, reviewer, pending)).status, 201);
        await select(pending.id, (await selection()).version);
        project = (
          await owner('PATCH', `/projects/${project.id}`, {
            expectedVersion: project.version,
            title: 'Revised project title',
          })
        ).data;
        assert.equal((await selection()).valid, false);
        assert.equal((await state(pending)).stale, true);
      },
    );
    await t.test(
      'cross-shot and project references, immutable events and atomic audit rollback',
      async () => {
        otherShot = await fullShot();
        assert.equal((await select(take.id, 0, owner, otherShot)).status, 404);
        const otherProject = (
          await owner('POST', '/projects', { workspaceId: workspace.id, title: 'Other project' })
        ).data;
        const foreignShot = await fullShot(otherProject);
        assert.equal((await select(take.id, 0, owner, foreignShot)).status, 404);
        assert.equal((await reviewer('GET', `/shots/${foreignShot.id}/take-selection`)).status, 404);
        await decide('revoke', (await state()).decisionVersion, reviewer);
        db().exec(
          "CREATE TRIGGER fail_take_audit BEFORE INSERT ON audit_events WHEN NEW.action='take.submit' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
        );
        const before = (await state()).decisionVersion;
        assert.equal((await decide('submit', before, editor)).status, 409);
        assert.equal((await state()).decisionVersion, before);
        db().exec('DROP TRIGGER fail_take_audit');
        const candidate = (
          await owner('POST', `/shots/${otherShot.id}/takes`, {
            mediaVersionId: video.id,
            expectedShotVersion: otherShot.version,
          })
        ).data;
        await decide('submit', 0, owner, candidate);
        await decide('approve', 1, owner, candidate);
        db().exec(
          "CREATE TRIGGER fail_selection_audit BEFORE INSERT ON audit_events WHEN NEW.action='take.select' BEGIN SELECT RAISE(ABORT,'fixture'); END;",
        );
        assert.equal((await select(candidate.id, 0, owner, otherShot)).status, 409);
        assert.equal((await selection(otherShot)).version, 0);
        db().exec('DROP TRIGGER fail_selection_audit');
        for (const table of ['take_review_events', 'shot_take_selections']) {
          assert.throws(() => db().prepare(`UPDATE ${table} SET reason='rewrite'`).run(), /immutable/);
          assert.throws(() => db().prepare(`DELETE FROM ${table}`).run(), /immutable/);
        }
        const { takeReviewEvents, shotTakeSelections } = await import('../dist/db/schema.js');
        const database = app.get(DatabaseService).db;
        const event = database.select().from(takeReviewEvents).all()[0];
        assert.throws(() =>
          database
            .insert(takeReviewEvents)
            .values({ ...event, id: randomUUID(), version: 999, requestKey: randomUUID() })
            .run(),
        );
        const chosen = database.select().from(shotTakeSelections).all()[0];
        assert.throws(() =>
          database
            .insert(shotTakeSelections)
            .values({
              ...chosen,
              id: randomUUID(),
              shotId: foreignShot.id,
              projectId: otherProject.id,
              version: 1,
              requestKey: randomUUID(),
            })
            .run(),
        );
      },
    );
    await t.test('bounded review and selection history survives restart and independent backup', async () => {
      // Repeated editorial review produces real event pages rather than synthetic rows.
      for (let i = 0; i < 6; i++) {
        await decide('submit', (await state()).decisionVersion, editor);
        await decide('approve', (await state()).decisionVersion, reviewer);
        await select(take.id, (await selection()).version);
        await select(null, (await selection()).version);
        await select(take.id, (await selection()).version);
        await select(null, (await selection()).version);
        await decide('revoke', (await state()).decisionVersion, reviewer);
      }
      const page = await state();
      assert.equal(page.items.length, 20);
      assert.ok(page.nextCursor);
      const next = (await owner('GET', `/takes/${take.id}/reviews?before=${page.nextCursor}`)).data;
      assert.ok(next.items.length);
      assert.equal(
        new Set([...page.items, ...next.items].map((r) => r.id)).size,
        page.items.length + next.items.length,
      );
      const selected = await selection();
      assert.equal(selected.items.length, 20);
      const nextSelected = (
        await owner('GET', `/shots/${shot.id}/take-selection?before=${selected.nextCursor}`)
      ).data;
      assert.ok(nextSelected.items.length);
      const backup = await backupDatabase(process.env.DATABASE_PATH, join(directory, 'backup'));
      const restored = join(directory, 'restored.sqlite');
      await copyFile(backup, restored);
      const restoredDb = new DatabaseService({ databasePath: restored });
      try {
        assert.equal(restoredDb.sqlite.pragma('integrity_check', { simple: true }), 'ok');
        assert.deepEqual(restoredDb.sqlite.pragma('foreign_key_check'), []);
        for (const table of ['take_review_events', 'shot_take_selections'])
          assert.deepEqual(
            restoredDb.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
            db().prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
          );
      } finally {
        restoredDb.onModuleDestroy();
      }
      await app.close();
      await start();
      assert.deepEqual((await state()).items, page.items);
      assert.deepEqual((await selection()).items, selected.items);
    });
    await t.test('membership removal and trash revoke old reads and idempotent writes', async () => {
      const key = randomUUID(),
        version = (await state()).decisionVersion;
      await decide('submit', version, editor);
      const approved = await decide('approve', version + 1, reviewer, take, key);
      assert.equal(approved.status, 201);
      await owner('DELETE', `/projects/${project.id}/members/${reviewerId}`, { expectedRole: 'REVIEWER' });
      assert.equal((await reviewer('GET', `/takes/${take.id}/reviews`)).status, 404);
      assert.equal((await decide('approve', version + 1, reviewer, take, key)).status, 404);
      assert.equal(
        (await owner('POST', `/projects/${project.id}/trash`, { expectedVersion: project.version })).status,
        201,
      );
      assert.equal((await owner('GET', `/takes/${take.id}/reviews`)).status, 404);
      assert.equal((await owner('GET', `/shots/${shot.id}/take-selection`)).status, 404);
    });
  } finally {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
