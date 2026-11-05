import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

test('manual full cards and offline prompt artifacts preserve the production core', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pullet-delivery-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  process.env.DATABASE_PATH = join(directory, 'studio.sqlite');
  process.env.SETUP_TOKEN = 'offline-delivery-isolated-setup-token-2026';
  process.env.COOKIE_SECURE = 'false';
  const { createApplication } = await import('../dist/application.js');
  const { DatabaseService } = await import('../dist/db/database.service.js');
  const { backupDatabase } = await import('../dist/db/backup.js');
  const Database = (await import('better-sqlite3')).default;
  let app, base, workspace, project, other, shot, profile, artifact, manualBody, viewerId;
  async function start() { app = await createApplication(); await app.listen(0, '127.0.0.1'); base = await app.getUrl(); }
  function client() { let cookies = '', csrf = ''; return { async request(method, path, body) {
    const response = await fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1', 'X-CSRF-Token': csrf, Cookie: cookies }, body: body === undefined ? undefined : JSON.stringify(body) });
    const incoming = response.headers.getSetCookie(); if (incoming.length) cookies = incoming.map(value => value.split(';')[0]).join('; ');
    const data = await response.json(); if (data.csrfToken) csrf = data.csrfToken; return { status: response.status, data };
  } }; }
  const owner = client(), editor = client(), viewer = client(), reviewer = client(), stranger = client();
  const path = suffix => `/shots/${shot.id}${suffix}`;
  const compile = (mode = 'preview', profileRevisionId = profile?.id ?? null, shotVersion = shot.version, projectVersion = project.version) => ({mode, expectedShotVersion:shotVersion, expectedProjectVersion:projectVersion, profileRevisionId});
  try {
    await start();
    workspace = (await owner.request('POST','/setup/initialize',{setupToken:process.env.SETUP_TOKEN,email:'owner@delivery.test',password:'Studio8!',name:'Owner',workspaceName:'Film team'})).data.workspace;
    project = (await owner.request('POST','/projects',{workspaceId:workspace.id,title:'Two voices',narrativeMode:'dialogue',stylePreset:'cinematic_realism',styleDescription:'Subtle grain',directorNotes:'Hold the eyeline'})).data;
    other = (await owner.request('POST','/projects',{workspaceId:workspace.id,title:'Other'})).data;
    for (const [actor,role] of [[editor,'EDITOR'],[viewer,'VIEWER'],[reviewer,'REVIEWER']]) {
      const invite=(await owner.request('POST',`/workspaces/${workspace.id}/invitations`,{email:`${role}@delivery.test`})).data;
      const accepted=(await actor.request('POST','/invitations/accept',{token:invite.token,name:role,password:'Studio8!'})).data;
      if(role==='VIEWER')viewerId=accepted.user.id;
      await owner.request('POST',`/projects/${project.id}/members`,{userId:accepted.user.id,role});
    }
    const outside=(await owner.request('POST','/workspaces',{name:'Outside'})).data;
    const invite=(await owner.request('POST',`/workspaces/${outside.id}/invitations`,{email:'outside@delivery.test'})).data;
    await stranger.request('POST','/invitations/accept',{token:invite.token,name:'Stranger',password:'Studio8!'});
    shot=(await editor.request('POST',`/projects/${project.id}/shots`,{description:'Mira and Noah at the door.',durationHint:12})).data;
    await t.test('manual editor reads do not invent history and cannot compile an unsaved card',async()=>{
      const context=(await viewer.request('GET',path('/card/editor'))).data;
      assert.equal(context.card.available,false);assert.deepEqual(context.body.sourceSpanIds,[]);assert.equal(context.canEdit,false);
      assert.equal(app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) n FROM shot_card_editions').get().n,0);
      assert.equal((await owner.request('POST',path('/prompts/compile'),compile('preview',null))).status,409);
      manualBody={...context.body,title:'Doorway exchange',intent:'Establish hesitation',framing:'Medium two shot',angle:'Eye level',composition:'Mira left; Noah right',cameraMovement:'Slow dolly',action:'Mira pauses',lighting:'Window light',mood:'Uncertain',dialogue:'Mira: Ready?\nNoah: Yes.',audioNotes:'Room tone and separate dialogue',assets:['Mira','Noah','Doorway'],riskNotes:['Check eyeline'],sourceAudioPolicy:'mute'};
    });
    await t.test('edit rights, source integrity, atomic CAS and all full-card fields',async()=>{
      const input={expectedVersion:1,body:manualBody,summary:'Full director card'};
      assert.equal((await viewer.request('PATCH',path('/card'),input)).status,403);
      assert.equal((await reviewer.request('PATCH',path('/card'),input)).status,403);
      assert.equal((await stranger.request('GET',path('/card/editor'))).status,404);
      assert.equal((await editor.request('PATCH',path('/card'),{...input,body:{...manualBody,sourceSpanIds:['f'.repeat(64)]}})).status,400);
      const results=await Promise.all([owner,editor].map(actor=>actor.request('PATCH',path('/card'),input)));
      assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);shot=results.find(row=>row.status===200).data.shot;
      const card=(await viewer.request('GET',path('/card'))).data;assert.deepEqual(card.body,manualBody);assert.equal(card.origin,null);assert.deepEqual(card.sources,[]);
      assert.equal((await owner.request('GET',path('/card/versions/1'))).status,404);
      const db=app.get(DatabaseService).sqlite;
      db.exec("CREATE TRIGGER fixture_card_failure BEFORE INSERT ON shot_card_editions WHEN json_extract(NEW.body_json, '$.title')='Rollback fixture' BEGIN SELECT RAISE(ABORT, 'rollback fixture'); END;");
      assert.equal((await editor.request('PATCH',path('/card'),{expectedVersion:2,body:{...manualBody,title:'Rollback fixture'}})).status,409);
      assert.equal((await owner.request('GET',path(''))).data.version,2);db.exec('DROP TRIGGER fixture_card_failure');
    });
    await t.test('legacy basic edits continue manual full cards and preserve history',async()=>{
      shot=(await editor.request('PATCH',path(''),{expectedVersion:2,description:'Updated doorway',durationHint:14})).data;
      const card=(await viewer.request('GET',path('/card'))).data;
      assert.equal(card.version,3);assert.equal(card.body.description,'Updated doorway');assert.equal(card.body.sourceAudioPolicy,'mute');assert.equal(card.body.composition,manualBody.composition);
      assert.equal((await viewer.request('GET',path('/card/versions/2'))).data.body.description,manualBody.description);
      assert.deepEqual((await viewer.request('GET',path('/card/versions'))).data.items.map(row=>row.version),[3,2]);
    });
    await t.test('profiles use manager rights, immutable revisions and optimistic locking',async()=>{
      const input={name:'Dialogue delivery',config:{prefix:'Natural performance',positiveRules:['Maintain screen direction'],negativeRules:['Watermark','Extra people'],negativeMode:'separate',suffix:'Keep faces readable'}};
      assert.equal((await editor.request('POST',`/projects/${project.id}/prompt-profiles`,input)).status,403);
      profile=(await owner.request('POST',`/projects/${project.id}/prompt-profiles`,input)).data;assert.equal(profile.version,1);
      const foreign=(await owner.request('POST',`/projects/${other.id}/prompt-profiles`,input)).data;
      assert.equal((await owner.request('POST',path('/prompts/compile'),compile('preview',foreign.id))).status,404);
      assert.equal((await stranger.request('GET',`/projects/${project.id}/prompt-profiles`)).status,404);
    });
    await t.test('preview works without models, is deterministic and does not write',async()=>{
      const db=app.get(DatabaseService).sqlite;
      const before=db.prepare('SELECT COUNT(*) n FROM prompt_artifacts').get().n;
      const first=await viewer.request('POST',path('/prompts/compile'),compile());assert.equal(first.status,201);
      const second=await viewer.request('POST',path('/prompts/compile'),compile());assert.deepEqual(first.data,second.data);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM prompt_artifacts').get().n,before);
      const output=first.data.rendered;
      for(const term of ['Updated doorway','写实电影','Subtle grain','Hold the eyeline','Maintain screen direction','静音原声','Mira: Ready?'])assert.ok(output.positivePrompt.includes(term),term);
      assert.equal(output.negativePrompt,'Watermark；Extra people');assert.equal(output.productionReady,false);assert.deepEqual(output.inputBindings,[]);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM text_connections').get().n,0);
    });
    await t.test('commit requires edit rights and freezes complete inputs; stale versions refuse writes',async()=>{
      assert.equal((await viewer.request('POST',path('/prompts/compile'),compile('commit'))).status,403);
      assert.equal((await reviewer.request('POST',path('/prompts/compile'),compile('commit'))).status,403);
      assert.equal((await editor.request('POST',path('/prompts/compile'),compile('commit',profile.id,2))).status,409);
      artifact=(await editor.request('POST',path('/prompts/compile'),compile('commit'))).data;assert.ok(artifact.id);assert.equal(artifact.freshness.stale,false);
      assert.equal(artifact.snapshot.card.version,3);assert.equal(artifact.snapshot.project.styleDescription,'Subtle grain');
      const db=app.get(DatabaseService).sqlite;
      for(const table of ['shot_card_editions','prompt_profiles','prompt_artifacts']) {
        assert.throws(()=>db.prepare(`DELETE FROM ${table}`).run(),/immutable/);
        assert.throws(()=>db.prepare(`UPDATE ${table} SET id=id`).run(),/immutable/);
      }
    });
    await t.test('new profile, project and card versions mark history stale but never rewrite frozen prompts',async()=>{
      const revised=await owner.request('POST',`/prompt-profiles/${profile.id}/revisions`,{expectedVersion:1,name:profile.name,config:{...profile.config,negativeMode:'inline'}});assert.equal(revised.status,201);
      assert.equal((await owner.request('POST',`/prompt-profiles/${profile.id}/revisions`,{expectedVersion:1,name:profile.name,config:profile.config})).status,409);
      const inline=(await viewer.request('POST',path('/prompts/compile'),compile('preview',revised.data.id))).data;
      assert.equal(inline.rendered.negativePrompt,'');assert.ok(inline.rendered.positivePrompt.includes('Watermark'));assert.ok(inline.rendered.warnings.some(value=>value.includes('禁止项')));
      profile=revised.data;
      shot=(await editor.request('PATCH',path(''),{expectedVersion:3,dialogue:'New line'})).data;
      project=(await owner.request('PATCH',`/projects/${project.id}`,{expectedVersion:1,title:'Two voices revised'})).data;
      const saved=(await viewer.request('GET',path(`/prompts/${artifact.id}`))).data;
      assert.equal(saved.freshness.stale,true);assert.equal(saved.freshness.reasons.length,3);assert.deepEqual(saved.rendered,artifact.rendered);
      assert.deepEqual((await viewer.request('GET',path('/prompts'))).data.items.map(row=>row.id),[artifact.id]);
      assert.equal((await owner.request('GET',`/shots/${randomUUID()}/prompts/${artifact.id}`)).status,404);
    });
    await t.test('neutral compiler handles a narration and an ad without model or story-specific defaults',async()=>{
      for(const [title,narrativeMode,seconds,description] of [['Two minute narration','narration',120,'A traveler follows a river.'],['Umbrella advert','none',30,'A compact umbrella opens.']]){
        const pr=(await owner.request('POST','/projects',{workspaceId:workspace.id,title,narrativeMode})).data;
        const sh=(await owner.request('POST',`/projects/${pr.id}/shots`,{durationHint:seconds,description})).data;
        const initial=(await owner.request('GET',`/shots/${sh.id}/card/editor`)).data;
        const card=await owner.request('PATCH',`/shots/${sh.id}/card`,{expectedVersion:1,body:{...initial.body,title,intent:'Tell this story'}});assert.equal(card.status,200);
        const result=(await owner.request('POST',`/shots/${sh.id}/prompts/compile`,{mode:'commit',expectedShotVersion:2,expectedProjectVersion:1})).data;
        assert.ok(result.rendered.positivePrompt.includes(description));assert.ok(result.rendered.positivePrompt.includes(`${seconds} 秒`));assert.equal(result.snapshot.modelProfile,null);
      }
    });
    await t.test('online backup restores complete card and prompt history into an isolated new file',async()=>{
      const backup=await backupDatabase(process.env.DATABASE_PATH,join(directory,'backups'));
      const restored=join(directory,'restored.sqlite');await copyFile(backup,restored);
      const db=new Database(restored,{readonly:true});
      assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);
      assert.ok(db.prepare('SELECT COUNT(*) n FROM shot_card_editions').get().n>=3);assert.ok(db.prepare('SELECT COUNT(*) n FROM prompt_artifacts').get().n>=3);db.close();
    });
    await t.test('profiles and artifacts paginate without returning duplicate records',async()=>{
      for(let index=0;index<31;index++) {
        const result=await owner.request('POST',`/projects/${project.id}/prompt-profiles`,{name:`Profile ${index}`,config:{}});assert.equal(result.status,201);
        const committed=await owner.request('POST',path('/prompts/compile'),compile('commit',null));assert.equal(committed.status,201);
      }
      for(const endpoint of [`/projects/${project.id}/prompt-profiles`,path('/prompts')]) {
        const first=(await owner.request('GET',endpoint)).data;assert.equal(first.items.length,30);assert.ok(first.nextCursor);
        const second=(await owner.request('GET',`${endpoint}?cursor=${first.nextCursor}`)).data;assert.equal(second.items.length,2);assert.equal(second.nextCursor,null);
        assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,32);
        if(endpoint===path('/prompts')) assert.deepEqual([...first.items,...second.items].map(row=>row.createdAt), [...first.items,...second.items].map(row=>row.createdAt).sort().reverse());
      }
    });
    await t.test('restart and project trash preserve history while revoking access',async()=>{
      await app.close();await start();assert.equal((await viewer.request('GET',path(`/prompts/${artifact.id}`))).data.id,artifact.id);
      assert.equal((await owner.request('DELETE',`/projects/${project.id}/members/${viewerId}`,{expectedRole:'VIEWER'})).status,200);
      assert.equal((await viewer.request('GET',path(`/prompts/${artifact.id}`))).status,404);
      await owner.request('POST',`/projects/${project.id}/trash`,{expectedVersion:project.version});
      for(const suffix of ['/card','/card/editor','/prompts',`/prompts/${artifact.id}`])assert.equal((await owner.request('GET',path(suffix))).status,404);
      assert.equal((await editor.request('POST',path('/prompts/compile'),compile('commit'))).status,404);
    });
  } finally { if(app)await app.close();await rm(directory,{recursive:true,force:true}); }
});
