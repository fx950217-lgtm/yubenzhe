import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {passwordRecord} from '../server/auth.mjs';
import {createAcceptanceServer} from '../server/server.mjs';

const origin='https://public.example.test',password='Synthetic-public-static-ONLY-3274!';
const auth=await passwordRecord('preview',password);
const privateMarker='SYNTHETIC_PRIVATE_RELEASE_MATERIAL';

async function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'ybz-public-static-'));
  writeFileSync(join(dir,'index.html'),'PUBLIC_PRODUCT');
  mkdirSync(join(dir,'internal'));writeFileSync(join(dir,'internal','plan.txt'),privateMarker);
  writeFileSync(join(dir,'internal','index.html'),privateMarker);
  mkdirSync(join(dir,'internal-backup'));writeFileSync(join(dir,'internal-backup','index.html'),'UNRELATED_PUBLIC_DIRECTORY');
  mkdirSync(join(dir,'downloads'));writeFileSync(join(dir,'downloads','ybz.apk'),'SYNTHETIC_PUBLIC_DOWNLOAD');
  const server=createAcceptanceServer({role:'frontend',origin,authConfig:auth,publicFrontend:true,staticRoot:dir});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const request=(path,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
    const req=httpRequest({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{Host:new URL(origin).host,...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));
    });req.on('error',reject);req.end(body);
  });
  const login=async()=>{
    const result=await request('/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({username:'preview',password}).toString()});
    assert.equal(result.status,303);return result.headers['set-cookie'][0].split(';')[0];
  };
  t.after(async()=>{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    const target=resolve(dir);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('ybz-public-static-'));
    rmSync(target,{recursive:true,force:true});
  });
  return {dir,request,login};
}

test('public frontend denies accidentally bundled private material including encoded paths for every method',async t=>{
  const f=await fixture(t);
  const paths=['/internal','/internal/','/internal/index.html','/internal/plan.txt?download=1','/%69nternal/plan.txt','/i%6eternal/plan.txt','/internal%2fplan.txt','/%69nternal%2Fplan.txt','/%49NTERNAL/plan.txt','/internal./plan.txt','/internal%20/plan.txt','/internal%5cplan.txt','/nested/%2e%2e/internal/plan.txt','/nested%2f..%2finternal/plan.txt'];
  for(const method of ['GET','HEAD','POST'])for(const path of paths){
    const result=await f.request(path,{method});assert.equal(result.status,404,method+' '+path);
    assert.doesNotMatch(result.text,new RegExp(privateMarker));assert.equal(result.headers['content-disposition'],undefined);
    assert.match(result.headers['cache-control'],/no-store/);
  }
});

test('shared acceptance authentication never reopens internal material in public mode',async t=>{
  const f=await fixture(t),cookie=await f.login();
  for(const path of ['/internal/index.html','/%69nternal/plan.txt','/internal%2fplan.txt']){
    const result=await f.request(path,{headers:{Cookie:cookie}});assert.equal(result.status,404);assert.doesNotMatch(result.text,new RegExp(privateMarker));
  }
});

test('a public alias resolving into internal material is denied after realpath resolution',async t=>{
  const f=await fixture(t);symlinkSync(join(f.dir,'internal'),join(f.dir,'published'),process.platform==='win32'?'junction':'dir');
  for(const method of ['GET','HEAD']){
    const result=await f.request('/published/plan.txt',{method});assert.equal(result.status,404);assert.doesNotMatch(result.text,new RegExp(privateMarker));
  }
});

test('public product files and installer downloads stay available without a shared login',async t=>{
  const f=await fixture(t);
  for(const [path,content]of [['/','PUBLIC_PRODUCT'],['/internal-backup/index.html','UNRELATED_PUBLIC_DIRECTORY'],['/downloads/ybz.apk','SYNTHETIC_PUBLIC_DOWNLOAD']]){
    const result=await f.request(path);assert.equal(result.status,200,path);assert.equal(result.text,content);
  }
  assert.match((await f.request('/downloads/ybz.apk')).headers['content-disposition'],/^attachment;/);
  const malformed=await f.request('/%broken');assert.equal(malformed.status,404);assert.doesNotMatch(malformed.text,new RegExp(privateMarker));
});
