import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,copyFile,cp} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createMediaFixtures} from '../../../tests/fixtures/media-fixtures.mjs';

test('semantic assets freeze revisions and media through cards prompts and delivery',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'pullet-entities-'));assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
 process.env.DATABASE_PATH=join(directory,'studio.sqlite');process.env.MEDIA_ROOT=join(directory,'media');process.env.SETUP_TOKEN='isolated-semantic-assets-token-2026';process.env.COOKIE_SECURE='false';
 const {createApplication}=await import('../dist/application.js'),{DatabaseService}=await import('../dist/db/database.service.js'),{AppConfig}=await import('../dist/config.js');
 const fixtures=await createMediaFixtures(join(directory,'fixtures'),new AppConfig().ffmpegPath);
 let app,base,project,other,workspace,shot,character,environment,prop,voice,image,sound,artifact,viewerId;
 async function start(){app=await createApplication();await app.listen(0,'127.0.0.1');base=await app.getUrl();}
 function client(){let cookie='',csrf='';return {async request(method,path,body,headers={}){const binary=Buffer.isBuffer(body),response=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':binary?'application/octet-stream':'application/json','X-Studio-Request':'1','X-CSRF-Token':csrf,Cookie:cookie,...headers},body:body===undefined?undefined:binary?body:JSON.stringify(body)});const incoming=response.headers.getSetCookie();if(incoming.length)cookie=incoming.map(value=>value.split(';')[0]).join('; ');if(response.ok&&(path.includes('/content')||path.endsWith('/file'))&&method==='GET')return {status:response.status,bytes:Buffer.from(await response.arrayBuffer())};const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data};}};}
 const owner=client(),editor=client(),viewer=client(),reviewer=client(),stranger=client();
 const post=(actor,path,body,key=randomUUID())=>actor.request('POST',path,body,{'Idempotency-Key':key});
 const body=(name,extra={})=>({name,description:'General production reference',attributes:{},media:[],...extra});
 async function upload(name,extra={}){const bytes=fixtures[name].bytes;const intent=await post(owner,`/projects/${project.id}/media-uploads`,{fileName:name,byteLength:bytes.length,...extra});assert.equal(intent.status,201,JSON.stringify(intent.data));const result=await owner.request('PUT',`/media-uploads/${intent.data.id}/content`,bytes);assert.equal(result.status,200,JSON.stringify(result.data));return result.data.mediaVersion;}
 async function create(kind,name,extra={}){const result=await post(owner,`/projects/${project.id}/entities`,{kind,body:body(name,extra)});assert.equal(result.status,201,JSON.stringify(result.data));return result.data;}
 async function revise(entity,extra={},actor=owner,key=randomUUID()){return post(actor,`/entities/${entity.id}/revisions`,{expectedVersion:entity.currentVersion,body:{name:entity.revision.name,description:entity.revision.description,attributes:entity.revision.attributes,media:entity.revision.media.map(({role,mediaVersionId})=>({role,mediaVersionId})),...extra}},key);}
 const shotPath=suffix=>`/shots/${shot.id}${suffix}`;
 try{
  await start();const setup=(await owner.request('POST','/setup/initialize',{setupToken:process.env.SETUP_TOKEN,email:'owner@entities.test',password:'Studio8!',name:'Owner',workspaceName:'Production'})).data;workspace=setup.workspace;
  project=(await owner.request('POST','/projects',{workspaceId:workspace.id,title:'Ordinary dialogue'})).data;other=(await owner.request('POST','/projects',{workspaceId:workspace.id,title:'Other project'})).data;
  for(const [actor,role] of [[editor,'EDITOR'],[viewer,'VIEWER'],[reviewer,'REVIEWER']]){const invite=(await owner.request('POST',`/workspaces/${workspace.id}/invitations`,{email:role+'@entities.test'})).data;const accepted=(await actor.request('POST','/invitations/accept',{token:invite.token,name:role,password:'Studio8!'})).data;if(role==='VIEWER')viewerId=accepted.user.id;await owner.request('POST',`/projects/${project.id}/members`,{userId:accepted.user.id,role});}
  const outside=(await owner.request('POST','/workspaces',{name:'Outside'})).data;const invite=(await owner.request('POST',`/workspaces/${outside.id}/invitations`,{email:'outside@entities.test'})).data;await stranger.request('POST','/invitations/accept',{token:invite.token,name:'Outside',password:'Studio8!'});
  shot=(await editor.request('POST',`/projects/${project.id}/shots`,{description:'Two people talk in a shop.',durationHint:10})).data;
  image=await upload('image.png');sound=await upload('sound.wav');
  await t.test('creation uses project edit rights and durable idempotence, with typed fields',async()=>{
    const path=`/projects/${project.id}/entities`,input={kind:'character',body:body('Mira',{attributes:{appearance:'Short hair',costume:'Blue jacket'}})},key=randomUUID();
    assert.equal((await post(viewer,path,input)).status,403);assert.equal((await post(reviewer,path,input)).status,403);assert.equal((await post(stranger,path,input)).status,404);assert.equal((await owner.request('POST',path,input,{'Idempotency-Key':key,'X-CSRF-Token':''})).status,403);
    assert.equal((await post(owner,path,{...input,body:body('Invalid',{attributes:{voiceId:'provider-private-id'}})})).status,400);
    const a=await post(editor,path,input,key),b=await post(editor,path,input,key);assert.equal(a.status,201);assert.equal(a.data.id,b.data.id);character=a.data;assert.equal(character.revision.status,'draft');assert.equal(character.revision.attributes.costume,'Blue jacket');assert.equal(character.revision.attributes.state,'');
    assert.equal((await post(editor,path,{...input,body:body('Changed')},key)).status,409);
    assert.equal((await stranger.request('GET',`/entities/${character.id}`)).status,404);
  });
  await t.test('four semantic kinds validate actual media roles and project scope',async()=>{
    character=(await revise(character,{media:[{role:'front',mediaVersionId:image.id}]})).data;
    environment=await create('environment','Shop',{attributes:{layout:'Door on the left'},media:[{role:'overview',mediaVersionId:image.id}]});
    prop=await create('prop','Umbrella',{attributes:{material:'Fabric',scale:'Handheld'},media:[{role:'detail',mediaVersionId:image.id}]});
    const voiceInput={attributes:{language:'en',timbre:'Warm',usageRights:'Internal test',consentStatus:'unknown'},media:[{role:'voice_sample',mediaVersionId:sound.id}]};
    assert.equal((await post(owner,`/projects/${other.id}/entities`,{kind:'voice',body:body('Foreign',voiceInput)})).status,404);
    assert.equal((await revise(character,{media:[{role:'front',mediaVersionId:sound.id}]})).status,400);
    assert.equal((await revise(environment,{media:[{role:'front',mediaVersionId:image.id}]})).status,400);
    voice=await create('voice','Narrator',voiceInput);
    assert.equal((await viewer.request('GET',`/entities/${voice.id}`)).status,200);
    assert.equal((await viewer.request('GET',`/media-versions/${sound.id}/content`)).status,403);
    assert.equal((await editor.request('GET',`/media-versions/${sound.id}/content`)).status,403);
    assert.deepEqual((await reviewer.request('GET',`/media-versions/${sound.id}/content`,undefined,{Range:'bytes=0-9'})).bytes,fixtures['sound.wav'].bytes.subarray(0,10));
    assert.deepEqual((await owner.request('GET',`/media-versions/${image.id}/content`)).bytes,fixtures['image.png'].bytes);
    const edited=await revise(voice,{media:[]});assert.equal(edited.status,201);voice=edited.data;
    assert.equal((await viewer.request('GET',`/media-versions/${sound.id}/content`)).status,403,'historical voice protection cannot be removed by a new revision');
    voice=(await revise(voice,{media:voiceInput.media})).data;
    const ownBytes=fixtures['sound.ogg'].bytes,ownIntent=await post(editor,`/projects/${project.id}/media-uploads`,{fileName:'sound.ogg',byteLength:ownBytes.length});
    const ownVersion=(await editor.request('PUT',`/media-uploads/${ownIntent.data.id}/content`,ownBytes)).data.mediaVersion;
    const ownVoice=await post(editor,`/projects/${project.id}/entities`,{kind:'voice',body:body('Own sound',{media:[{role:'voice_sample',mediaVersionId:ownVersion.id}]})});assert.equal(ownVoice.status,201);
    assert.deepEqual((await editor.request('GET',`/media-versions/${ownVersion.id}/content`)).bytes,ownBytes,'an uploader retains access while still authorized to read the project');
    assert.equal((await viewer.request('GET',`/media-versions/${ownVersion.id}/content`)).status,403);
  });
  await t.test('concurrent revisions use CAS and preserve immutable historical reference bytes',async()=>{
    const original=(await owner.request('GET',`/entities/${character.id}/revisions/2`)).data,key=randomUUID();
    const updates=await Promise.all([revise(character,{name:'Mira revised'},owner,key),revise(character,{name:'Mira competing'},editor)]);assert.deepEqual(updates.map(row=>row.status).sort(),[201,409]);
    const winner=updates.find(row=>row.status===201).data;const replay=await revise(character,{name:'Mira revised'},owner,key);if(updates[0].status===201)assert.equal(replay.data.revision.id,winner.revision.id);else assert.equal(replay.status,409);
    character=winner;assert.deepEqual((await owner.request('GET',`/entities/${character.id}/revisions/2`)).data.revision,original.revision);
    await upload('image.jpg',{assetId:image.assetId,expectedAssetVersion:1});const fixed=(await owner.request('GET',`/entities/${character.id}`)).data.revision.media[0];assert.equal(fixed.mediaVersionId,image.id);assert.equal(fixed.version,1);
  });
  await t.test('binding adds a full card revision, rejects duplicates and never invents a card',async()=>{
    assert.equal((await post(editor,shotPath('/asset-bindings'),{expectedShotCardVersion:1,bindings:[]})).status,409);
    let card=(await editor.request('GET',shotPath('/card/editor'))).data;
    const saved=await editor.request('PATCH',shotPath('/card'),{expectedVersion:1,body:card.body});assert.equal(saved.status,200);shot=saved.data.shot;
    const foreign=await post(owner,`/projects/${other.id}/entities`,{kind:'prop',body:body('Foreign item')});
    assert.equal((await post(owner,shotPath('/asset-bindings'),{expectedShotCardVersion:shot.version,bindings:[{revisionId:foreign.data.revision.id,purpose:''}]})).status,404);
    assert.equal((await owner.request('GET',shotPath(''))).data.version,shot.version);
    const chosen=[{revisionId:character.revision.id,purpose:'Left side of the frame'},{revisionId:environment.revision.id,purpose:'Background'},{revisionId:prop.revision.id,purpose:'Held by character'},{revisionId:voice.revision.id,purpose:'Narration'}];
    assert.equal((await post(viewer,shotPath('/asset-bindings'),{expectedShotCardVersion:shot.version,bindings:chosen})).status,403);
    const duplicate=[chosen[0],{revisionId:(await owner.request('GET',`/entities/${character.id}/revisions/2`)).data.revision.id,purpose:'Other version'}];
    assert.equal((await post(owner,shotPath('/asset-bindings'),{expectedShotCardVersion:shot.version,bindings:duplicate})).status,400);
    const result=await post(editor,shotPath('/asset-bindings'),{expectedShotCardVersion:shot.version,bindings:chosen});assert.equal(result.status,201,JSON.stringify(result.data));shot=result.data.shot;
    assert.equal(result.data.card.assetReferences.length,4);assert.ok(result.data.card.assetWarnings.some(value=>value.includes('媒体已有新版本')));
    assert.equal((await post(owner,shotPath('/asset-bindings'),{expectedShotCardVersion:shot.version-1,bindings:[]})).status,409);
  });
  await t.test('old full and basic card editors preserve bindings unless explicitly cleared',async()=>{
    const before=(await owner.request('GET',shotPath('/card'))).data,context=(await editor.request('GET',shotPath('/card/editor'))).data;
    const {assetBindings,...oldBody}=context.body;const full=await editor.request('PATCH',shotPath('/card'),{expectedVersion:shot.version,body:{...oldBody,intent:'Keep references'}});assert.equal(full.status,200);shot=full.data.shot;assert.deepEqual(full.data.body.assetBindings,assetBindings);
    const basic=await editor.request('PATCH',shotPath(''),{expectedVersion:shot.version,description:'Updated action'});assert.equal(basic.status,200);shot=basic.data;
    const now=(await owner.request('GET',shotPath('/card'))).data;assert.deepEqual(now.body.assetBindings,assetBindings);assert.deepEqual((await owner.request('GET',shotPath(`/card/versions/${before.version}`))).data.body,before.body);
    const impacts=(await owner.request('GET',`/entities/${character.id}/impacted-shots`)).data.items;assert.ok(impacts.some(row=>row.current));assert.ok(impacts.some(row=>!row.current));
  });
  await t.test('prompts freeze semantic and media snapshots and warn when assets change',async()=>{
    const compiled=await post(editor,shotPath('/prompts/compile'),{mode:'commit',expectedShotVersion:shot.version,expectedProjectVersion:1,profileRevisionId:null});assert.equal(compiled.status,201,JSON.stringify(compiled.data));artifact=compiled.data;
    assert.equal(artifact.snapshot.entityRevisions.length,4);assert.ok(artifact.rendered.positivePrompt.includes('Left side of the frame'));assert.ok(artifact.rendered.positivePrompt.includes('Short hair'));assert.equal(artifact.rendered.productionReady,false);assert.ok(artifact.rendered.inputBindings.some(ref=>ref.mediaVersionId===image.id));assert.ok(artifact.rendered.warnings.some(value=>value.includes('授权/同意')));
    const stored=app.get(DatabaseService).sqlite.prepare('SELECT snapshot_json,rendered_json FROM prompt_artifacts WHERE id=?').get(artifact.id);
    character=(await revise(character,{description:'Later continuity setting'})).data;
    const history=(await viewer.request('GET',shotPath(`/prompts/${artifact.id}`))).data;assert.ok(history.freshness.reasons.some(value=>value.includes('资产')));assert.deepEqual(history.snapshot,artifact.snapshot);assert.deepEqual(app.get(DatabaseService).sqlite.prepare('SELECT snapshot_json,rendered_json FROM prompt_artifacts WHERE id=?').get(artifact.id),stored);
    const again=await post(owner,shotPath('/prompts/compile'),{mode:'preview',expectedShotVersion:shot.version,expectedProjectVersion:1,profileRevisionId:null});assert.equal(again.data.snapshot.entityRevisions.find(ref=>ref.entityId===character.id).version,character.currentVersion-1);
  });
  await t.test('export preview notices asset changes and freezes references after confirmation',async()=>{
    const path=`/projects/${project.id}/storyboard-exports`,options={format:'json',promptMode:'saved',scope:{type:'project'}};
    const preview=await post(owner,path+'/preview',options);assert.equal(preview.status,201);
    environment=(await revise(environment,{description:'Later scene lighting'})).data;
    assert.equal((await post(owner,path,{...options,expectedSnapshotHash:preview.data.snapshotHash})).status,409);
    const next=await post(owner,path+'/preview',options);assert.notEqual(next.data.snapshotHash,preview.data.snapshotHash);
    const done=await post(owner,path,{...options,expectedSnapshotHash:next.data.snapshotHash});assert.equal(done.status,201);
    const json=JSON.parse((await owner.request('GET',done.data.downloadPath.replace('/api/v1',''))).bytes.toString('utf8'));assert.equal(json.shots[0].card.assetReferences.length,4);
    for(const format of ['md','csv']){const request={...options,format},preview=await post(owner,path+'/preview',request),file=await post(owner,path,{...request,expectedSnapshotHash:preview.data.snapshotHash});assert.equal(file.status,201);const text=(await owner.request('GET',file.data.downloadPath.replace('/api/v1',''))).bytes.toString('utf8');assert.ok(text.includes(format==='md'?'### 固定资产引用':'asset_references_json'));assert.ok(text.includes('Short hair'));}
  });
  await t.test('failed revision audit rolls back the head and references atomically',async()=>{
    const db=app.get(DatabaseService).sqlite,before=db.prepare('SELECT COUNT(*) n FROM asset_entity_revisions').get().n;
    db.exec("CREATE TRIGGER fixture_entity_failure BEFORE INSERT ON audit_events WHEN NEW.action='entity.revise' BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;");
    try{assert.equal((await revise(prop,{name:'Must roll back'})).status,409);assert.equal((await owner.request('GET',`/entities/${prop.id}`)).data.currentVersion,prop.currentVersion);assert.equal(db.prepare('SELECT COUNT(*) n FROM asset_entity_revisions').get().n,before);}finally{db.exec('DROP TRIGGER fixture_entity_failure');}
    for(const table of ['asset_entity_revisions','entity_media_bindings','shot_asset_bindings']){assert.throws(()=>db.prepare(`DELETE FROM ${table}`).run(),/immutable/);assert.throws(()=>db.prepare(`UPDATE ${table} SET project_id=?`).run(other.id),/immutable/);}
  });
  await t.test('asset and revision pagination is bounded, stable and scoped',async()=>{
    for(let i=0;i<21;i++)await create('prop','Item '+i);
    const seen=[];let cursor;do{const page=await owner.request('GET',`/projects/${project.id}/entities?kind=prop${cursor?'&cursor='+cursor:''}`);assert.equal(page.status,200);assert.ok(page.data.items.length<=20);seen.push(...page.data.items.map(item=>item.id));cursor=page.data.nextCursor;}while(cursor);assert.equal(seen.length,22);assert.equal(new Set(seen).size,22);
    assert.equal((await owner.request('GET',`/projects/${other.id}/entities?cursor=${prop.id}`)).status,400);
    for(let i=0;i<21;i++){const next=await revise(prop,{description:'Revision '+i});assert.equal(next.status,201);prop=next.data;}
    const firstPage=(await owner.request('GET',`/entities/${prop.id}/revisions`)).data,second=(await owner.request('GET',`/entities/${prop.id}/revisions?before=${firstPage.nextCursor}`)).data;const versions=[...firstPage.items,...second.items].map(row=>row.version);assert.equal(versions.length,22);assert.equal(new Set(versions).size,22);assert.equal(versions[0],22);
  });
  await t.test('backup restores semantic identities references artifacts and media together',async()=>{
    const {backupDatabase}=await import('../dist/db/backup.js'),{verifyMedia}=await import('../../../tools/verify-media.mjs');const backup=await backupDatabase(process.env.DATABASE_PATH,join(directory,'backup')),restored=join(directory,'restored.sqlite'),root=join(directory,'restored-media');await copyFile(backup,restored);await cp(process.env.MEDIA_ROOT,root,{recursive:true});
    const config={databasePath:restored},restoredDb=new DatabaseService(config);try{assert.equal(restoredDb.sqlite.pragma('integrity_check',{simple:true}),'ok');assert.equal(restoredDb.sqlite.pragma('foreign_key_check').length,0);assert.equal(restoredDb.sqlite.prepare('SELECT COUNT(*) n FROM shot_asset_bindings').get().n,app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) n FROM shot_asset_bindings').get().n);assert.deepEqual(JSON.parse(restoredDb.sqlite.prepare('SELECT snapshot_json FROM prompt_artifacts WHERE id=?').get(artifact.id).snapshot_json),artifact.snapshot);assert.equal(restoredDb.sqlite.prepare('SELECT name FROM asset_entity_revisions WHERE id=?').get(character.revision.id).name,character.revision.name);}finally{restoredDb.onModuleDestroy();}
    assert.equal((await verifyMedia(restored,root)).valid,true);await app.close();await start();assert.deepEqual((await owner.request('GET',shotPath(`/prompts/${artifact.id}`))).data.snapshot,artifact.snapshot);
  });
  await t.test('explicit clearing makes a new card, and removal/trash revoke historical reads',async()=>{
    const result=await post(owner,shotPath('/asset-bindings'),{expectedShotCardVersion:shot.version,bindings:[]});assert.equal(result.status,201);assert.deepEqual(result.data.body.assetBindings,[]);assert.equal((await owner.request('GET',`/entities/${character.id}/impacted-shots`)).data.items.some(row=>row.current),false);
    await owner.request('DELETE',`/projects/${project.id}/members/${viewerId}`,{expectedRole:'VIEWER'});assert.equal((await viewer.request('GET',`/entities/${character.id}`)).status,404);assert.equal((await viewer.request('GET',`/media-versions/${image.id}/content`)).status,404);
    await owner.request('POST',`/projects/${project.id}/trash`,{expectedVersion:1});assert.equal((await owner.request('GET',`/entities/${character.id}/revisions/1`)).status,404);assert.equal((await owner.request('GET',shotPath(`/prompts/${artifact.id}`))).status,404);
  });
 }finally{if(app)await app.close();await rm(directory,{recursive:true,force:true});}
});
