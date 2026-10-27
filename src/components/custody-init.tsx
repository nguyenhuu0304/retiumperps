'use client';
import {useEffect,useRef,useState} from 'react';
import {blake3} from '@noble/hashes/blake3.js';
import {ASSET,ASSET_HASH,SHA256,WASM_SIZE,checkAccount,checkDeploy,checkContract,checkMarket,checkInit,checkInitialized,txPattern} from '../lib/setup/custody';
type InitRecord={version:1;contract:string;txId:string;unknown:boolean;confirmed:boolean};
type Prepared={contract:string;expires:number};
type Provider={request:(q:{method:string;params?:Record<string,unknown>})=>Promise<unknown>};
function wallet(){const p=(window as unknown as {retium?:Provider}).retium;if(!p)throw Error('Ví chưa sẵn sàng.');return p;}
async function read(path:string){const r=await fetch('https://rpc.retium.org/api/'+path,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('RPC HTTP '+r.status+'. Chưa xác minh được, không ký lại.');return await r.json() as Record<string,unknown>;}
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
export default function CustodyInit({contract,deployTx}:{contract:string;deployTx:string}){
 const key='retium-perps:initialize:v0.2.0:'+contract;
 const fresh:InitRecord={version:1,contract,txId:'',unknown:false,confirmed:false};
 const [record,setRecord]=useState<InitRecord>(fresh),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[prepared,setPrepared]=useState<Prepared|null>(null),[manual,setManual]=useState(''),[notice,setNotice]=useState(''),[consent,setConsent]=useState(false),[observed,setObserved]=useState(false);
 const lock=useRef(false),storageOk=useRef(false);
 useEffect(()=>{const timer=setTimeout(()=>{try{
  const raw=localStorage.getItem(key);if(raw){const s=JSON.parse(raw);if(s.version!==1||s.contract!==contract||typeof s.txId!=='string'||(s.txId&&!txPattern.test(s.txId))||typeof s.unknown!=='boolean'||typeof s.confirmed!=='boolean')throw Error('Bản lưu INIT không hợp lệ. Không gửi thêm.');setRecord(s);setManual(s.txId);}
  storageOk.current=true;
 }catch(e){setNotice(e instanceof Error?e.message:'Không đọc được bộ nhớ.');}setReady(true);},0);return ()=>clearTimeout(timer);},[key,contract]);
 function save(s:InitRecord){if(!storageOk.current)throw Error('Không lưu được trạng thái INIT; chưa gửi.');localStorage.setItem(key,JSON.stringify(s));setRecord(s);}
 async function run(f:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);try{await f();}catch(e){setPrepared(null);setNotice(e instanceof Error?e.message:'Thao tác thất bại.');}finally{lock.current=false;setBusy(false);}}
 async function inspect(){
  // A local verified flag is not authority: recheck deployment, bytes and market independently.
  const tx=await read('transaction/'+deployTx);if(checkDeploy(tx,deployTx)!=='confirmed')throw Error('Deploy chưa HardFinal và thực thi ok.');
  const r=await fetch('/contracts/retium_perps_custody.wasm',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Không tải được WASM.');
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==WASM_SIZE||hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==SHA256)throw Error('WASM sai hash.');
  if(tx.recipient!==contract)throw Error('Contract khác TX deploy.');
  checkContract(await read('contract/'+contract),contract,hex(blake3(bytes)));
  const asset=await read('contract/'+ASSET);if(asset.contract_id!==ASSET||asset.code_hash!==ASSET_HASH||asset.status!=='deployed')throw Error('RTD khác cấu hình ghim.');
  const response=await read('contract/'+contract+'/query?method=market&args=');if(response.ok!==true||typeof response.output!=='string')throw Error('Không đọc được market. Không coi lỗi RPC là chưa init.');
  const m=JSON.parse(response.output) as Record<string,unknown>;checkMarket(m);
  if(typeof m.initialized!=='boolean'||typeof m.paused!=='boolean')throw Error('Market thiếu trạng thái hợp lệ.');
  return m;
 }
 function noPrior(){const raw=localStorage.getItem(key);if(raw){const r=JSON.parse(raw);if(r.unknown||r.txId||r.confirmed)throw Error('Đã có INIT lưu lại. Kiểm tra trạng thái/TX, không ký lại.');}}
 async function refresh(){await run(async()=>{const m=await inspect();setObserved(m.initialized===true);setPrepared(null);
  if(m.initialized===true){checkInitialized(m,false);save({...record,confirmed:true,unknown:false});setNotice('Đã đọc chain: initialized=true, paused='+String(m.paused)+'. Không cần ký INIT nữa.');}
  else setNotice('Chain: initialized=false, paused=true. Chưa khởi tạo. Nếu có INIT đang chờ, kiểm tra TX trước.');
 });}
 async function prepare(){await run(async()=>{
  setPrepared(null);if(!ready||!storageOk.current||!consent)throw Error('Xác nhận bước INIT trước.');
  const a=await wallet().request({method:'retium_requestAccounts'}) as {address?:unknown;chainId?:unknown};checkAccount(a);
  const m=await inspect();if(m.initialized===true){checkInitialized(m,false);save({...record,confirmed:true,unknown:false});setObserved(true);setNotice('Contract đã init; không gửi thêm.');return;}
  if(m.paused!==true)throw Error('Trạng thái trước init không đúng.');noPrior();
  setPrepared({contract,expires:Date.now()+60000});setObserved(false);setNotice('Đã kiểm tra ví 37, deploy, code hash và market. Bấm Ký INIT để mở ví; giao dịch có phí mạng, không chuyển RTD.');
 });}
 function sign(){
  if(lock.current||!prepared||!consent||record.unknown||record.txId||record.confirmed)return;
  if(prepared.contract!==contract||Date.now()>prepared.expires){setPrepared(null);setNotice('Chuẩn bị đã hết hạn. Kiểm tra lại.');return;}
  lock.current=true;setBusy(true);setPrepared(null);const held={...fresh,unknown:true};
  try{const p=wallet();noPrior();save(held);
   // Invoke synchronously inside the signature button gesture. No asynchronous prep here.
   const request=p.request({method:'retium_call',params:{contractId:contract,method:'init',args:[],amountAtomic:'0'}});
   void request.then(result=>{const r=result as {txId?:string};if(!txPattern.test(r?.txId||''))throw Error('Ví chưa trả TX ID hợp lệ. Lấy TX INIT từ lịch sử ví; không ký lại.');save({...held,txId:r.txId!,unknown:false});setManual(r.txId!);setNotice('Đã gửi INIT. Bấm Kiểm tra TX INIT để đợi kết quả độc lập.');}).catch(e=>{
    if(Number(e?.code)===4001){try{save(fresh);}catch{ /* Keep pending if persistence fails. */ }}
    setNotice((e instanceof Error?e.message:'Ví báo lỗi.')+' Nếu đã ký, kiểm tra lịch sử ví; không gửi lại.');
   }).finally(()=>{lock.current=false;setBusy(false);});
  }catch(e){lock.current=false;setBusy(false);setNotice(e instanceof Error?e.message:'Không gọi được ví.');}
 }
 async function verify(){await run(async()=>{
  const id=manual.trim()||record.txId;if(!txPattern.test(id))throw Error('Nhập TX INIT hợp lệ.');
  const status=checkInit(await read('transaction/'+id),id,contract);
  save({...fresh,txId:id});
  if(status==='pending'){setNotice('INIT đang chờ finality. Kiểm tra lại, không ký thêm.');return;}
  if(status==='failed'){setNotice('INIT bị từ chối hoặc thực thi thất bại. Giữ TX để đối chiếu, không tự gửi lại.');return;}
  const m=await inspect();checkInitialized(m,false);save({...fresh,txId:id,confirmed:true});setObserved(true);setNotice('INIT đã HardFinal, exec_status ok; chain xác nhận initialized=true, paused='+String(m.paused)+'.');
 });}
 return <section className="card" style={{padding:24,marginTop:20,overflowWrap:'anywhere'}}><h2>4. Khởi tạo contract đã deploy · INIT</h2><p>Contract: {contract}</p><p>Chỉ ví 37 ký <code>init()</code>, RTM đính kèm = 0. Có phí mạng testnet. Khởi tạo xong vẫn khóa nạp.</p><label style={{display:'flex',gap:12,alignItems:'center',margin:'16px 0'}}><input type="checkbox" style={{width:20}} checked={consent} onChange={e=>setConsent(e.target.checked)}/>Tôi xác nhận chỉ khởi tạo custody, chưa approve hoặc chuyển RTD.</label><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button disabled={busy||!ready} onClick={()=>void refresh()}>Đọc lại trạng thái INIT</button><button disabled={busy||!ready||!consent||record.unknown||!!record.txId||record.confirmed||observed} onClick={()=>void prepare()}>Chuẩn bị INIT · chưa ký</button>{prepared&&<button disabled={busy||!consent} onClick={sign} style={{background:'#ff7937',color:'#111'}}>Ký INIT bằng ví 37</button>}</div><label htmlFor="init-tx" style={{display:'block',marginTop:20}}>TX ID của lần INIT (khác TX deploy)</label><input id="init-tx" style={{width:'100%',margin:'12px 0'}} value={manual} onChange={e=>setManual(e.target.value)} placeholder="tx_…"/><button disabled={busy||!ready} onClick={()=>void verify()}>Kiểm tra TX INIT</button>{record.unknown&&<p className="negative">Lần gọi ví chưa có TX trả về. Không ký lại; lấy TX INIT từ lịch sử ví.</p>}{record.confirmed&&<p className="positive">INIT đã được đối chiếu ở lần kiểm tra trước. Có thể đọc lại trạng thái hiện tại.</p>}{notice&&<p role="status">{notice}</p>}</section>;
}
