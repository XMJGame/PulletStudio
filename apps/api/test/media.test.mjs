import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, access, cp, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { createMediaFixtures } from '../../../tests/fixtures/media-fixtures.mjs';

test('local media storage imports verified originals and serves scoped immutable versions',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pullet-media-'));assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  process.env.DATABASE_PATH=join(directory,'studio.sqlite');process.env.MEDIA_ROOT=join(directory,'media');process.env.MEDIA_MAX_BYTES='2097152';process.env.SETUP_TOKEN='isolated-media-fixture-setup-token-2026';process.env.COOKIE_SECURE='false';
  const {createApplication}=await import('../dist/application.js'),{AppConfig}=await import('../dist/config.js'),{DatabaseService}=await import('../dist/db/database.service.js');
  const config=new AppConfig(),fixtures=await createMediaFixtures(join(directory,'fixtures'),config.ffmpegPath);
  let app,base,project,workspace,shot,first,viewerId,viewerUser,ownerUser;
  async function start(){app=await createApplication();await app.listen(0,'127.0.0.1');base=await app.getUrl();}
  function client(){let cookies='',csrf='';return {async request(method,path,body,headers={}){
    const binary=Buffer.isBuffer(body);const response=await fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':binary?'application/octet-stream':'application/json','X-Studio-Request':'1','X-CSRF-Token':csrf,Cookie:cookies,...headers},body:body===undefined?undefined:binary?body:JSON.stringify(body)});
    const incoming=response.headers.getSetCookie();if(incoming.length)cookies=incoming.map(value=>value.split(';')[0]).join('; ');
    if(response.ok&&(/\/content(?:\?|$)|\/poster$/.test(path))&&method==='GET')return {status:response.status,bytes:Buffer.from(await response.arrayBuffer()),headers:response.headers};
    const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data,headers:response.headers};
  }};}
  const owner=client(),viewer=client();
  async function importFile(name='image.png',extra={}){const input=fixtures[name];const initiated=await owner.request('POST',`/projects/${project.id}/media-uploads`,{fileName:name,byteLength:input.bytes.length,contentType:'',...extra},{'Idempotency-Key':randomUUID()});assert.equal(initiated.status,201,JSON.stringify(initiated.data));const done=await owner.request('PUT',`/media-uploads/${initiated.data.id}/content`,input.bytes);assert.equal(done.status,200,JSON.stringify(done.data));assert.equal(done.data.state,'complete');return done.data;}
  try{
    await start();const setup=(await owner.request('POST','/setup/initialize',{setupToken:process.env.SETUP_TOKEN,email:'owner@media.test',password:'Studio8!',name:'Producer',workspaceName:'Media team'})).data;workspace=setup.workspace;ownerUser=setup.user;
    project=(await owner.request('POST','/projects',{workspaceId:workspace.id,title:'Handmade film'})).data;shot=(await owner.request('POST',`/projects/${project.id}/shots`,{})).data;
    const invite=(await owner.request('POST',`/workspaces/${workspace.id}/invitations`,{email:'viewer@media.test'})).data,accepted=(await viewer.request('POST','/invitations/accept',{token:invite.token,name:'Viewer',password:'Studio8!'})).data;viewerId=accepted.user.id;viewerUser=accepted.user;
    await owner.request('POST',`/projects/${project.id}/members`,{userId:viewerId,role:'VIEWER'});
    await t.test('capabilities are real and original PNG bytes hash and poster are persisted',async()=>{
      const status=await owner.request('GET',`/projects/${project.id}/media-status`);assert.equal(status.data.available,true);assert.equal(status.data.maxBytes,2097152);
      first=await importFile();const version=first.mediaVersion;assert.equal(version.mediaType,'image');assert.equal(version.metadata.width,96);assert.equal(version.metadata.height,64);assert.equal(version.metadata.hasAudio,false);
      assert.equal(version.sha256,createHash('sha256').update(fixtures['image.png'].bytes).digest('hex'));
      const original=await viewer.request('GET',`/media-versions/${version.id}/content`);assert.deepEqual(original.bytes,fixtures['image.png'].bytes);assert.equal(original.headers.get('accept-ranges'),'bytes');
      const poster=await viewer.request('GET',`/media-versions/${version.id}/poster`);assert.equal(poster.status,200);assert.equal(poster.bytes[0],255);assert.equal(poster.bytes[1],216);
      assert.equal(version.objectKey,undefined);assert.equal(version.storageId,undefined);assert.ok(!JSON.stringify(version).includes(directory));
    });
    await t.test('video and audio use real probe metadata and byte ranges',async()=>{
      const clip=(await importFile('clip.mp4')).mediaVersion;assert.equal(clip.mediaType,'video');assert.equal(clip.metadata.hasAudio,true);assert.ok(clip.metadata.durationMs>=900&&clip.metadata.durationMs<=1200);
      const part=await viewer.request('GET',`/media-versions/${clip.id}/content`,undefined,{Range:'bytes=4-19'});assert.equal(part.status,206);assert.deepEqual(part.bytes,fixtures['clip.mp4'].bytes.subarray(4,20));assert.equal(part.headers.get('content-range'),`bytes 4-19/${clip.byteLength}`);
      const suffix=await viewer.request('GET',`/media-versions/${clip.id}/content`,undefined,{Range:'bytes=-7'});assert.deepEqual(suffix.bytes,fixtures['clip.mp4'].bytes.subarray(-7));
      const invalid=await viewer.request('GET',`/media-versions/${clip.id}/content`,undefined,{Range:'bytes=999999-'});assert.equal(invalid.status,416);
      const audio=(await importFile('sound.wav')).mediaVersion;assert.equal(audio.mediaType,'audio');assert.equal(audio.metadata.hasAudio,true);assert.equal(audio.posterUrl,null);assert.equal(audio.metadata.sampleRate,22050);
    });
    await t.test('all initially supported common media fixtures import without model connections',async()=>{
      for(const name of ['image.jpg','image.webp','clip.webm','sound.mp3','sound.ogg','sound.m4a','sound.opus','clip.mov'])await importFile(name);
      assert.equal(app.get(DatabaseService).sqlite.prepare('SELECT COUNT(*) n FROM text_connections').get().n,0);
    });
    await t.test('new media versions preserve original bytes and fixed draft take references',async()=>{
      const linked=await owner.request('POST',`/shots/${shot.id}/takes`,{mediaVersionId:first.mediaVersion.id,expectedShotVersion:1});assert.equal(linked.status,201);assert.equal(linked.data.takeNo,1);assert.equal(linked.data.state,'draft');
      const next=await importFile('image.jpg',{assetId:first.assetId,expectedAssetVersion:1});assert.equal(next.mediaVersion.version,2);
      const history=await owner.request('GET',`/media-assets/${first.assetId}/versions`);assert.deepEqual(history.data.items.map(row=>row.version),[2,1]);
      const replay=await owner.request('POST',`/shots/${shot.id}/takes`,{mediaVersionId:first.mediaVersion.id,expectedShotVersion:999});assert.equal(replay.data.id,linked.data.id);
      const take=(await viewer.request('GET',`/shots/${shot.id}/takes`)).data.items[0];assert.equal(take.media.id,first.mediaVersion.id);assert.deepEqual((await viewer.request('GET',`/media-versions/${take.media.id}/content`)).bytes,fixtures['image.png'].bytes);
      assert.equal((await viewer.request('POST',`/shots/${shot.id}/takes`,{mediaVersionId:next.mediaVersion.id,expectedShotVersion:1})).status,403);
    });
    await t.test('rejects fake formats, mismatched MIME, unsafe names, size limits and unauthorized writes',async()=>{
      const startUpload=(input,actor=owner,headers={})=>actor.request('POST',`/projects/${project.id}/media-uploads`,input,{'Idempotency-Key':randomUUID(),...headers});
      const initial={fileName:'image.png',byteLength:fixtures['image.png'].bytes.length,contentType:'image/png'};
      assert.equal((await startUpload(initial,viewer)).status,403);assert.equal((await startUpload({...initial,fileName:'../image.png'})).status,400);
      assert.equal((await startUpload({...initial,byteLength:2097153})).status,413);assert.equal((await startUpload(initial,owner,{'X-CSRF-Token':''})).status,403);
      for(const [name,bytes,mime] of [['unsafe.svg',Buffer.from('<svg onload="alert(1)"></svg>'), 'image/svg+xml'],['fake.png',fixtures['sound.wav'].bytes,'image/png'],['image.png',fixtures['image.png'].bytes,'audio/wav'],['bad.png',fixtures['image.png'].bytes.subarray(0,40),'image/png']]){
        const intent=(await startUpload({fileName:name,byteLength:bytes.length,contentType:mime})).data;
        const failed=await owner.request('PUT',`/media-uploads/${intent.id}/content`,bytes);assert.equal(failed.status,400,JSON.stringify(failed.data));assert.equal((await owner.request('GET',`/media-uploads/${intent.id}`)).data.state,'failed');
      }
      const foreign=(await owner.request('POST','/projects',{workspaceId:workspace.id,title:'Other media'})).data;
      assert.equal((await owner.request('POST',`/projects/${foreign.id}/media-uploads`,{...initial,assetId:first.assetId,expectedAssetVersion:2},{'Idempotency-Key':randomUUID()})).status,404);
      assert.equal((await owner.request('POST',`/projects/${project.id}/media-uploads`,{...initial,assetId:first.assetId,expectedAssetVersion:1},{'Idempotency-Key':randomUUID()})).status,409);
      const foreignIntent=(await owner.request('POST',`/projects/${foreign.id}/media-uploads`,initial,{'Idempotency-Key':randomUUID()})).data;
      const foreignVersion=(await owner.request('PUT',`/media-uploads/${foreignIntent.id}/content`,fixtures['image.png'].bytes)).data.mediaVersion;
      assert.equal((await owner.request('POST',`/shots/${shot.id}/takes`,{mediaVersionId:foreignVersion.id,expectedShotVersion:1})).status,404);
      assert.equal((await viewer.request('GET',`/media-versions/${foreignVersion.id}/content`)).status,404);
    });
    await t.test('same initiation key replays; a simulated full disk leaves no successful media version',async()=>{
      const {LocalStorage}=await import('../dist/storage/local-storage.js'),storage=app.get(LocalStorage),bytes=fixtures['image.png'].bytes,key=randomUUID();const input={fileName:'image.png',byteLength:bytes.length,contentType:'image/png'};
      const firstRequest=await owner.request('POST',`/projects/${project.id}/media-uploads`,input,{'Idempotency-Key':key});
      const secondRequest=await owner.request('POST',`/projects/${project.id}/media-uploads`,input,{'Idempotency-Key':key});assert.equal(firstRequest.data.id,secondRequest.data.id);
      assert.equal((await owner.request('POST',`/projects/${project.id}/media-uploads`,{...input,fileName:'other.png'},{'Idempotency-Key':key})).status,409);
      const originalStage=storage.stage;storage.stage=async()=>{const error=new Error('fixture disk full');error.code='ENOSPC';throw error;};
      try{const failed=await owner.request('PUT',`/media-uploads/${firstRequest.data.id}/content`,bytes);assert.equal(failed.data.code,'STORAGE_WRITE_FAILED');assert.equal((await owner.request('GET',`/media-uploads/${firstRequest.data.id}`)).data.state,'failed');}finally{storage.stage=originalStage;}
      const completed=await owner.request('PUT',`/media-uploads/${firstRequest.data.id}/content`,bytes);assert.equal(completed.data.state,'complete');
      assert.equal((await owner.request('GET',`/media-uploads/${firstRequest.data.id}`)).data.mediaVersion.id,completed.data.mediaVersion.id);
    });
    await t.test('post-publication SQL failure survives restart and reconciles without reuploading',async()=>{
      const bytes=fixtures['clip.mp4'].bytes,intent=(await owner.request('POST',`/projects/${project.id}/media-uploads`,{fileName:'clip.mp4',byteLength:bytes.length,contentType:'video/mp4'},{'Idempotency-Key':randomUUID()})).data;
      const db=app.get(DatabaseService).sqlite,before=db.prepare('SELECT COUNT(*) n FROM media_versions').get().n;
      db.exec("CREATE TRIGGER fixture_media_commit_failure BEFORE INSERT ON audit_events WHEN NEW.action='media.import' BEGIN SELECT RAISE(ABORT,'fixture media rollback'); END;");
      const failed=await owner.request('PUT',`/media-uploads/${intent.id}/content`,bytes);assert.equal(failed.status,409);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM media_versions').get().n,before);assert.equal((await owner.request('GET',`/media-uploads/${intent.id}`)).data.state,'needs_reconciliation');db.exec('DROP TRIGGER fixture_media_commit_failure');
      await app.close();await start();const reconciled=await owner.request('POST',`/media-uploads/${intent.id}/reconcile`,{});assert.equal(reconciled.status,201);assert.equal(reconciled.data.state,'complete');assert.equal(reconciled.data.mediaVersion.sha256,createHash('sha256').update(bytes).digest('hex'));
      assert.equal((await owner.request('POST',`/media-uploads/${intent.id}/reconcile`,{})).status,409);
    });
    await t.test('expired upload leases recover safely and unprivileged clients cannot claim another upload',async()=>{
      const {LocalStorage}=await import('../dist/storage/local-storage.js'),storage=app.get(LocalStorage),bytes=fixtures['image.png'].bytes;
      const intent=(await owner.request('POST',`/projects/${project.id}/media-uploads`,{fileName:'image.png',byteLength:bytes.length},{'Idempotency-Key':randomUUID()})).data;
      const lease=randomUUID(),path=await storage.path(`staging/${lease}/original.bin`,true);await writeFile(path,bytes.subarray(0,10));
      app.get(DatabaseService).sqlite.prepare("UPDATE media_uploads SET state='uploading',lease_owner=?,lease_until=? WHERE id=?").run(lease,Date.now()-1000,intent.id);
      assert.equal((await owner.request('GET',`/media-uploads/${intent.id}`)).data.state,'failed');await assert.rejects(access(path));
      assert.equal((await viewer.request('PUT',`/media-uploads/${intent.id}/content`,bytes)).status,403);
      assert.equal((await owner.request('PUT',`/media-uploads/${intent.id}/content`,bytes)).data.state,'complete');
    });
    await t.test('permission revoked during streaming prevents registration and cleans partial staging',async()=>{
      const {MediaService}=await import('../dist/assets/media.service.js');
      assert.equal((await owner.request('POST',`/projects/${project.id}/members`,{userId:viewerId,role:'EDITOR',expectedRole:'VIEWER'})).status,201);
      const bytes=fixtures['image.png'].bytes,intent=(await viewer.request('POST',`/projects/${project.id}/media-uploads`,{fileName:'image.png',byteLength:bytes.length},{'Idempotency-Key':randomUUID()})).data;
      let signalStarted,release;const started=new Promise(resolve=>{signalStarted=resolve;}),pause=new Promise(resolve=>{release=resolve;});
      const body=(async function*(){yield bytes.subarray(0,10);signalStarted();await pause;yield bytes.subarray(10);})();
      const pending=app.get(MediaService).receive(viewerUser,intent.id,body);await started;
      await owner.request('POST',`/projects/${project.id}/members`,{userId:viewerId,role:'VIEWER',expectedRole:'EDITOR'});release();
      await assert.rejects(pending,error=>error.getStatus()===403);assert.equal((await viewer.request('GET',`/media-uploads/${intent.id}`)).data.state,'failed');
    });
    await t.test('completed media and database restore together with a valid manifest',async()=>{
      const {backupDatabase}=await import('../dist/db/backup.js'),{verifyMedia}=await import('../../../tools/verify-media.mjs');
      const report=await verifyMedia(process.env.DATABASE_PATH,process.env.MEDIA_ROOT);assert.equal(report.valid,true);assert.equal(report.pendingUploads,0);
      const backup=await backupDatabase(process.env.DATABASE_PATH,join(directory,'clean-backup')),root=join(directory,'clean-restored-media'),database=join(directory,'clean-restored.sqlite');
      await copyFile(backup,database);await cp(process.env.MEDIA_ROOT,root,{recursive:true});const restored=await verifyMedia(database,root);assert.equal(restored.valid,true);assert.deepEqual(restored.files,report.files);
    });
    await t.test('concurrent media revisions cannot replace each other or old Take references',async()=>{
      const bytes=fixtures['image.png'].bytes,input={fileName:'image.png',byteLength:bytes.length,assetId:first.assetId,expectedAssetVersion:2};
      const jobs=await Promise.all([1,2].map(()=>owner.request('POST',`/projects/${project.id}/media-uploads`,input,{'Idempotency-Key':randomUUID()})));
      const results=await Promise.all(jobs.map(job=>owner.request('PUT',`/media-uploads/${job.data.id}/content`,bytes)));assert.deepEqual(results.map(row=>row.status).sort(),[200,409]);
      const pending=(await owner.request('GET',`/projects/${project.id}/media-uploads`)).data.items;assert.ok(pending.some(row=>row.state==='needs_reconciliation'));
      const db=app.get(DatabaseService).sqlite;for(const table of ['media_versions','takes','storage_connections'])assert.throws(()=>db.prepare(`DELETE FROM ${table}`).run(),/immutable/);
    });
    await t.test('moving to an empty media root does not silently rebind existing versions',async()=>{
      const originalRoot=process.env.MEDIA_ROOT;await app.close();process.env.MEDIA_ROOT=join(directory,'empty-root');await start();
      assert.equal((await owner.request('GET',`/media-versions/${first.mediaVersion.id}/content`)).data.code,'STORAGE_CONNECTION_UNAVAILABLE');
      await app.close();process.env.MEDIA_ROOT=originalRoot;await start();assert.deepEqual((await owner.request('GET',`/media-versions/${first.mediaVersion.id}/content`)).bytes,fixtures['image.png'].bytes);
    });
    await t.test('a consistent DB and media copy restores with a verified original and poster manifest',async()=>{
      const {backupDatabase}=await import('../dist/db/backup.js');const {verifyMedia}=await import('../../../tools/verify-media.mjs');
      // The deliberately conflicting version is unresolved: verification must report it.
      const report=await verifyMedia(process.env.DATABASE_PATH,process.env.MEDIA_ROOT);assert.equal(report.valid,false);assert.ok(report.pendingUploads>0);assert.ok(report.files.length>=8);
      const backup=await backupDatabase(process.env.DATABASE_PATH,join(directory,'backups')),restored=join(directory,'restored.sqlite'),root=join(directory,'restored-media');await copyFile(backup,restored);await cp(process.env.MEDIA_ROOT,root,{recursive:true});
      const restoredReport=await verifyMedia(restored,root);assert.deepEqual(restoredReport.files,report.files);assert.equal(restoredReport.storageId,report.storageId);
    });
    await t.test('media and upload pages are newest first, bounded and scoped, without duplicate records',async()=>{
      // Cross the page boundary through the actual import path, never synthetic metadata rows.
      for(let i=0;i<11;i++)await importFile();
      const db=app.get(DatabaseService).sqlite;
      for(const [endpoint,table,scope] of [['media-assets','media_assets',''],['media-uploads','media_uploads',' AND created_by=?']]){
        const expected=db.prepare(`SELECT id FROM ${table} WHERE project_id=?${scope} ORDER BY created_at DESC,id DESC`).all(...(scope?[project.id,ownerUser.id]:[project.id])).map(row=>row.id);
        const seen=[];let cursor;
        do{const page=await owner.request('GET',`/projects/${project.id}/${endpoint}${cursor?'?cursor='+cursor:''}`);assert.equal(page.status,200);assert.ok(page.data.items.length<=20);seen.push(...page.data.items.map(row=>row.id));cursor=page.data.nextCursor;}while(cursor);
        assert.ok(seen.length>20);assert.deepEqual(seen,expected);assert.equal(new Set(seen).size,seen.length);
        assert.equal((await owner.request('GET',`/projects/${project.id}/${endpoint}?cursor=${randomUUID()}`)).status,400);
      }
    });
    await t.test('membership removal and trash revoke original media delivery',async()=>{
      await owner.request('DELETE',`/projects/${project.id}/members/${viewerId}`,{expectedRole:'VIEWER'});assert.equal((await viewer.request('GET',`/media-versions/${first.mediaVersion.id}/content`)).status,404);
      await owner.request('POST',`/projects/${project.id}/trash`,{expectedVersion:1});assert.equal((await owner.request('GET',`/media-versions/${first.mediaVersion.id}/content`)).status,404);
    });
  }finally{if(app)await app.close();await rm(directory,{recursive:true,force:true});}
});
