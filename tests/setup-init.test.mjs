import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {OWNER,ASSET,ASSET_HASH,checkInit,checkInitialized} from '../src/lib/setup/custody.ts';
const contract='a'.repeat(64),id='tx_'+'b'.repeat(32);
const tx={tx_id:id,sender:OWNER,action:'call',amount:'0',recipient:contract,call:{contract,method:'init'},finality:'HardFinal',exec_status:'ok',exec_error:null,rejection_reason:null};
test('INIT accepts only matching owner/contract/method/zero amount and exact TX',()=>{
 assert.equal(checkInit(tx,id,contract),'confirmed');
 for(const x of [{sender:'other'},{recipient:'other'},{action:'deploy'},{amount:'1'},{tx_id:'other'},{call:{contract,method:'approve'}},{call:{contract:'other',method:'init'}}])assert.throws(()=>checkInit({...tx,...x},id,contract));
});
test('INIT pending, refusal, execution trap and contradictory terminal status never confirm',()=>{
 assert.equal(checkInit({...tx,finality:'SoftFinal'},id,contract),'pending');
 for(const x of [{exec_status:'failed'},{exec_error:'trap'},{rejection_reason:'refused'},{finality:'Rejected'},{status:'Voided'}])assert.equal(checkInit({...tx,...x},id,contract),'failed');
});
test('INIT state readback requires initialized + paused; no inferred success on missing/wrong market',()=>{
 const m={owner:OWNER,asset:ASSET,assetHash:ASSET_HASH,version:'v0.2.0',testnetOnly:true,positionsEnabled:false,initialized:true,paused:true};
 checkInitialized(m);for(const x of [{initialized:false},{paused:false},{owner:'other'},{asset:'other'},{initialized:undefined}])assert.throws(()=>checkInitialized({...m,...x}));
});
test('INIT popup invocation has no awaited prep and preserves separate recovery record',()=>{
 const s=fs.readFileSync(new URL('../src/components/custody-init.tsx',import.meta.url),'utf8');const sign=s.slice(s.indexOf(' function sign()'),s.indexOf(' async function verify()')).replace(/\/\/[^\n]*/g,'');
 assert.ok(!/\bawait\b/.test(sign));assert.ok(sign.indexOf('save(held)')<sign.indexOf("method:'retium_call'"));
 assert.ok(sign.includes("method:'init',args:[],amountAtomic:'0'"));assert.ok(!s.includes("method:'retium_deploy'"));assert.ok(s.includes('checkInitialized(m,false)'));assert.ok(s.includes('retium-perps:initialize:v0.2.0:'));
});
