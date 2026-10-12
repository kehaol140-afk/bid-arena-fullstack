import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { runAgent } from './auction-agent.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mysql=process.env.BID_MYSQL_EXE || 'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe';
const java=process.env.BID_JAVA_EXE || (process.env.JAVA_HOME ? resolve(process.env.JAVA_HOME,'bin/java.exe') : 'java');
const user=process.env.BID_TEST_DB_USER || 'root';
const password=process.env.BID_TEST_DB_PASSWORD || '123456';
const suffix=Date.now()+'_'+randomUUID().slice(0,8).replaceAll('-','');
const database=`bid_arena_codex_http_${suffix}`;
const port=Number(process.env.BID_AUDIT_HTTP_PORT || 8290);
const wsPort=Number(process.env.BID_AUDIT_WS_PORT || 8291);
const secondPort=port+10, secondWs=wsPort+10;
const base=`http://127.0.0.1:${port}`;
const evidenceDir=resolve(root,'docs/audit-evidence');
mkdirSync(evidenceDir,{recursive:true});mkdirSync(resolve(root,'logs'),{recursive:true});
const evidence=[]; const children=[]; const secrets=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function db(statement, useSchema=true) {
  return execFileSync(mysql,['--host=127.0.0.1','--port=3306',`--user=${user}`,
    '--default-character-set=utf8mb4','--batch','--raw','--skip-column-names',
    ...(useSchema?[database]:[]),'-e',statement],{encoding:'utf8',windowsHide:true,
      env:{...process.env,MYSQL_PWD:password}}).trim();
}
function row(statement) { return db(statement).split('\t').map(Number) }
async function request(method,path,body,token,server=base) {
  const res=await fetch(server+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:body===undefined?undefined:JSON.stringify(body), signal:AbortSignal.timeout(8000)});
  const data=await res.json().catch(()=>null);
  return {http:res.status,...data};
}
async function ok(method,path,body,token,server) {
  const r=await request(method,path,body,token,server);assert.equal(r.http,200,`${method} ${path} HTTP`);assert.equal(r.code,0,`${method} ${path} code`);return r.data;
}
async function step(name, action) {
  const t=Date.now();
  try {const detail=await action();evidence.push({name,status:'PASS',durationMs:Date.now()-t,...(detail?{detail}:{})});console.log(`[PASS] ${name}`);}
  catch(error) {let message=error.message;for(const secret of secrets)message=message.replaceAll(secret,'[REDACTED]');
    evidence.push({name,status:'FAIL',durationMs:Date.now()-t,error:message.slice(0,1000)});console.error(`[FAIL] ${name}: ${message.slice(0,500)}`);throw error;}
}
async function waitFor(action,timeout=20000) {
  const until=Date.now()+timeout;while(Date.now()<until){try{const x=await action();if(x)return x;}catch{}await sleep(150);}throw new Error('Timed out awaiting state');
}
async function start(http,ws,tag) {
  // Refuse to reuse anybody's server; this suite owns only freshly spawned processes.
  for(const p of [http,ws]) {
    const net=await import('node:net');
    await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(new Error(`Port ${p} already in use (including wildcard binding)`)));s.listen(p,'::',()=>s.close(resolve));});
  }
  const log=openSync(resolve(root,`logs/codex-${tag}-${suffix}.log`),'w');
  const child=spawn(java,[`-Dserver.port=${http}`,`-Dserver.websocket.port=${ws}`,'-cp',
    `${resolve(root,'backend/target/classes')};${resolve(root,'backend/target/lib')}/*`,'com.bidarena.App'],{
    cwd:root,env:{...process.env,BID_DB_URL:`jdbc:mysql://localhost:3306/${database}?allowPublicKeyRetrieval=true`,BID_DB_USER:user,BID_DB_PASSWORD:password},
    windowsHide:true,stdio:['ignore',log,log]});
  closeSync(log);children.push(child);
  await waitFor(async()=>child.exitCode===null && (await request('GET','/api/v1/health',undefined,undefined,`http://127.0.0.1:${http}`)).data?.status==='UP',45000);
  return child;
}
async function stop(child) {if(child.exitCode!==null || child.signalCode!==null)return;child.kill();await waitFor(()=>child.exitCode!==null || child.signalCode!==null,8000);}
async function login(email) {const d=await ok('POST','/api/v1/auth/login',{email,password:email==='admin@example.com'?'Admin123456!':'Test123456!'});secrets.push(d.token);return d;}
async function socket(token,auctionId,ws=wsPort) {
  const messages=[];const client=new WebSocket(`ws://127.0.0.1:${ws}/ws/auction?token=${encodeURIComponent(token)}&auctionId=${auctionId}`);
  client.onmessage=e=>{try{messages.push(JSON.parse(e.data))}catch{}};
  await waitFor(()=>messages.some(x=>x.type==='AUCTION_SNAPSHOT'));
  return {client,messages};
}

async function main() {
  db(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,false);
  let app=await start(port,wsPort,'http');
  let admin,a,b,agentUser,aid,agentToken,second;
  await step('Fresh MySQL migrations/seed/DRAFT/default180',async()=>{
    assert.match(db('SELECT VERSION()'),/^8\./);
    assert.equal(db("SELECT COUNT(*) FROM flyway_schema_history WHERE success=1"),'2');
    assert.deepEqual(row("SELECT start_price,min_increment,duration_seconds,current_price FROM auctions LIMIT 1"),[100,10,180,100]);
    assert.equal(db("SELECT status FROM auctions LIMIT 1"),'DRAFT');
    assert.equal(db("SELECT COUNT(*) FROM users WHERE role='AGENT'"),'1');
    assert.equal(db("SELECT COUNT(*) FROM wallets WHERE balance<>1000 OR frozen<>0"),'0');
  });
  await step('HTTP login and role/DTO binding',async()=>{
    admin=await login('admin@example.com');a=await login('bidder_a@example.com');b=await login('bidder_b@example.com');
    agentUser=await login('auction_agent@example.com');assert.equal(agentUser.user.role,'AGENT');
    assert.equal((await request('GET','/api/v1/users/me',undefined,a.token)).data.id,a.user.id);
    assert.equal((await request('POST','/api/v1/admin/auctions',{title:'denied'},a.token)).http,403);
    assert.equal((await request('GET','/api/v1/wallets/me')).http,401);
  });
  await step('OpenAPI accessible with actual required operations and security',async()=>{
    const spec=await (await fetch(base+'/openapi.json')).json();assert.equal(spec.swagger,'2.0');
    for(const [path,method] of [
      ['/api/v1/auth/login','post'],['/api/v1/users/me','get'],['/api/v1/wallets/me','get'],
      ['/api/v1/admin/auctions','post'],['/api/v1/admin/auctions/{id}/start','post'],
      ['/api/v1/admin/auctions/{id}/cancel','post'],['/api/v1/admin/agent-tokens','post'],
      ['/api/v1/auctions','get'],['/api/v1/auctions/{id}','get'],['/api/v1/auctions/{id}/join','post'],
      ['/api/v1/auctions/{id}/bids','get'],['/api/v1/auctions/{id}/bids','post'],
      ['/api/v1/agent/auctions/{id}','get'],['/api/v1/agent/auctions/{id}/bids','post']]) {
      assert.ok(spec.paths[path]?.[method],`${method} ${path} documented`);
    }
    assert.ok(spec.paths['/api/v1/auth/login'].post.parameters.some(x=>x.in==='body'));
    assert.ok(spec.securityDefinitions.AgentBearer);
    writeFileSync(resolve(evidenceDir,'openapi-verified.json'),JSON.stringify(spec,null,2));
  });
  await step('Create/start/join events and same-path GET/POST bids',async()=>{
    aid=(await ok('POST','/api/v1/admin/auctions',{title:'CODEX-HTTP-拍卖',durationSeconds:120},admin.token)).auctionId;
    assert.equal(db(`SELECT title FROM auctions WHERE id=${aid}`),'CODEX-HTTP-拍卖');
    await ok('POST',`/api/v1/admin/auctions/${aid}/start`,{},admin.token);
    await ok('POST',`/api/v1/auctions/${aid}/join`,{},a.token);
    await ok('POST',`/api/v1/auctions/${aid}/join`,{},b.token);
    assert.equal(db(`SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.type')) FROM auction_events WHERE auction_id=${aid} AND type='PARTICIPANT_JOINED' LIMIT 1`),'PARTICIPANT_JOINED');
    await ok('POST',`/api/v1/auctions/${aid}/bids`,{requestId:`http-${suffix}`,amount:110},a.token);
    assert.equal((await ok('GET',`/api/v1/auctions/${aid}/bids`,undefined,a.token)).length,1);
    assert.equal(db(`SELECT current_price FROM auctions WHERE id=${aid}`),'110');
  });
  await step('Missing/fractional/oversized bid amount rejected without writes',async()=>{
    const before=db(`SELECT current_price,seq FROM auctions WHERE id=${aid}`);
    for(const payload of [{requestId:randomUUID()}, {requestId:randomUUID(),amount:120.5}, {requestId:randomUUID(),amount:'not-a-number'}, {requestId:randomUUID(),amount:'9223372036854775808'}]) {
      const response=await request('POST',`/api/v1/auctions/${aid}/bids`,payload,a.token);
      assert.equal(response.http,400);assert.equal(response.code,1005);
      assert.equal(db(`SELECT current_price,seq FROM auctions WHERE id=${aid}`),before);
    }
  });
  if(process.argv.includes('--dto-only'))return;
  await step('Committed bid with lost HTTP response replays once',async()=>{
    const id=(await ok('POST','/api/v1/admin/auctions',{title:'CODEX-LOST-RESPONSE',durationSeconds:120},admin.token)).auctionId;
    await ok('POST',`/api/v1/admin/auctions/${id}/start`,{},admin.token);
    const http=await import('node:http');let lost=true;
    const proxy=http.createServer(async(req,res)=>{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const upstream=await fetch(base+req.url,{method:req.method,headers:{Authorization:req.headers.authorization,'Content-Type':'application/json'},body:Buffer.concat(chunks)});
      const payload=await upstream.text();
      if(lost){lost=false;res.destroy();return;}
      res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(payload);
    });
    await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
    const url=`http://127.0.0.1:${proxy.address().port}/api/v1/auctions/${id}/bids`;
    const proposal={requestId:`lost-${suffix}`,amount:110};
    const options={method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify(proposal)};
    try {
      await assert.rejects(fetch(url,options));
      assert.equal(db(`SELECT current_price FROM auctions WHERE id=${id}`),'110');
      const replay=await (await fetch(url,options)).json();assert.equal(replay.code,0);assert.equal(replay.data.idempotentReplay,true);
      assert.equal(db(`SELECT COUNT(*) FROM bids WHERE auction_id=${id}`),'1');
      assert.equal(db(`SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=${id} AND type='FREEZE'`),'1');
    } finally {proxy.closeAllConnections();await new Promise(r=>proxy.close(r));}
    const cancelled=await ok('POST',`/api/v1/admin/auctions/${id}/cancel`,{},admin.token);
    assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.result.finalPrice,0);
  });
  await step('WebSocket auth/scope/seq/private rejection/commit visibility',async()=>{
    const sa=await socket(a.token,aid),sb=await socket(b.token,aid);
    try {
      for(const s of [sa,sb])s.messages.length=0;
      const accepted=await ok('POST',`/api/v1/auctions/${aid}/bids`,{requestId:`ws-${suffix}`,amount:120},b.token);
      await waitFor(()=>sa.messages.some(x=>x.type==='BID_ACCEPTED'&&x.amount===120));
      const event=sa.messages.find(x=>x.type==='BID_ACCEPTED');
      assert.equal(event.auctionId,aid);assert.ok(event.seq>0);assert.ok(event.serverTime>0);
      assert.equal(db(`SELECT current_price FROM auctions WHERE id=${aid}`),'120');
      assert.ok(event.seq<=accepted.seq);
      await request('POST',`/api/v1/auctions/${aid}/bids`,{requestId:`reject-${suffix}`,amount:1},a.token);
      await waitFor(()=>sa.messages.some(x=>x.type==='BID_REJECTED'));await sleep(200);
      assert.ok(!sb.messages.some(x=>x.type==='BID_REJECTED'));
      sa.client.close();
      const recovered=await socket(a.token,aid);recovered.client.send('SYNC:0');
      await waitFor(()=>recovered.messages.some(x=>x.type==='BID_ACCEPTED'));
      assert.equal(recovered.messages.find(x=>x.type==='AUCTION_SNAPSHOT').currentPrice,120);
      recovered.client.close();
      const denied=new WebSocket(`ws://127.0.0.1:${wsPort}/ws/auction?token=invalid&auctionId=${aid}`);
      const rejected=[];denied.onmessage=e=>rejected.push(JSON.parse(e.data));
      await waitFor(()=>rejected.some(x=>x.state==='rejected'));denied.close();
    } finally {sa.client.close();sb.client.close();}
  });
  const issue=async(scopes='auction:read,auction:bid',extra={})=>{
    const d=await ok('POST','/api/v1/admin/agent-tokens',{userId:agentUser.user.id,auctionId:aid,scopes,expiresInSeconds:600,rateLimitPerMin:10000,...extra},admin.token);secrets.push(d.token);return d;
  };
  await step('Agent plaintext once/hash/scopes/admin+wallet isolation',async()=>{
    agentToken=await issue();
    assert.equal(db(`SELECT token_hash FROM agent_tokens WHERE id=${agentToken.tokenId}`),createHash('sha256').update(agentToken.token).digest('hex'));
    const list=await ok('GET',`/api/v1/admin/agent-tokens?userId=${agentUser.user.id}`,undefined,admin.token);
    assert.ok(!JSON.stringify(list).includes(agentToken.token));
    assert.equal((await request('POST','/api/v1/admin/auctions',{title:'forbidden'},agentToken.token)).http,401);
    assert.equal((await request('GET','/api/v1/wallets/me',undefined,agentToken.token)).http,401);
    assert.equal((await request('GET',`/api/v1/agent/auctions/${aid+1}`,undefined,agentToken.token)).http,403);
    assert.equal((await request('GET','/api/v1/agent/me',undefined,a.token)).http,401);
    const wallet=await ok('GET','/api/v1/agent/wallet',undefined,agentToken.token);assert.equal(wallet.userId,agentUser.user.id);
    const readOnly=await issue('auction:read');
    assert.equal((await request('POST',`/api/v1/agent/auctions/${aid}/join`,{},readOnly.token)).code,3003);
    assert.equal((await request('POST',`/api/v1/agent/auctions/${aid}/bids`,{requestId:randomUUID(),amount:140},readOnly.token)).code,3003);
    const bidOnly=await issue('auction:bid');
    assert.equal((await request('GET',`/api/v1/agent/auctions/${aid}`,undefined,bidOnly.token)).code,3003);
  });
  await step('Agent expiration/revocation and exact concurrent rate limit',async()=>{
    const expiring=await issue('auction:read',{expiresInSeconds:1});await sleep(1200);
    assert.equal((await request('GET','/api/v1/agent/me',undefined,expiring.token)).http,401);
    const revocable=await issue();await ok('POST',`/api/v1/admin/agent-tokens/${revocable.tokenId}/revoke`,{},admin.token);
    assert.equal((await request('GET','/api/v1/agent/me',undefined,revocable.token)).http,401);
    const limited=await issue('auction:read',{rateLimitPerMin:5});
    const calls=await Promise.all(Array.from({length:15},()=>request('GET','/api/v1/agent/me',undefined,limited.token)));
    assert.equal(calls.filter(x=>x.http===200).length,5);assert.equal(calls.filter(x=>x.http===429).length,10);
  });
  await step('Real independent restricted-token Agent strategy bid',async()=>{
    db(`UPDATE auctions SET end_time=${Date.now()+9000}, max_extends=0 WHERE id=${aid}`);
    const previous=process.env.AUCTION_AGENT_TOKEN;
    process.env.AUCTION_AGENT_TOKEN=agentToken.token;
    let result;
    try {result=await runAgent({baseUrl:base,budget:150,pollMs:1000,maxRuntimeMs:20000,
      log:line=>{assert.ok(!line.includes(agentToken.token));console.log(line);}});}
    finally {if(previous===undefined)delete process.env.AUCTION_AGENT_TOKEN;else process.env.AUCTION_AGENT_TOKEN=previous;}
    assert.equal(result.accepted,1);assert.equal(result.reason,'FINISHED');
    assert.equal(db(`SELECT winner_id FROM auction_results WHERE auction_id=${aid}`),String(agentUser.user.id));
    assert.equal(db(`SELECT participant_type FROM auction_participants WHERE auction_id=${aid} AND user_id=${agentUser.user.id}`),'AGENT');
    assert.equal(db(`SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=${aid} AND user_id=${agentUser.user.id} AND type='PAY'`),'1');
  });
  await step('Second JVM simultaneous scanner unique settlement',async()=>{
    second=await start(secondPort,secondWs,'second-instance');
    const id=(await ok('POST','/api/v1/admin/auctions',{title:'CODEX-TWO-INSTANCE',durationSeconds:120},admin.token)).auctionId;
    await ok('POST',`/api/v1/admin/auctions/${id}/start`,{},admin.token);
    await ok('POST',`/api/v1/auctions/${id}/bids`,{requestId:randomUUID(),amount:110},a.token);
    db(`UPDATE auctions SET end_time=${Date.now()-1} WHERE id=${id}`);
    await waitFor(()=>db(`SELECT status FROM auctions WHERE id=${id}`)==='FINISHED');
    await sleep(1500);
    assert.equal(db(`SELECT COUNT(*) FROM auction_results WHERE auction_id=${id}`),'1');
    assert.equal(db(`SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=${id} AND type='PAY'`),'1');
    await stop(second);
  });
  await step('Process crash after durable SETTLING and restart recovery',async()=>{
    const id=(await ok('POST','/api/v1/admin/auctions',{title:'CODEX-CRASH-RECOVERY',durationSeconds:120},admin.token)).auctionId;
    await ok('POST',`/api/v1/admin/auctions/${id}/start`,{},admin.token);
    await ok('POST',`/api/v1/auctions/${id}/bids`,{requestId:randomUUID(),amount:110},b.token);
    await stop(app);
    // Direct DB fault fixture models the committed phase1 claim in this isolated schema.
    db(`UPDATE auctions SET status='SETTLING',end_time=${Date.now()-1} WHERE id=${id}`);
    app=await start(port,wsPort,'restarted');
    await waitFor(()=>db(`SELECT status FROM auctions WHERE id=${id}`)==='FINISHED');
    assert.equal(db(`SELECT COUNT(*) FROM auction_results WHERE auction_id=${id}`),'1');
    assert.equal(db(`SELECT COUNT(*) FROM wallet_ledger WHERE auction_id=${id} AND type='PAY'`),'1');
    const d=await ok('GET',`/api/v1/auctions/${aid}`,undefined,a.token);assert.equal(d.result.winnerId,agentUser.user.id);
  });
  await step('Final wallet/hold/ledger invariants and list result',async()=>{
    assert.equal(db('SELECT COUNT(*) FROM wallets WHERE balance<0 OR frozen<0 OR frozen>balance'),'0');
    assert.equal(db('SELECT COUNT(*) FROM wallets w WHERE frozen<>(SELECT COALESCE(SUM(amount),0) FROM wallet_holds h WHERE h.user_id=w.user_id)'),'0');
    assert.equal(db("SELECT COUNT(*) FROM wallets w WHERE balance<>1000+(SELECT COALESCE(SUM(amount),0) FROM wallet_ledger l WHERE l.user_id=w.user_id AND type IN ('PAY','REFUND','GRANT'))"),'0');
    const list=await ok('GET','/api/v1/auctions',undefined,a.token);const summary=list.find(x=>x.id===aid);
    assert.equal(summary.currentLeaderName,'竞拍Agent');assert.equal(summary.result.winnerId,agentUser.user.id);
  });
  // Retain database and logs for review; terminate only the processes created here.
}

main().catch(error=>{
  process.exitCode=1;
  if(!evidence.some(x=>x.status==='FAIL')) {
    let message=error.message;for(const secret of secrets)message=message.replaceAll(secret,'[REDACTED]');
    evidence.push({name:'Audit setup/runtime',status:'FAIL',error:message.slice(0,1000)});
    console.error(`[FAIL] Audit setup/runtime: ${message.slice(0,500)}`);
  }
}).finally(async()=>{
  for(const child of children)try{await stop(child)}catch{}
  const report={date:new Date().toISOString(),database,ports:[port,wsPort,secondPort,secondWs],
    results:evidence,summary:{PASS:evidence.filter(x=>x.status==='PASS').length,FAIL:evidence.filter(x=>x.status==='FAIL').length},
    limitations:['Recovery fixture commits SETTLING while the server is stopped; not a power-loss test during fsync.',
      'Two JVMs share MySQL; WebSocket push remains process-local.','Docker runtime not tested by this script.']};
  const text=JSON.stringify(report,null,2);for(const secret of secrets)assert.ok(!text.includes(secret));
  writeFileSync(resolve(evidenceDir,process.argv.includes('--dto-only')?'http-mysql-dto-only-latest.json':'http-mysql-audit.json'),text);
  writeFileSync(resolve(evidenceDir,`http-mysql-${suffix}.json`),text);
  console.log(`Audit summary PASS=${report.summary.PASS} FAIL=${report.summary.FAIL} schema=${database}`);
});
