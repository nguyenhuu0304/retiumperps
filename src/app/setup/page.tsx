'use client';
import {useEffect,useRef,useState} from 'react';
import Script from 'next/script';
import Link from 'next/link';
import CustodyInit from '../../components/custody-init';
import CustodyProbe from '../../components/custody-probe';
import {blake3} from '@noble/hashes/blake3.js';
import {OWNER,ASSET,ASSET_HASH,SHA256,WASM_SIZE,metadata,STORAGE_KEY,txPattern,checkAccount,checkDeploy,checkContract,checkMarket} from '../../lib/setup/custody';
type Provider={request:(q:{method:string;params?:Record<string,unknown>})=>Promise<unknown>};
type Saved={version:1;txId:string;unknown:boolean;contract:string;verified:boolean};
type Prepared={params:Record<string,unknown>;hash:string;expires:number};
const empty:Saved={version:1,txId:'',unknown:false,contract:'',verified:false};
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
function provider(){const p=(window as unknown as {retium?:Provider}).retium;if(!p)throw Error('Ví chưa sẵn sàng. Chờ SDK tải hoặc mở trong trình duyệt có ví Retium.');return p;}
async function read(path:string){const r=await fetch('https://rpc.retium.org/api/'+path,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('RPC HTTP '+r.status+'. Chưa xác minh được; không tự gửi lại.');const o:unknown=await r.json();if(!o||typeof o!=='object')throw Error('RPC trả dữ liệu không hợp lệ.');return o as Record<string,unknown>;}
async function wasm(){const r=await fetch('/contracts/retium_perps_custody.wasm',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Không tải được WASM.');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length!==WASM_SIZE||hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))!==SHA256)throw Error('WASM không đúng bản đã kiểm thử.');let s='';for(const b of bytes)s+=String.fromCharCode(b);return {base64:btoa(s),hash:hex(blake3(bytes))};}
export default function Setup(){
 const [account,setAccount]=useState(''),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[saved,setSaved]=useState<Saved>(empty),[prepared,setPrepared]=useState<Prepared|null>(null),[notice,setNotice]=useState(''),[accepted,setAccepted]=useState(false),[manual,setManual]=useState(''),[market,setMarket]=useState<Record<string,unknown>|null>(null);
 const lock=useRef(false),storageOk=useRef(false);
 useEffect(()=>{const timer=setTimeout(()=>{try{const s=localStorage.getItem(STORAGE_KEY);if(s){const p=JSON.parse(s);if(p.version!==1||typeof p.unknown!=='boolean'||typeof p.verified!=='boolean'||typeof p.contract!=='string'||(p.contract&&!/^[a-f0-9]{64}$/.test(p.contract))||typeof p.txId!=='string'||(p.txId&&!txPattern.test(p.txId)))throw Error('Lịch sử setup không hợp lệ; không gửi thêm.');setSaved(p);setManual(p.txId);}storageOk.current=true;}catch(e){setNotice(e instanceof Error?e.message:'Không đọc được bộ nhớ trình duyệt.');}setReady(true);},0);return ()=>clearTimeout(timer);},[]);
 function noExistingSubmission(){const raw=localStorage.getItem(STORAGE_KEY);if(raw){const s=JSON.parse(raw);if(s.txId||s.unknown||s.contract)throw Error('Tab khác hoặc lần trước đã lưu deploy. Tải lại để kiểm tra TX, không ký lại.');}}
 function save(s:Saved){if(!storageOk.current)throw Error('Không lưu được trạng thái. Không gửi giao dịch.');localStorage.setItem(STORAGE_KEY,JSON.stringify(s));setSaved(s);}
 async function run(f:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);try{await f();}catch(e){setNotice(e instanceof Error?e.message:'Thao tác thất bại.');}finally{lock.current=false;setBusy(false);}}
 async function connect(){await run(async()=>{const a=await provider().request({method:'retium_requestAccounts'}) as {address:string;chainId:number};checkAccount(a);setAccount(a.address);setNotice('Đã chọn ví 37. Chưa gửi giao dịch.');});}
 async function prepare(){await run(async()=>{
  setPrepared(null);noExistingSubmission();if(!accepted||!ready||!storageOk.current)throw Error('Đọc và xác nhận điều kiện trước.');if(saved.txId||saved.unknown||saved.contract)throw Error('Đã có lần deploy lưu lại. Kiểm tra TX đó, không deploy lại.');
  const a=await provider().request({method:'retium_requestAccounts'}) as {address:string;chainId:number};checkAccount(a);setAccount(a.address);
  const data=await wasm(),asset=await read('contract/'+ASSET);if(asset.contract_id!==ASSET||asset.code_hash!==ASSET_HASH||asset.status!=='deployed')throw Error('RTD không khớp cấu hình ghim.');
  setPrepared({params:{wasmBase64:data.base64,metadata},hash:data.hash,expires:Date.now()+60000});setNotice('WASM và RTD đã khớp. Bước tiếp theo gọi ví ký DEPLOY, có phí mạng.');
 });}
 function sign(){
  if(lock.current||!prepared||!accepted||saved.txId||saved.unknown||saved.contract)return;
  if(account!==OWNER||Date.now()>prepared.expires){setPrepared(null);setNotice('Bản chuẩn bị hết hạn hoặc ví chưa đúng. Chuẩn bị lại.');return;}
  lock.current=true;setBusy(true);const p=prepared;setPrepared(null);
  const held:Saved={...empty,unknown:true};
  try{
   const wallet=provider();noExistingSubmission();save(held);
   // Request starts synchronously in this button gesture, before any await/fetch.
   const waiting=wallet.request({method:'retium_deploy',params:p.params});
   void waiting.then(result=>{const r=result as {txId?:string};if(!txPattern.test(r?.txId||''))throw Error('Ví chưa trả TX ID hợp lệ. Lấy TX từ lịch sử ví; không gửi lại.');save({...held,txId:r.txId!,unknown:false});setManual(r.txId!);setNotice('Đã nhận TX ID. Chưa coi là thành công; bấm Kiểm tra TX.');}).catch(e=>{
    if(Number(e?.code)===4001){try{save(empty);}catch{ /* Preserve unknown if storage fails. */ }}
    setNotice((e instanceof Error?e.message:'Ví báo lỗi.')+' Nếu đã ký, kiểm tra lịch sử ví và nhập TX bên dưới. Không tự gửi lại.');
   }).finally(()=>{lock.current=false;setBusy(false);});
  }catch(e){lock.current=false;setBusy(false);setNotice(e instanceof Error?e.message:'Chưa gửi được.');}
 }
 async function verify(){await run(async()=>{
  const id=manual.trim()||saved.txId;if(!txPattern.test(id))throw Error('Nhập TX ID deploy hợp lệ.');
  const tx=await read('transaction/'+id),status=checkDeploy(tx,id);
  if(status==='pending'){save({...empty,txId:id});setNotice('TX đang chờ finality. Kiểm tra lại sau; không gửi lại.');return;}
  if(status==='failed'){save({...empty,txId:id});setNotice('TX bị từ chối hoặc thực thi thất bại. Giữ TX để đối chiếu, không tự gửi lại.');return;}
  // Persist TX before later reads so a failed RPC cannot unlock another deploy.
  save({...empty,txId:id});const bytes=await wasm(),contract=String(tx.recipient);
  checkContract(await read('contract/'+contract),contract,bytes.hash);
  const response=await read('contract/'+contract+'/query?method=market&args=');if(response.ok!==true||typeof response.output!=='string')throw Error('Chưa đọc được market; không suy đoán init.');
  const m=JSON.parse(response.output);checkMarket(m);save({version:1,txId:id,unknown:false,contract,verified:true});setMarket(m);setNotice('Deploy HardFinal, exec_status ok và code hash khớp. Chưa nạp tiền.');
 });}
 return <div className="app"><Script src="https://wallet.retium.org/connect/sdk/retium-sdk-1.3.0.js" integrity="sha384-FTG6s31+cSLKvZXfREum814s/L2AnqVyikuFQvMKIvFfAz40ksTcaXVbRmkHGGTU" crossOrigin="anonymous" strategy="afterInteractive"/><header><Link className="brand" href="/">Retium <strong>Perps</strong><small>SETUP</small></Link><Link href="/">Về sandbox</Link></header><main style={{maxWidth:960}}><p className="eyebrow">CUSTODY TESTNET · V0.2.0</p><h1>Deploy bằng ví trình duyệt</h1><p>Chỉ tạo contract thử nạp/rút RTD. Chưa có giao dịch Perps onchain.</p><div className="warning"><div><strong>Deploy có phí mạng RTM testnet.</strong><p>Không yêu cầu seed, file .sk hoặc API key. INIT là bước ký riêng; nạp/rút là bước riêng 0,001 RTD ở mục 5. Chỉ bấm ký một lần.</p></div></div>
 <section className="card" style={{padding:24,marginTop:20,overflowWrap:'anywhere'}}><h2>1. Kết nối ví quản trị</h2><p>Ví bắt buộc: {OWNER}</p><button disabled={busy||!ready} onClick={()=>void connect()}>Kết nối / kiểm tra ví 37</button><p>{account||'Chưa kết nối'}</p></section>
 <section className="card" style={{padding:24,marginTop:20}}><h2>2. Kiểm tra rồi ký deploy</h2><p>Cap: 1 RTD/ví · 10 RTD toàn quỹ · Khởi đầu PAUSED · Không có admin rút hộ.</p><label style={{display:'flex',gap:12,alignItems:'center',margin:'18px 0'}}><input style={{width:20}} type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>Tôi hiểu đây là contract thử nghiệm, deploy tốn phí mạng và chưa được xác minh trên testnet.</label><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button disabled={busy||!ready||!accepted||!!saved.txId||saved.unknown||!!saved.contract} onClick={()=>void prepare()}>Chuẩn bị deploy · chưa ký</button>{prepared&&<button onClick={sign} disabled={busy||!accepted} style={{background:'#ff7937',color:'#111'}}>Ký DEPLOY bằng ví 37</button>}</div>{prepared&&<p style={{overflowWrap:'anywhere'}}>BLAKE3 dự kiến: {prepared.hash}</p>}{saved.unknown&&<p className="negative">Đang giữ trạng thái lần gọi ví. Nếu không có TX trả về, lấy TX deploy trong lịch sử ví để kiểm tra. Không ký lại.</p>}</section>
 <section className="card" style={{padding:24,marginTop:20}}><h2>3. Kiểm tra TX / khôi phục sau tải lại</h2><label htmlFor="deploy-tx">TX ID của lần DEPLOY</label><input id="deploy-tx" value={manual} onChange={e=>setManual(e.target.value)} placeholder="tx_…" style={{margin:'12px 0',width:'100%'}}/><button disabled={busy||!ready} onClick={()=>void verify()}>Kiểm tra TX và contract</button>{saved.contract&&<p style={{overflowWrap:'anywhere'}}>Contract đã đối chiếu: {saved.contract}</p>}{saved.verified&&<p className="positive">Đã xác minh lần kiểm tra trước. Bấm kiểm tra lại để đọc trạng thái hiện tại.</p>}{market&&<p>Initialized: {String(market.initialized)} · Paused: {String(market.paused)}</p>}</section>{saved.verified&&saved.contract&&<CustodyInit key={saved.contract} contract={saved.contract} deployTx={saved.txId}/ >}{saved.verified&&saved.contract&&<CustodyProbe key={'probe:'+saved.contract} contract={saved.contract} deployTx={saved.txId}/>}{notice&&<div className="notice" role="status" style={{padding:20,marginTop:20}}>{notice}</div>}<p>Giữ contract ID, TX deploy và TX init. Khởi tạo không mở nạp. Giao dịch sandbox vẫn là mô phỏng.</p></main></div>;
}
