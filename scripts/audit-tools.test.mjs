import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runAgent } from './auction-agent.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(handler, action) {
  const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try {await action(`http://127.0.0.1:${server.address().port}`)} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
}
function json(res,data,code=0,status=200){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({code,data}));}

test('Agent stops on 401 and never logs credential',async()=>{
  const output=[];await fixture((req,res)=>json(res,null,3001,401),async baseUrl=>{
    await assert.rejects(runAgent({baseUrl,token:'test-only-fake-secret',pollMs:100,log:x=>output.push(x)}),/401/);
  });assert.ok(output.every(x=>!x.includes('test-only-fake-secret')));
});

test('Agent handles 429, competition and lost-response replay with unchanged requestId',async()=>{
  let rate=true,stage=0;const requests=[],output=[];
  await fixture(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer test-only-fake-secret');
    if(rate){rate=false;res.setHeader('Retry-After','1');json(res,null,3004,429);return;}
    if(req.url.endsWith('/me')){json(res,{auctionId:1,userId:9});return;}
    if(req.method==='GET'&&req.url.endsWith('/auctions/1')){
      json(res,{id:1,status:stage===3?'FINISHED':'RUNNING',currentLeaderId:8,currentPrice:100+(stage>0?10:0),minIncrement:10,result:{winnerId:9,finalPrice:120}});return;
    }
    if(req.url.endsWith('/wallet')){json(res,{available:1000});return;}
    if(req.url.endsWith('/join')){json(res,null);return;}
    let body='';for await(const chunk of req)body+=chunk;const bid=JSON.parse(body);requests.push(bid);
    if(stage===0){stage=1;json(res,null,2002,400);return;}
    if(stage===1){stage=2;res.destroy();return;}
    stage=3;json(res,{idempotentReplay:true});
  },async baseUrl=>{const result=await runAgent({baseUrl,token:'test-only-fake-secret',budget:130,pollMs:100,maxRuntimeMs:8000,log:x=>output.push(x)});assert.equal(result.accepted,1);assert.equal(result.reason,'FINISHED');});
  assert.equal(requests.length,3);assert.notEqual(requests[0].requestId,requests[1].requestId);
  assert.deepEqual(requests[1],requests[2]);assert.equal(requests[1].amount,120);
  assert.ok(output.every(x=>!x.includes('test-only-fake-secret')));
});

test('Agent refuses a price over budget without POST writes',async()=>{
  let writes=0;await fixture((req,res)=>{
    if(req.method==='POST')writes++;
    if(req.url.endsWith('/me'))json(res,{auctionId:1,userId:9});
    else if(req.url.endsWith('/wallet'))json(res,{available:1000});
    else json(res,{status:'RUNNING',currentLeaderId:8,currentPrice:100,minIncrement:10});
  },async baseUrl=>{assert.equal((await runAgent({baseUrl,token:'test-only-fake-secret',budget:100,pollMs:100,log:()=>{}})).reason,'BUDGET');});assert.equal(writes,0);
});

test('stop-local leaves reused listener processes untouched (mock process commands)',()=>{
  const dir=mkdtempSync(resolve(tmpdir(),'bid-arena-stop-audit-'));const state=resolve(dir,'state.json');
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  try {
    writeFileSync(state,JSON.stringify({backendCmdPid:0,frontendCmdPid:0,backendJavaPid:99991,frontendNodePid:99992}));
    const code=`$ProgressPreference='SilentlyContinue'; function Get-CimInstance { [pscustomobject]@{Name='java.exe';CommandLine=${quote(root+' com.bidarena.App')};ProcessId=99991} }; function Stop-Process { Write-Output 'UNSAFE_STOP_CALLED' }; function Get-NetTCPConnection { }; & ${quote(resolve(root,'scripts/stop-local.ps1'))} -StateFile ${quote(state)}`;
    const output=execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
    assert.ok(!output.includes('UNSAFE_STOP_CALLED'));assert.ok(output.includes('reused'));
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep) && basename(dir).startsWith('bid-arena-stop-audit-'));
    rmSync(dir,{recursive:true,force:true});
  }
});
