import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile, unlink, symlink, link, utimes } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
test('local storage confines object paths, streams bounded data and detects changed originals',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'pullet-storage-'));assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  const {LocalStorage,objectPrefix}=await import('../dist/storage/local-storage.js');
  const root=join(directory,'media'),storage=new LocalStorage({mediaRoot:root});const data=Buffer.from('Immutable original bytes 🌂');let key,expected;
  try{
    await t.test('stages with a bounded stream and publishes one immutable directory',async()=>{
      const id=randomUUID();expected=await storage.stage(id,(async function*(){yield data.subarray(0,7);yield data.subarray(7);})(),{bytes:data.length,timeoutMs:1000});
      assert.equal(expected.sha256,createHash('sha256').update(data).digest('hex'));const prefix=objectPrefix(randomUUID(),randomUUID(),randomUUID());await storage.publish(id,prefix);key=prefix+'/original.bin';
      const stream=await storage.openVerified(key,expected);let buffer=Buffer.alloc(0);for await(const chunk of stream)buffer=Buffer.concat([buffer,chunk]);assert.deepEqual(buffer,data);
      assert.equal((await storage.stat(key)).bytes,data.length);assert.equal(await storage.ready(),JSON.parse(await readFile(join(root,'.pullet-storage.json'),'utf8')).id);
    });
    await t.test('rejects traversal, absolute keys, encodings and unsafe stage identifiers',async()=>{
      for(const value of ['../file','/etc/passwd','C:/file','workspaces/%2e%2e/secret','staging/../../secret'])await assert.rejects(storage.path(value),error=>error.code==='STORAGE_KEY_INVALID');
      await assert.rejects(storage.stage('../bad',(async function*(){yield data;})(),{bytes:data.length,timeoutMs:1000}),error=>error.code==='STORAGE_KEY_INVALID');
    });
    await t.test('refuses junctions and hardlinks without changing external target files',async()=>{
      const outside=join(directory,'outside');await mkdir(outside);await writeFile(join(outside,'original.bin'),'Outside stays intact');
      const id=randomUUID(),target=join(root,'staging',id);await symlink(outside,target,'junction');
      await assert.rejects(storage.path(`staging/${id}/original.bin`),error=>error.code==='STORAGE_PATH_UNSAFE');await assert.rejects(storage.discardStaging(id));assert.equal(await readFile(join(outside,'original.bin'),'utf8'),'Outside stays intact');await unlink(target);
      const linked=await storage.path(key);await unlink(linked);await link(join(outside,'original.bin'),linked);
      await assert.rejects(storage.openVerified(key,expected),error=>error.code==='STORAGE_PATH_UNSAFE');await unlink(linked);await writeFile(linked,data);assert.equal(await readFile(join(outside,'original.bin'),'utf8'),'Outside stays intact');
    });
    await t.test('invalidates the verified cache when same-size original bytes change',async()=>{
      const stream=await storage.openVerified(key,expected);for await(const _chunk of stream){};
      const path=await storage.path(key);await writeFile(path,Buffer.alloc(data.length,65));await utimes(path,new Date(),new Date(Date.now()+1000));
      await assert.rejects(storage.openVerified(key,expected),error=>error.code==='MEDIA_INTEGRITY_FAILED');
    });
    await t.test('rejects oversized/short streams and timeouts, then cleans only owned staging',async()=>{
      for(const bytes of [data.length-1,data.length+1]){const id=randomUUID();await assert.rejects(storage.stage(id,(async function*(){yield data;})(),{bytes,timeoutMs:1000}),error=>error.code==='UPLOAD_SIZE_MISMATCH');await storage.discardStaging(id);}
      const id=randomUUID();await assert.rejects(storage.stage(id,(async function*(){yield data.subarray(0,1);await new Promise(resolve=>setTimeout(resolve,100));yield data.subarray(1);})(),{bytes:data.length,timeoutMs:10}),error=>error.code==='UPLOAD_INTERRUPTED');await storage.discardStaging(id);
    });
  }finally{await rm(directory,{recursive:true,force:true});}
});
