import {ASSET,OWNER,checkMarket,txPattern} from './custody.ts';
export const PROBE_AMOUNT='1000000000000000'; // Exactly 0.001 RTD, 18 decimals.
export type Kind='unpause'|'approve'|'deposit'|'withdraw';
export type Snapshot={wallet:string;vault:string;credit:string;total:string;allowance:string;paused:boolean;at:number};
export type Pending={kind:Kind;txId:string;unknown:boolean;before:Snapshot;at:number};
export type Flow={version:1;contract:string;current:Pending|null;history:{kind:Kind;txId:string}[]};
export function atomic(value:unknown):string {
 if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,38})$/.test(value)||BigInt(value)>((1n<<128n)-1n))throw Error('Số atomic từ RPC không hợp lệ.');return value;
}
export function validateSnapshot(s:Snapshot){
 for(const k of ['wallet','vault','credit','total','allowance'] as const)atomic(s[k]);
 if(typeof s.paused!=='boolean'||!Number.isSafeInteger(s.at)||s.at<=0)throw Error('Snapshot không hợp lệ.');
 if(BigInt(s.vault)<BigInt(s.total)||BigInt(s.credit)>BigInt(s.total))throw Error('Quỹ không khớp liabilities. Không nạp thêm.');
}
export function validateFlow(raw:unknown,contract:string):Flow {
 if(!raw||typeof raw!=='object')throw Error('Lịch sử probe không hợp lệ.');const f=raw as Flow;
 if(f.version!==1||f.contract!==contract||!Array.isArray(f.history)||f.history.length>20)throw Error('Lịch sử probe không khớp contract.');
 const kind=(k:unknown)=>['unpause','approve','deposit','withdraw'].includes(String(k));
 for(const h of f.history)if(!h||!kind(h.kind)||!txPattern.test(h.txId))throw Error('Lịch sử TX không hợp lệ.');
 if(f.current!==null){const p=f.current;if(!p||!kind(p.kind)||typeof p.unknown!=='boolean'||typeof p.txId!=='string'||(p.txId&&!txPattern.test(p.txId))||!Number.isSafeInteger(p.at)||p.at<=0)throw Error('Pending probe không hợp lệ.');validateSnapshot(p.before);}
 return f;
}
export function nextKind(s:Snapshot):Kind {
 validateSnapshot(s);const a=BigInt(PROBE_AMOUNT),c=BigInt(s.credit);
 if(c===a)return 'withdraw';
 if(c!==0n)throw Error('Số dư custody khác 0.001 RTD. Dừng probe để đối chiếu, không nạp chồng.');
 if(s.paused)return 'unpause';
 if(BigInt(s.wallet)<a)throw Error('Ví không đủ 0.001 RTD.');
 return s.allowance===PROBE_AMOUNT?'deposit':'approve';
}
export function callParams(kind:Kind,contract:string):Record<string,unknown> {
 if(!/^[0-9a-f]{64}$/.test(contract))throw Error('Contract ID không hợp lệ.');
 const p={contractId:kind==='approve'?ASSET:contract,method:kind==='unpause'?'set_paused':kind,args:kind==='unpause'?['false']:kind==='approve'?[contract,PROBE_AMOUNT]:[PROBE_AMOUNT],amountAtomic:'0'};
 return p;
}
export function checkProbeTx(tx:Record<string,unknown>,id:string,kind:Kind,contract:string):'pending'|'failed'|'confirmed' {
 const p=callParams(kind,contract),c=tx.call as {contract?:unknown;method?:unknown}|null;
 if(!txPattern.test(id)||tx.tx_id!==id||tx.sender!==OWNER||tx.action!=='call'||tx.amount!=='0'||tx.recipient!==p.contractId||c?.contract!==p.contractId||c?.method!==p.method)throw Error('TX không khớp ví 37, contract hoặc bước đang kiểm tra. Không gửi lại.');
 if([tx.finality,tx.status].some(s=>['Rejected','Voided','Failed'].includes(String(s))))return 'failed';
 if((tx.finality||tx.status)!=='HardFinal')return 'pending';
 return tx.exec_status==='ok'&&!tx.exec_error&&!tx.rejection_reason?'confirmed':'failed';
}
export function checkDelta(kind:Kind,b:Snapshot,a:Snapshot){
 validateSnapshot(b);validateSnapshot(a);if(nextKind(b)!==kind)throw Error('Bước không khớp snapshot chuẩn bị.');
 const n=BigInt(PROBE_AMOUNT),delta=(k:'wallet'|'vault'|'credit'|'total'|'allowance')=>BigInt(a[k])-BigInt(b[k]);
 const unchanged=(keys:('wallet'|'vault'|'credit'|'total'|'allowance')[])=>keys.every(k=>delta(k)===0n);
 let ok=false;
 if(kind==='unpause')ok=!a.paused&&unchanged(['wallet','vault','credit','total','allowance']);
 if(kind==='approve')ok=!a.paused&&a.allowance===PROBE_AMOUNT&&unchanged(['wallet','vault','credit','total']);
 if(kind==='deposit')ok=!a.paused&&delta('wallet')===-n&&delta('vault')===n&&delta('credit')===n&&delta('total')===n&&a.allowance==='0';
 if(kind==='withdraw')ok=delta('wallet')===n&&delta('vault')===-n&&delta('credit')===-n&&delta('total')===-n&&delta('allowance')===0n;
 if(!ok)throw Error('TX đã thực thi nhưng chênh lệch số dư/allowance chưa khớp bước '+kind+'. Giữ TX, không tự gửi lại. Kiểm tra có giao dịch khác hoặc phí trả bằng RTD.');
}
export function checkProbeMarket(m:Record<string,unknown>){
 checkMarket(m);if(m.initialized!==true||typeof m.paused!=='boolean'||m.accountCapAtomic!=='1000000000000000000'||m.totalCapAtomic!=='10000000000000000000')throw Error('Market chưa init hoặc cấu hình cap khác bản probe.');
 atomic(m.liabilitiesAtomic);
}
