import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {OWNER,ASSET,checkInitialized,ASSET_HASH} from '../src/lib/setup/custody.ts';
import {PROBE_AMOUNT as A,nextKind,callParams,checkProbeTx,checkDelta,validateFlow,validateSnapshot,atomic,checkProbeMarket} from '../src/lib/setup/probe.ts';
const c='a'.repeat(64),id='tx_'+'b'.repeat(32),n=BigInt(A);
const base={wallet:String(n*100n),vault:'0',credit:'0',total:'0',allowance:'0',paused:true,at:1000};
const opened={...base,paused:false},approved={...opened,allowance:A},deposited={...approved,wallet:String(n*99n),vault:A,credit:A,total:A,allowance:'0'},withdrawn={...opened};
test('probe: exact 0.001 RTD, finite approval, fixed recipient, no attached native RTM',()=>{
 assert.equal(A,'1000000000000000');
 assert.deepEqual(callParams('unpause',c),{contractId:c,method:'set_paused',args:['false'],amountAtomic:'0'});
 assert.deepEqual(callParams('approve',c),{contractId:ASSET,method:'approve',args:[c,A],amountAtomic:'0'});
 for(const k of ['deposit','withdraw'])assert.deepEqual(callParams(k,c),{contractId:c,method:k,args:[A],amountAtomic:'0'});
});
test('probe: live balances choose four steps, including recover withdrawal while paused',()=>{
 assert.equal(nextKind(base),'unpause');assert.equal(nextKind(opened),'approve');assert.equal(nextKind(approved),'deposit');assert.equal(nextKind(deposited),'withdraw');
 assert.equal(nextKind({...deposited,paused:true,wallet:'0'}),'withdraw');assert.equal(nextKind({...opened,allowance:String(n*10n)}),'approve');
 assert.throws(()=>nextKind({...opened,wallet:'0'}));assert.throws(()=>nextKind({...deposited,credit:'1'}));
});
test('probe: balances and allowance must match every executed step independently',()=>{
 checkDelta('unpause',base,opened);checkDelta('approve',opened,approved);checkDelta('deposit',approved,deposited);checkDelta('withdraw',deposited,withdrawn);
 assert.throws(()=>checkDelta('deposit',approved,{...deposited,credit:'0'}));
 assert.throws(()=>checkDelta('deposit',approved,{...deposited,wallet:String(n*99n-1n)}),'fee in RTD/external transfer is not silently accepted');
 assert.throws(()=>checkDelta('approve',opened,{...approved,allowance:String(n*100n)}));
 assert.throws(()=>checkDelta('withdraw',deposited,{...withdrawn,wallet:String(n*99n)}));
 assert.throws(()=>checkDelta('unpause',base,{...opened,credit:A,total:A,vault:A}));
 assert.throws(()=>checkDelta('deposit',opened,deposited),'approval not skipped');
});
test('probe: old approval TX cannot complete deposit; wrong caller/method/contract/amount refused',()=>{
 for(const k of ['unpause','approve','deposit','withdraw']){
  const p=callParams(k,c),tx={tx_id:id,sender:OWNER,action:'call',recipient:p.contractId,amount:'0',call:{contract:p.contractId,method:p.method},finality:'HardFinal',exec_status:'ok'};
  assert.equal(checkProbeTx(tx,id,k,c),'confirmed');assert.equal(checkProbeTx({...tx,finality:'SoftFinal'},id,k,c),'pending');
  for(const change of [{exec_status:'failed'},{exec_error:'trap'},{status:'Rejected'}])assert.equal(checkProbeTx({...tx,...change},id,k,c),'failed');
  for(const change of [{amount:'1'},{sender:'wrong'},{recipient:'wrong'},{call:{contract:p.contractId,method:'init'}}])assert.throws(()=>checkProbeTx({...tx,...change},id,k,c));
 }
 const p=callParams('approve',c);assert.throws(()=>checkProbeTx({tx_id:id,sender:OWNER,action:'call',recipient:ASSET,amount:'0',call:{contract:ASSET,method:p.method},finality:'HardFinal',exec_status:'ok'},id,'deposit',c));
});
test('probe: strict snapshot, asset identity, market initialized and caps',()=>{
 validateSnapshot(base);for(const v of ['-1','1.2','1e18','',null,1,String(1n<<128n)])assert.throws(()=>atomic(v));
 assert.throws(()=>validateSnapshot({...base,credit:'1'}));assert.throws(()=>validateSnapshot({...base,total:'1'}));
 const m={owner:OWNER,asset:ASSET,assetHash:ASSET_HASH,version:'v0.2.0',testnetOnly:true,positionsEnabled:false,initialized:true,paused:true,liabilitiesAtomic:'0',accountCapAtomic:'1000000000000000000',totalCapAtomic:'10000000000000000000'};
 checkProbeMarket(m);for(const change of [{initialized:false},{asset:'wrong'},{accountCapAtomic:'999'},{paused:'false'}])assert.throws(()=>checkProbeMarket({...m,...change}));
 checkInitialized({...m,paused:false},false);assert.throws(()=>checkInitialized({...m,paused:false}));
});
test('probe: pending snapshots persist per contract, invalid recovery rejected',()=>{
 const f={version:1,contract:c,current:{kind:'deposit',txId:'',unknown:true,before:approved,at:1000},history:[{kind:'approve',txId:id}]};assert.deepEqual(validateFlow(JSON.parse(JSON.stringify(f)),c),f);
 for(const change of [{contract:'other'},{current:{...f.current,kind:'send'}},{current:{...f.current,txId:'invalid'}},{current:{...f.current,before:{...approved,wallet:'-1'}}}])assert.throws(()=>validateFlow({...f,...change},c));
});
test('probe: wallet request policy stays synchronous, pending saved first, only explicit cancellation clears',()=>{
 const s=fs.readFileSync(new URL('../src/components/custody-probe.tsx',import.meta.url),'utf8'),sign=s.slice(s.indexOf(' function sign()'),s.indexOf(' async function verify()')).replace(/\/\/[^\n]*/g,'');
 assert.ok(!/\bawait\b/.test(sign));assert.ok(sign.indexOf('save({...f,current:p})')<sign.indexOf("method:'retium_call'"));
 assert.ok(sign.includes('Number(e?.code)===4001'));assert.ok(s.includes('checkDelta(p.kind,p.before,after)'));assert.ok(s.includes("==='failed'"));
 assert.ok(!s.includes('retium_deploy'));assert.ok(!s.includes('setInterval'));assert.ok(!s.includes('RETIUM_KEY'));
});
