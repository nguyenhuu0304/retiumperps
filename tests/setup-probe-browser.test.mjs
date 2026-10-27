import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {blake3} from '@noble/hashes/blake3.js';
import {snapshot} from '../src/lib/setup/probe-browser.ts';
import {OWNER,ASSET,ASSET_HASH} from '../src/lib/setup/custody.ts';
const c='a'.repeat(64),id='tx_'+'b'.repeat(32);
test('browser read pipeline verifies byte/chain identity then reads exact wallet, vault, credit and allowance; HTTP errors propagate',async()=>{
 const bytes=fs.readFileSync(new URL('../public/contracts/retium_perps_custody.wasm',import.meta.url));const hash=Buffer.from(blake3(bytes)).toString('hex');const old=globalThis.fetch;let bad=false,seen=[];
 const m={owner:OWNER,asset:ASSET,assetHash:ASSET_HASH,version:'v0.2.0',testnetOnly:true,positionsEnabled:false,initialized:true,paused:true,liabilitiesAtomic:'0',accountCapAtomic:'1000000000000000000',totalCapAtomic:'10000000000000000000'};
 globalThis.fetch=async input=>{
  const s=String(input);seen.push(s);
  if(s.startsWith('/contracts/'))return new Response(bytes);
  if(bad)return new Response('blocked',{status:403});
  const u=new URL(s),p=u.pathname;
  if(p==='/api/transaction/'+id)return Response.json({tx_id:id,sender:OWNER,action:'deploy',amount:'0',recipient:c,finality:'HardFinal',exec_status:'ok'});
  if(p==='/api/contract/'+c)return Response.json({contract_id:c,code_hash:hash,deployer:OWNER,status:'deployed'});
  if(p==='/api/contract/'+ASSET)return Response.json({contract_id:ASSET,code_hash:ASSET_HASH,status:'deployed'});
  const method=u.searchParams.get('method'),args=u.searchParams.get('args');let output;
  if(method==='market')output=JSON.stringify(m);
  else if(method==='account'){assert.equal(args,OWNER);output=JSON.stringify({ok:true,account:OWNER,freeAtomic:'0'});}
  else if(method==='balance_of')output=args===OWNER?'"1000000000000000000"':'0';
  else if(method==='allowance'){assert.equal(args,OWNER+','+c);output='0';}
  else throw Error('Unexpected read '+s);
  return Response.json({ok:true,output});
 };
 try{
  const r=await snapshot(c,id);assert.equal(r.wallet,'1000000000000000000');assert.equal(r.vault,'0');assert.equal(r.credit,'0');assert.equal(r.allowance,'0');assert.equal(r.paused,true);assert.ok(seen.every(s=>s.startsWith('/contracts/')||s.startsWith('https://rpc.retium.org/api/')));
  bad=true;await assert.rejects(()=>snapshot(c,id),/HTTP 403/);
 }finally{globalThis.fetch=old;}
});
