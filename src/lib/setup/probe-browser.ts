import {blake3} from '@noble/hashes/blake3.js';
import {OWNER,ASSET,ASSET_HASH,SHA256,WASM_SIZE,checkDeploy,checkContract} from './custody.ts';
import {atomic,validateSnapshot,checkProbeMarket,type Snapshot} from './probe.ts';
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
// Serial read pacing for the documented free RPC budget. No polling loop.
let lastStart=0;
async function read(path:string):Promise<Record<string,unknown>> {
 const wait=Math.max(0,300-(Date.now()-lastStart));if(wait)await new Promise(r=>setTimeout(r,wait));lastStart=Date.now();
 const r=await fetch('https://rpc.retium.org/api/'+path,{cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('RPC HTTP '+r.status+'. Chưa xác minh được; không ký lại.');
 const v:unknown=await r.json();if(!v||typeof v!=='object')throw Error('RPC không trả object hợp lệ.');return v as Record<string,unknown>;
}
export {read as readProbe};
async function query(id:string,method:string,args:string){const r=await read('contract/'+id+'/query?method='+method+'&args='+args);if(r.ok!==true||typeof r.output!=='string')throw Error('Không đọc được '+method+'.');return r.output;}
async function tokenNumber(method:string,args:string){const raw=(await query(ASSET,method,args)).trim();return atomic(raw.startsWith('"')?JSON.parse(raw):raw);}
export async function snapshot(contract:string,deployTx:string):Promise<Snapshot>{
 const tx=await read('transaction/'+deployTx);if(checkDeploy(tx,deployTx)!=='confirmed'||tx.recipient!==contract)throw Error('Deploy không khớp contract probe.');
 const r=await fetch('/contracts/retium_perps_custody.wasm',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Không tải được WASM.');const bytes=new Uint8Array(await r.arrayBuffer());
 if(bytes.length!==WASM_SIZE||hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==SHA256)throw Error('WASM sai hash.');
 checkContract(await read('contract/'+contract),contract,hex(blake3(bytes)));
 const asset=await read('contract/'+ASSET);if(asset.contract_id!==ASSET||asset.code_hash!==ASSET_HASH||asset.status!=='deployed')throw Error('RTD sai ID/hash.');
 const m=JSON.parse(await query(contract,'market','')) as Record<string,unknown>;checkProbeMarket(m);
 const account=JSON.parse(await query(contract,'account',OWNER)) as Record<string,unknown>;if(account.ok!==true||account.account!==OWNER)throw Error('Sổ custody không khớp ví.');
 const s:Snapshot={wallet:await tokenNumber('balance_of',OWNER),vault:await tokenNumber('balance_of',contract),credit:atomic(account.freeAtomic),total:atomic(m.liabilitiesAtomic),allowance:await tokenNumber('allowance',OWNER+','+contract),paused:m.paused as boolean,at:Date.now()};
 validateSnapshot(s);return s;
}
