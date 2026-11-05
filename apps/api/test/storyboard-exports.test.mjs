import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { startTextMock } from '../../../tests/fixtures/text-mock.mjs';

test('CSV cells prevent spreadsheet formulas after whitespace and retain quoted source text',async()=>{
  const {csvCell}=await import('../dist/exports/render-storyboard.js');
  for(const value of ['=1+1','+SUM(A1)','-1+1','@SUM(A1)',' \t=HYPERLINK("https://example.test")','\0\uFEFF@danger','\r\ntext','\ttext','\u2003=1','\u200B=1'])assert.ok(csvCell(value).startsWith('"\''),JSON.stringify(value));
  assert.equal(csvCell('雨, "hello"\r\n🌂'),'"雨, ""hello""\r\n🌂"');assert.equal(csvCell('Ordinary - text'),'"Ordinary - text"');
});
test('storyboard text exports freeze bounded, authorized and reproducible production snapshots',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pullet-export-'));assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  process.env.DATABASE_PATH=join(directory,'studio.sqlite');process.env.SETUP_TOKEN='storyboard-export-isolated-setup-token-2026';process.env.COOKIE_SECURE='false';process.env.PROVIDER_MASTER_KEY='d'.repeat(64);
  const {createApplication}=await import('../dist/application.js');const {DatabaseService}=await import('../dist/db/database.service.js');
  const {ProductionService}=await import('../dist/production/production.service.js');const {CardAuthoringService}=await import('../dist/production/card-authoring.service.js');
  const {TextAnalysisWorker}=await import('../dist/analysis/text-analysis-worker.js');const {backupDatabase}=await import('../dist/db/backup.js');
  const Database=(await import('better-sqlite3')).default;const mock=await startTextMock();let app,base,workspace,project,foreign,act,scene,empty,rootShot,basic,aiShot,artifact,profile,ownerUser,viewerId,frozen;
  async function start(){app=await createApplication();await app.listen(0,'127.0.0.1');base=await app.getUrl();}
  function client(){let cookies='',csrf='';return {async request(method,path,body,headers={}){
    const response=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Studio-Request':'1','X-CSRF-Token':csrf,Cookie:cookies,...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const incoming=response.headers.getSetCookie();if(incoming.length)cookies=incoming.map(value=>value.split(';')[0]).join('; ');
    if(response.ok&&path.endsWith('/file'))return {status:response.status,bytes:Buffer.from(await response.arrayBuffer()),headers:response.headers};
    const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data,headers:response.headers};
  }};}
  const owner=client(),viewer=client(),outsider=client(),anonymous=client();
  const path=suffix=>`/projects/${project.id}/storyboard-exports${suffix}`;
  const options=(format='json',scope={type:'project'},promptMode='saved')=>({format,scope,promptMode});
  async function preview(input,actor=owner){const response=await actor.request('POST',path('/preview'),input);assert.equal(response.status,201,JSON.stringify(response.data));return response.data;}
  async function create(input,actor=owner,key=randomUUID()){const planned=await preview(input,actor);const response=await actor.request('POST',path(''),{...input,expectedSnapshotHash:planned.snapshotHash},{'Idempotency-Key':key});assert.equal(response.status,201,JSON.stringify(response.data));return response.data;}
  async function file(row,actor=owner){const response=await actor.request('GET',`/storyboard-exports/${row.id}/file`);assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(createHash('sha256').update(response.bytes).digest('hex'),row.sha256);assert.equal(response.bytes.length,row.byteLength);assert.equal(response.headers.get('x-content-sha256'),row.sha256);return response;}
  try{
    await start();const setup=(await owner.request('POST','/setup/initialize',{setupToken:process.env.SETUP_TOKEN,email:'owner@export.test',password:'Studio8!',name:'Producer',workspaceName:'Export team'})).data;workspace=setup.workspace;ownerUser=setup.user;
    project=(await owner.request('POST','/projects',{workspaceId:workspace.id,title:'<script>Storyboard</script>',stylePreset:'cinematic_realism'})).data;
    foreign=(await owner.request('POST','/projects',{workspaceId:workspace.id,title:'Other project'})).data;
    for(const [actor,email,target] of [[viewer,'viewer@export.test',workspace],[outsider,'outsider@export.test',(await owner.request('POST','/workspaces',{name:'Outside'})).data]]){
      const invitation=(await owner.request('POST',`/workspaces/${target.id}/invitations`,{email})).data;
      const accepted=(await actor.request('POST','/invitations/accept',{token:invitation.token,name:email,password:'Studio8!'})).data;
      if(actor===viewer){viewerId=accepted.user.id;await owner.request('POST',`/projects/${project.id}/members`,{userId:viewerId,role:'VIEWER'});}
    }
    act=(await owner.request('POST',`/projects/${project.id}/units`,{kind:'act',title:'Opening',orderIndex:2})).data;
    scene=(await owner.request('POST',`/projects/${project.id}/units`,{kind:'scene',title:'Doorway',parentId:act.id})).data;
    empty=(await owner.request('POST',`/projects/${project.id}/units`,{kind:'scene',title:'Unused',orderIndex:1})).data;
    rootShot=(await owner.request('POST',`/projects/${project.id}/shots`,{description:'=HYPERLINK("https://example.test","x")\r\n雨, "hello" 🌂',sequence:2})).data;
    basic=(await owner.request('POST',`/projects/${project.id}/shots`,{description:'No complete card yet',sequence:1})).data;
    const initial=(await owner.request('GET',`/shots/${rootShot.id}/card/editor`)).data;
    rootShot=(await owner.request('PATCH',`/shots/${rootShot.id}/card`,{expectedVersion:1,body:{...initial.body,title:'+Product test',composition:'A plain table',audioNotes:'Inspect sound',sourceAudioPolicy:'mute'}})).data.shot;
    profile=(await owner.request('POST',`/projects/${project.id}/prompt-profiles`,{name:'Export profile',config:{negativeRules:['Watermark'],prefix:'No model calls'}})).data;
    artifact=(await owner.request('POST',`/shots/${rootShot.id}/prompts/compile`,{mode:'commit',expectedShotVersion:2,expectedProjectVersion:1,profileRevisionId:profile.id})).data;
    rootShot=(await owner.request('PATCH',`/shots/${rootShot.id}`,{expectedVersion:2,camera:'Updated camera'})).data;
    await owner.request('POST',`/projects/${project.id}/shots`,{unitId:act.id,description:'Act shot'});
    await owner.request('POST',`/projects/${project.id}/script`,{expectedVersion:0,title:'Source',content:'雨落。🌂\r\nMira waits.\nNoah speaks.'});
    const connection=(await owner.request('POST',`/workspaces/${workspace.id}/text-connections`,{name:'Isolated fixture',baseUrl:mock.baseUrl,trustedPrivate:true,apiKey:'export-fixture-key-not-real',profile:{name:'Fixture',model:'valid',outputMode:'json_schema'}})).data;
    const run=(await owner.request('POST',`/projects/${project.id}/analysis-runs`,{modelProfileId:connection.profileId,revisionVersion:1,expectedProjectVersion:1,chunkIndex:0,acknowledgeExternalProcessing:true},{'Idempotency-Key':randomUUID()})).data;
    await app.get(TextAnalysisWorker).tick();const proposal=(await owner.request('GET',`/analysis-runs/${run.id}`)).data.proposal;
    const {sources,...fields}=proposal.body.shots[0];await owner.request('PATCH',`/proposals/${proposal.id}/shots/0`,{expectedVersion:0,shot:{...fields,durationSeconds:9}});
    aiShot=(await owner.request('POST',`/proposals/${proposal.id}/accept`,{expectedVersion:1,expectedProjectVersion:1,unitId:scene.id,acknowledgeCreation:true})).data.adoptedShots[0];
    await owner.request('POST',`/shots/${aiShot.id}/prompts/compile`,{mode:'commit',expectedShotVersion:1,expectedProjectVersion:1});
    await t.test('preview is read-only, marks missing and stale content, and orders by unit and sequence',async()=>{
      const db=app.get(DatabaseService).sqlite;const before=db.prepare('SELECT COUNT(*) n FROM audit_events').get().n;
      const planned=await preview(options(),viewer);assert.equal(planned.shotCount,4);assert.deepEqual(planned.items.slice(0,2).map(item=>item.id),[basic.id,rootShot.id]);
      assert.ok(planned.items.find(item=>item.id===basic.id).warnings.some(text=>text.includes('未保存完整')));
      assert.ok(planned.items.find(item=>item.id===rootShot.id).warnings.some(text=>text.includes('历史输入')));
      assert.equal(db.prepare('SELECT COUNT(*) n FROM storyboard_exports').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_events').get().n,before);
      assert.equal((await owner.request('POST',path('/preview'),options('json',{type:'unit',unitId:empty.id,includeDescendants:false}))).data.code,'EXPORT_EMPTY');
    });
    await t.test('all scopes are exact, nested units are explicit and foreign/root IDs cannot be selected',async()=>{
      assert.equal((await preview(options('json',{type:'root'}))).shotCount,2);
      assert.equal((await preview(options('json',{type:'unit',unitId:act.id,includeDescendants:false}))).shotCount,1);
      assert.equal((await preview(options('json',{type:'unit',unitId:act.id,includeDescendants:true}))).shotCount,2);
      assert.equal((await preview(options('json',{type:'shots',shotIds:[aiShot.id,rootShot.id]}))).shotCount,2);
      const unit=(await owner.request('POST',`/projects/${foreign.id}/units`,{kind:'scene',title:'Foreign'})).data;
      const foreignShot=(await owner.request('POST',`/projects/${foreign.id}/shots`,{})).data;
      const rootId=app.get(DatabaseService).sqlite.prepare("SELECT id FROM episodes WHERE project_id=? AND unit_type='project_root'").get(project.id).id;
      for(const scope of [{type:'unit',unitId:unit.id,includeDescendants:false},{type:'unit',unitId:rootId,includeDescendants:true},{type:'shots',shotIds:[rootShot.id,foreignShot.id]}])assert.equal((await owner.request('POST',path('/preview'),options('json',scope))).status,404);
      assert.equal((await owner.request('POST',path('/preview'),options('json',{type:'shots',shotIds:[rootShot.id,rootShot.id]}))).status,400);
    });
    await t.test('JSON freezes complete cards, source hashes and old prompt inputs without secrets or internal root IDs',async()=>{
      frozen=await create(options(),viewer);const response=await file(frozen,viewer);const text=response.bytes.toString('utf8'),document=JSON.parse(text);
      assert.equal(document.schemaVersion,'studio.storyboard.v1');assert.equal(document.shots.length,4);
      const manual=document.shots.find(shot=>shot.id===rootShot.id);assert.equal(manual.card.version,3);assert.equal(manual.prompt.snapshot.card.version,2);assert.equal(manual.prompt.id,artifact.id);assert.equal(manual.prompt.freshness.stale,true);
      assert.equal(manual.basic.description,rootShot.description);assert.equal(manual.card.body.sourceAudioPolicy,'mute');assert.equal(document.shots.find(shot=>shot.id===basic.id).card,null);
      const sourced=document.shots.find(shot=>shot.id===aiShot.id);assert.equal(sourced.unitPath.length,2);
      for(const source of sourced.card.sources)assert.equal(createHash('sha256').update(source.text).digest('hex'),source.textHash);
      const rootId=app.get(DatabaseService).sqlite.prepare("SELECT id FROM episodes WHERE project_id=? AND unit_type='project_root'").get(project.id).id;
      for(const secret of ['export-fixture-key-not-real',process.env.PROVIDER_MASTER_KEY,process.env.SETUP_TOKEN,rootId,'apiKeyEncrypted','studio_session'])assert.ok(!text.includes(secret),secret);
      assert.match(response.headers.get('content-type'),/application\/json/);assert.match(response.headers.get('content-disposition'),/^attachment; filename="storyboard-[a-f0-9-]+\.json"$/);assert.equal(response.headers.get('cache-control'),'no-store');
    });
    await t.test('Markdown and CSV retain full quoted Unicode text and safely render untrusted content',async()=>{
      const md=(await file(await create(options('md')))).bytes.toString('utf8');assert.ok(md.includes('&lt;script&gt;Storyboard&lt;/script&gt;'));assert.ok(!md.includes('# <script>'));
      assert.ok(md.includes(rootShot.description));assert.ok(md.includes('Watermark'));assert.ok(md.includes('完整正向提示词'));
      const csv=(await file(await create(options('csv')))).bytes.toString('utf8');assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test""'));assert.ok(csv.includes('"\'+Product test"'));assert.ok(csv.includes('🌂'));assert.ok(csv.includes('""hello""'));assert.ok(csv.includes('prompt_json'));
    });
    await t.test('neutral mode compiles locally without creating prompts or calling a model',async()=>{
      const db=app.get(DatabaseService).sqlite;const before=db.prepare('SELECT COUNT(*) n FROM prompt_artifacts').get().n,hits=mock.requests.length;
      const row=await create(options('json',{type:'shots',shotIds:[rootShot.id]},'neutral'));
      const document=JSON.parse((await file(row)).bytes.toString('utf8'));assert.equal(document.shots[0].prompt.kind,'neutral');assert.equal(document.shots[0].prompt.id,null);
      assert.ok(document.shots[0].prompt.rendered.positivePrompt.includes('Updated camera'));assert.equal(db.prepare('SELECT COUNT(*) n FROM prompt_artifacts').get().n,before);assert.equal(mock.requests.length,hits);
    });
    await t.test('changed cards, units, script and profiles invalidate preview; existing file bytes remain fixed',async()=>{
      const input=options();const before=await preview(input);const bytes=(await file(frozen)).bytes;
      rootShot=(await owner.request('PATCH',`/shots/${rootShot.id}`,{expectedVersion:rootShot.version,description:'New view after export'})).data;
      const rejected=await owner.request('POST',path(''),{...input,expectedSnapshotHash:before.snapshotHash},{'Idempotency-Key':randomUUID()});assert.equal(rejected.data.code,'EXPORT_PREVIEW_CHANGED');
      let planned=await preview(input);
      scene=(await owner.request('PATCH',`/units/${scene.id}`,{expectedVersion:1,title:'New doorway'})).data;assert.notEqual((await preview(input)).snapshotHash,planned.snapshotHash);
      planned=await preview(input);await owner.request('POST',`/projects/${project.id}/script`,{expectedVersion:1,title:'New source',content:'New source text'});assert.notEqual((await preview(input)).snapshotHash,planned.snapshotHash);
      planned=await preview(input);profile=(await owner.request('POST',`/prompt-profiles/${profile.id}/revisions`,{expectedVersion:1,name:profile.name,config:{...profile.config,negativeRules:['Other rule']}})).data;assert.notEqual((await preview(input)).snapshotHash,planned.snapshotHash);
      planned=await preview(input);await owner.request('POST',`/prompt-profiles/${profile.id}/revisions`,{expectedVersion:2,name:profile.name,config:profile.config});assert.notEqual((await preview(input)).snapshotHash,planned.snapshotHash);
      assert.deepEqual((await file(frozen)).bytes,bytes);
    });
    await t.test('concurrent same-key requests create one export and one audit event, and retries survive content changes',async()=>{
      const input=options('json',{type:'shots',shotIds:[rootShot.id]});const planned=await preview(input);const key=randomUUID(),body={...input,expectedSnapshotHash:planned.snapshotHash};
      const results=await Promise.all([owner.request('POST',path(''),body,{'Idempotency-Key':key}),owner.request('POST',path(''),body,{'Idempotency-Key':key})]);
      assert.ok(results.every(row=>row.status===201));assert.equal(results[0].data.id,results[1].data.id);
      const db=app.get(DatabaseService).sqlite;assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action='storyboard.export.create' AND target_id=?").get(results[0].data.id).n,1);
      rootShot=(await owner.request('PATCH',`/shots/${rootShot.id}`,{expectedVersion:rootShot.version,dialogue:'Another line'})).data;
      assert.equal((await owner.request('POST',path(''),body,{'Idempotency-Key':key})).data.id,results[0].data.id);
      assert.equal((await owner.request('POST',path(''),{...body,format:'md'},{'Idempotency-Key':key})).data.code,'IDEMPOTENCY_CONFLICT');
    });
    await t.test('export and audit insertion are atomic, and stored snapshots cannot be updated or deleted',async()=>{
      const db=app.get(DatabaseService).sqlite,input=options('json',{type:'root'}),planned=await preview(input),key=randomUUID();const before=db.prepare('SELECT COUNT(*) n FROM storyboard_exports').get().n;
      db.exec("CREATE TRIGGER fixture_export_failure BEFORE INSERT ON audit_events WHEN NEW.action='storyboard.export.create' BEGIN SELECT RAISE(ABORT,'fixture export rollback'); END;");
      assert.equal((await owner.request('POST',path(''),{...input,expectedSnapshotHash:planned.snapshotHash},{'Idempotency-Key':key})).status,409);assert.equal(db.prepare('SELECT COUNT(*) n FROM storyboard_exports').get().n,before);db.exec('DROP TRIGGER fixture_export_failure');
      assert.equal((await owner.request('POST',path(''),{...input,expectedSnapshotHash:planned.snapshotHash},{'Idempotency-Key':key})).status,201);
      assert.throws(()=>db.prepare('DELETE FROM storyboard_exports').run(),/immutable/);assert.throws(()=>db.prepare('UPDATE storyboard_exports SET sha256=sha256').run(),/immutable/);
    });
    await t.test('permissions, CSRF and ID validation protect previews, creation and all file reads',async()=>{
      const input=options(),planned=await preview(input);
      assert.equal((await outsider.request('POST',path('/preview'),input)).status,404);assert.equal((await anonymous.request('GET',`/storyboard-exports/${frozen.id}/file`)).status,401);
      for(const suffix of ['', '/file'])assert.equal((await outsider.request('GET',`/storyboard-exports/${frozen.id}${suffix}`)).status,404);
      assert.equal((await owner.request('POST',path(''),{...input,expectedSnapshotHash:planned.snapshotHash},{'Idempotency-Key':randomUUID(),'X-CSRF-Token':''})).status,403);
      assert.equal((await owner.request('POST',path(''),{...input,expectedSnapshotHash:planned.snapshotHash})).status,400);
      assert.equal((await owner.request('POST',path('/preview'),{...input,outputPath:'C:/secret'})).status,400);
    });
    await t.test('history paginates metadata and fixed downloads survive restart and independent restore',async()=>{
      for(let index=0;index<21;index++)await create(options('json',{type:'shots',shotIds:[basic.id]}));
      const first=(await owner.request('GET',path(''))).data;assert.equal(first.items.length,20);assert.ok(first.nextCursor);assert.equal(first.items[0].content,undefined);assert.equal(first.items[0].snapshotJson,undefined);
      const second=(await owner.request('GET',path(`?cursor=${first.nextCursor}`))).data;const count=app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) n FROM storyboard_exports WHERE project_id=?').get(project.id).n;
      assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,count);assert.equal(second.nextCursor,null);
      const backup=await backupDatabase(process.env.DATABASE_PATH,join(directory,'backups')),restored=join(directory,'restored.sqlite');await copyFile(backup,restored);const db=new Database(restored,{readonly:true});
      assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.deepEqual(db.pragma('foreign_key_check'),[]);const original=db.prepare('SELECT content,sha256 FROM storyboard_exports WHERE id=?').get(frozen.id);assert.equal(createHash('sha256').update(original.content).digest('hex'),original.sha256);db.close();
      await app.close();await start();await file(frozen,viewer);
    });
    await t.test('shot, snapshot and rendered file limits reject oversized exports without truncating or persisting partials',async()=>{
      const production=app.get(ProductionService),cards=app.get(CardAuthoringService),db=app.get(DatabaseService).sqlite;
      const large=production.createProject(ownerUser,{workspaceId:workspace.id,title:'Large fixture',description:'雨'.repeat(20000)});
      const ids=[];for(let index=0;index<201;index++)ids.push(production.createProjectShot(ownerUser,large.id,{description:`Shot ${index}`}).id);
      const basePath=`/projects/${large.id}/storyboard-exports/preview`;
      assert.equal((await owner.request('POST',basePath,options())).data.code,'EXPORT_SHOT_LIMIT');
      const chosen=options('json',{type:'shots',shotIds:ids.slice(0,200)});const accepted=await owner.request('POST',basePath,chosen);assert.equal(accepted.status,201);assert.equal(accepted.data.shotCount,200);
      assert.equal((await owner.request('POST',basePath,{...chosen,format:'csv'})).data.code,'EXPORT_FILE_LIMIT');
      const textProject=production.createProject(ownerUser,{workspaceId:workspace.id,title:'Large text fixture'});
      for(let index=0;index<10;index++){const sh=production.createProjectShot(ownerUser,textProject.id,{description:'雨'.repeat(20000),dialogue:'海'.repeat(20000)});const initial=cards.editor(ownerUser,sh.id);cards.save(ownerUser,sh.id,1,initial.body,'Large bounded fixture');}
      const oversized=await owner.request('POST',`/projects/${textProject.id}/storyboard-exports/preview`,options('json',{type:'project'},'neutral'));assert.equal(oversized.data.code,'EXPORT_SNAPSHOT_LIMIT');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM storyboard_exports WHERE project_id IN (?,?)').get(large.id,textProject.id).n,0);
    });
    await t.test('membership removal and project trash revoke old download URLs immediately',async()=>{
      await owner.request('DELETE',`/projects/${project.id}/members/${viewerId}`,{expectedRole:'VIEWER'});
      assert.equal((await viewer.request('GET',`/storyboard-exports/${frozen.id}/file`)).status,404);
      await owner.request('POST',`/projects/${project.id}/trash`,{expectedVersion:1});
      assert.equal((await owner.request('GET',`/storyboard-exports/${frozen.id}/file`)).status,404);assert.equal((await owner.request('GET',path(''))).status,404);
      assert.equal((await owner.request('POST',path('/preview'),options())).status,404);
    });
  }finally{if(app)await app.close();await mock.close();await rm(directory,{recursive:true,force:true});}
});
