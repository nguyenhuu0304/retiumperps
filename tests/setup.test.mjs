import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {blake3} from '@noble/hashes/blake3.js';
import {OWNER,ASSET,ASSET_HASH,SHA256,WASM_SIZE,checkAccount,checkDeploy,checkContract,checkMarket} from '../src/lib/setup/custody.ts';
const id='tx_'+'a'.repeat(32),contract='b'.repeat(64);
const tx={tx_id:id,sender:OWNER,action:'deploy',amount:'0',recipient:contract,finality:'HardFinal',exec_status:'ok',exec_error:null,rejection_reason:null};
test('setup: deployment WASM exact SHA256 and BLAKE3 match compiled artifact',()=>{
 const a=fs.readFileSync(new URL('../public/contracts/retium_perps_custody.wasm',import.meta.url)),b=fs.readFileSync(new URL('../contracts/custody/build/retium_perps_custody.wasm',import.meta.url));
 assert.deepEqual(a,b);assert.equal(a.length,WASM_SIZE);assert.equal(createHash('sha256').update(a).digest('hex'),SHA256);assert.equal(blake3(a).length,32);
});
test('setup: only wallet 37 chain 3; approval does not imply deployment',()=>{
 checkAccount({address:OWNER,chainId:3});assert.throws(()=>checkAccount({address:'other',chainId:3}));assert.throws(()=>checkAccount({address:OWNER,chainId:1}));
 assert.throws(()=>checkDeploy({...tx,action:'call',call:{method:'approve'}},id));
});
test('setup: pending, failed and executed deploy remain distinct',()=>{
 assert.equal(checkDeploy(tx,id),'confirmed');assert.equal(checkDeploy({...tx,finality:'SoftFinal'},id),'pending');
 for(const change of [{finality:'Rejected'},{exec_status:'failed'},{exec_error:'trap'},{rejection_reason:'refused'}])assert.equal(checkDeploy({...tx,...change},id),'failed');
 for(const change of [{sender:'other'},{amount:'1'},{tx_id:'other'},{recipient:''}])assert.throws(()=>checkDeploy({...tx,...change},id));
});
test('setup: matching contract ID, code hash, deployer and exact market identity required',()=>{
 const c={contract_id:contract,code_hash:'hash',deployer:OWNER,status:'deployed'};checkContract(c,contract,'hash');
 for(const change of [{code_hash:'wrong'},{deployer:'wrong'},{status:'pending'}])assert.throws(()=>checkContract({...c,...change},contract,'hash'));
 const m={owner:OWNER,asset:ASSET,assetHash:ASSET_HASH,version:'v0.2.0',testnetOnly:true,positionsEnabled:false};checkMarket(m);
 for(const change of [{owner:'wrong'},{assetHash:'wrong'},{positionsEnabled:true}])assert.throws(()=>checkMarket({...m,...change}));
});
test('setup: wallet call starts from click with no awaited prep, and unknown submission held',()=>{
 const s=fs.readFileSync(new URL('../src/app/setup/page.tsx',import.meta.url),'utf8');const sign=s.slice(s.indexOf(' function sign()'),s.indexOf(' async function verify()'));
 assert.ok(!/\bawait\b/.test(sign.replace(/\/\/[^\n]*/g,'')));assert.ok(sign.indexOf('save(held)')<sign.indexOf("method:'retium_deploy'"));assert.ok(sign.includes('unknown:true'));
 assert.ok(s.includes('AbortSignal.timeout(15000)'));assert.ok(s.includes('checkContract'));assert.ok(!s.includes("method:'retium_call'"));assert.ok(!s.includes('RETIUM_KEY'));
});
