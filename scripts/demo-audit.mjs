import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import net from 'node:net';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const browser=process.argv.includes('--browser');
const seed=Number(process.argv.find(x=>x.startsWith('--seed='))?.split('=')[1] || 42);
const port=browser?8480:seed===42?8440:8470,wsPort=port+1;
const tag=browser?'browser':`seed${seed}`;
const schema=`bid_arena_codex_${tag}_${Date.now()}`;
const mysql=process.env.BID_MYSQL_EXE || 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe';
const java=process.env.BID_JAVA_EXE || (process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME,'bin/java.exe') : 'java');
const base=`http://127.0.0.1:${port}`;
const dir=resolve(root,'docs/audit-evidence');mkdirSync(dir,{recursive:true});mkdirSync(resolve(root,'logs'),{recursive:true});
const children=[];const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,BID_DB_URL:`jdbc:mysql://localhost:3306/${schema}?allowPublicKeyRetrieval=true`,
  BID_DB_USER:process.env.BID_TEST_DB_USER || 'root',BID_DB_PASSWORD:process.env.BID_TEST_DB_PASSWORD || '123456',
  BID_API_BASE:base,BID_WS_BASE:`ws://127.0.0.1:${wsPort}`};
function db(sql){return execFileSync(mysql,['--host=127.0.0.1',`--user=${env.BID_DB_USER}`,'--default-character-set=utf8mb4',
  '--batch','--raw','--skip-column-names','-e',sql],{encoding:'utf8',windowsHide:true,env:{...env,MYSQL_PWD:env.BID_DB_PASSWORD}}).trim()}
async function ready(action,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await action())return;}catch{}await sleep(200)}throw new Error('Readiness timeout')}
async function free(p){await new Promise((yes,no)=>{const s=net.createServer();s.on('error',()=>no(new Error(`Port ${p} occupied (including IPv6/wildcard binding)`)));s.listen(p,'::',()=>s.close(yes));})}
function launch(exe,args,log,cwd=root){const fd=openSync(resolve(root,log),'w');const p=spawn(exe,args,{cwd,env,windowsHide:true,stdio:['ignore',fd,fd]});closeSync(fd);children.push(p);return p}
async function run(exe,args){const p=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:'inherit'});await new Promise((yes,no)=>{p.on('error',no);p.on('exit',code=>code===0?yes():no(new Error(`${tag} exit ${code}`)))})}
async function api(method,path,body,token){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});const j=await r.json();assert.equal(j.code,0,`${method} ${path}`);return j.data}
let status='FAIL',error;
try {
  await free(port);await free(wsPort);
  db(`CREATE DATABASE ${schema} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const app=launch(java,[`-Dserver.port=${port}`,`-Dserver.websocket.port=${wsPort}`,'-cp',
    `${resolve(root,'backend/target/classes')};${resolve(root,'backend/target/lib')}/*`,'com.bidarena.App'],`logs/codex-demo-${tag}.log`);
  await ready(async()=>app.exitCode===null && (await (await fetch(base+'/api/v1/health')).json()).data?.status==='UP');
  if(browser){
    await free(5480);await free(9322);
    const admin=await api('POST','/api/v1/auth/login',{email:'admin@example.com',password:'Admin123456!'});
    const created=await api('POST','/api/v1/admin/auctions',{title:'E2E-BROWSER-AUCTION',description:'[DEMO] UTF-8 browser audit fixture',durationSeconds:75},admin.token);
    await api('POST',`/api/v1/admin/auctions/${created.auctionId}/start`,{},admin.token);
    env.E2E_AUCTION_ID=String(created.auctionId);env.BID_E2E_APP='http://127.0.0.1:5480';
    env.BID_E2E_SCREENSHOT_DIR=resolve(dir,'browser-screenshots');env.BID_E2E_REPORT=resolve(dir,'browser-results.json');
    const vite=launch(process.execPath,[resolve(root,'frontend/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5480','--strictPort'],'logs/codex-vite.log',resolve(root,'frontend'));
    await ready(async()=>vite.exitCode===null && (await fetch(env.BID_E2E_APP)).status===200);
    await run(process.execPath,[resolve(root,'scripts/browser_e2e.mjs')]);
    const report=JSON.parse(readFileSync(env.BID_E2E_REPORT,'utf8'));assert.equal(report.counts.PASS,9);assert.equal(report.counts.FAIL,0);
    assert.equal(db(`SELECT COUNT(*) FROM ${schema}.auction_participants WHERE auction_id=${created.auctionId}`),'2');
    assert.equal(db(`SELECT COUNT(*) FROM ${schema}.auction_results WHERE auction_id=${created.auctionId} AND final_price=150`),'1');
  } else {
    // Two untouched DRAFT rows make the existing list-order assertion observable
    // without changing its assertion or polluting a user's demo database.
    const admin=await api('POST','/api/v1/auth/login',{email:'admin@example.com',password:'Admin123456!'});
    await api('POST','/api/v1/admin/auctions',{title:`CODEX-${tag}-DRAFT`,durationSeconds:180},admin.token);
    await run(process.execPath,['--experimental-strip-types','--disable-warning=ExperimentalWarning',resolve(root,'simulator/src/main.ts'),
      '--bots=20',`--seed=${seed}`,`--tag=codex-${tag}`,`--json=${resolve(dir,`sim-${tag}.json`)}`]);
    const report=JSON.parse(readFileSync(resolve(dir,`sim-${tag}.json`),'utf8'));assert.equal(report.counts.FAIL,0);
    assert.ok(report.counts.PASS>=41);
    assert.equal(db(`SELECT COUNT(*) FROM ${schema}.wallets WHERE balance<0 OR frozen<0 OR frozen>balance`),'0');
    assert.equal(db(`SELECT COUNT(*) FROM ${schema}.auction_results`),'2');
  }
  status='PASS';
} catch(e){error=e.message;console.error(`[FAIL] ${tag}: ${error}`);process.exitCode=1;}
finally {
  for(const child of children.reverse()){if(child.exitCode===null && child.signalCode===null){child.kill();await ready(()=>child.exitCode!==null || child.signalCode!==null,8000).catch(()=>{})}}
  writeFileSync(resolve(dir,`demo-${tag}-runtime.json`),JSON.stringify({status,schema,ports:[port,wsPort],...(error?{error}:{}),retainedForReview:true},null,2));
  console.log(`[${status}] ${tag} retained schema=${schema}`);
}
