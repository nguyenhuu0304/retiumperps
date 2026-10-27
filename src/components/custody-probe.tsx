'use client';
import {useEffect,useRef,useState} from 'react';
import {checkAccount,txPattern} from '../lib/setup/custody';
import {nextKind,callParams,checkProbeTx,checkDelta,validateFlow,type Kind,type Flow,type Pending,type Snapshot} from '../lib/setup/probe';
import {snapshot,readProbe} from '../lib/setup/probe-browser';
const titles:Record<Kind,string>={unpause:'Mở nạp bằng ví 37',approve:'Approve đúng 0,001 RTD',deposit:'Nạp 0,001 RTD',withdraw:'Rút lại 0,001 RTD'};
type Provider={request:(q:{method:string;params?:Record<string,unknown>})=>Promise<unknown>};
function wallet(){const p=(window as unknown as {retium?:Provider}).retium;if(!p)throw Error('Ví chưa sẵn sàng.');return p;}
function amount(raw:string){const n=BigInt(raw),f=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return (n/10n**18n).toString()+(f?'.'+f:'');}
export default function CustodyProbe({contract,deployTx}:{contract:string;deployTx:string}){
 const key='retium-perps:probe:v0.2.0:'+contract;
 const empty:Flow={version:1,contract,current:null,history:[]};
 const [flow,setFlow]=useState<Flow>(empty),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[notice,setNotice]=useState(''),[observed,setObserved]=useState<Snapshot|null>(null),[manual,setManual]=useState(''),[prepared,setPrepared]=useState<{pending:Pending;expires:number}|null>(null),[failed,setFailed]=useState(false);
 const lock=useRef(false),storageOk=useRef(false);
 const done=flow.history.some(h=>h.kind==='withdraw');
 let next:Kind|null=null;
 if(observed&&!flow.current&&!done){try{next=nextKind(observed);}catch{ /* Prepare displays the exact reason. */ }}
 useEffect(()=>{const t=setTimeout(()=>{try{const raw=localStorage.getItem(key);if(raw){const f=validateFlow(JSON.parse(raw),contract);setFlow(f);setManual(f.current?.txId||'');}storageOk.current=true;}catch(e){setNotice(e instanceof Error?e.message:'Không đọc được dữ liệu probe.');}setReady(true);},0);return ()=>clearTimeout(t);},[key,contract]);
 function latest():Flow{const raw=localStorage.getItem(key);return raw?validateFlow(JSON.parse(raw),contract):empty;}
 function save(f:Flow){if(!storageOk.current)throw Error('Không lưu được pending. Không gửi giao dịch.');validateFlow(f,contract);localStorage.setItem(key,JSON.stringify(f));setFlow(f);}
 async function run(f:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);try{await f();}catch(e){setPrepared(null);setNotice(e instanceof Error?e.message:'Thao tác thất bại.');}finally{lock.current=false;setBusy(false);}}
 async function refresh(){await run(async()=>{setPrepared(null);const s=await snapshot(contract,deployTx);setObserved(s);setNotice('Đã đọc số dư/allowance hiện tại. Đọc lại không xác nhận TX pending; dùng nút kiểm tra TX nếu đang chờ.');});}
 async function prepare(){await run(async()=>{
  setPrepared(null);if(!consent||!storageOk.current)throw Error('Đọc và tick xác nhận thử 0,001 RTD trước.');const f=latest();if(f.current)throw Error('Có bước đang chờ. Kiểm tra TX trước, không ký thêm.');if(f.history.some(h=>h.kind==='withdraw'))throw Error('Đã hoàn tất một vòng thử. Không nạp lại.');
  const a=await wallet().request({method:'retium_requestAccounts'}) as {address?:unknown;chainId?:unknown};checkAccount(a);
  const s=await snapshot(contract,deployTx),kind=nextKind(s);setObserved(s);
  if(kind==='deposit'&&BigInt(s.total)+1000000000000000n>10000000000000000000n)throw Error('Quỹ chạm cap 10 RTD.');
  setPrepared({pending:{kind,txId:'',unknown:true,before:s,at:Date.now()},expires:Date.now()+60000});
  setNotice('Bước tiếp theo: '+titles[kind]+'. Chưa gọi ký. Chọn phí bằng RTM trong ví để đối chiếu số dư RTD chính xác.');
 });}
 function sign(){
  if(lock.current||!prepared||!consent)return;
  if(Date.now()>prepared.expires){setPrepared(null);setNotice('Chuẩn bị đã hết hạn. Kiểm tra lại.');return;}
  lock.current=true;setBusy(true);setFailed(false);const p=prepared.pending;setPrepared(null);
  try{
   const provider=wallet(),f=latest();if(f.current||f.history.some(h=>h.kind==='withdraw'))throw Error('Tab khác/lần trước đã có bước gửi. Đọc lại trạng thái, không ký thêm.');
   const params=callParams(p.kind,contract);save({...f,current:p});
   // Keep wallet popup in the explicit signature click gesture, with no await beforehand.
   const request=provider.request({method:'retium_call',params});
   void request.then(result=>{const r=result as {txId?:string};if(!txPattern.test(r?.txId||''))throw Error('Ví chưa trả TX ID. Lấy TX từ lịch sử ví, không gửi lại.');const current=latest();if(current.current?.at!==p.at)throw Error('Trạng thái bước đã đổi; kiểm tra lịch sử ví.');save({...current,current:{...p,txId:r.txId!,unknown:false}});setManual(r.txId!);setNotice('Đã gửi '+titles[p.kind]+'. Bấm Kiểm tra TX bước đang chờ.');}).catch(e=>{
    if(Number(e?.code)===4001){try{const current=latest();if(current.current?.at===p.at)save({...current,current:null});}catch{ /* Preserve unknown if storage cannot be updated. */ }}
    setNotice((e instanceof Error?e.message:'Ví báo lỗi.')+' Nếu đã ký thì lấy TX để kiểm tra, không gửi lại.');
   }).finally(()=>{lock.current=false;setBusy(false);});
  }catch(e){lock.current=false;setBusy(false);setNotice(e instanceof Error?e.message:'Chưa gửi được.');}
 }
 async function verify(){await run(async()=>{
  setFailed(false);setPrepared(null);const f=latest(),p=f.current;if(!p)throw Error('Không có bước đang chờ.');const id=manual.trim()||p.txId;if(!txPattern.test(id))throw Error('Nhập TX ID của đúng bước '+p.kind+'.');
  const status=checkProbeTx(await readProbe('transaction/'+id),id,p.kind,contract);save({...f,current:{...p,txId:id,unknown:false}});
  if(status==='pending'){setNotice('TX đang Pending/SoftFinal. Kiểm tra lại sau, không gửi thêm.');return;}
  if(status==='failed'){setFailed(true);setNotice('Đã xác minh TX bị từ chối/thực thi lỗi. Chưa coi bước này hoàn tất. Có thể kiểm tra lỗi rồi chuẩn bị lại bằng nút bên dưới.');return;}
  const after=await snapshot(contract,deployTx);setObserved(after);checkDelta(p.kind,p.before,after);
  save({...f,current:null,history:[...f.history,{kind:p.kind,txId:id}]});setManual('');
  setNotice(p.kind==='withdraw'?'Hoàn tất vòng thử: đã rút lại 0,001 RTD, số dư custody giảm đúng số tiền. Chưa có Perps onchain.':'Đã xác minh HardFinal, exec_status ok và số dư/allowance khớp: '+titles[p.kind]+'. Bấm Chuẩn bị bước tiếp theo.');
 });}
 async function retryFailed(){await run(async()=>{
  const f=latest(),p=f.current;if(!p?.txId)throw Error('Thiếu TX thất bại.');if(checkProbeTx(await readProbe('transaction/'+p.txId),p.txId,p.kind,contract)!=='failed')throw Error('Chưa xác minh thất bại cuối cùng; giữ pending.');
  save({...f,current:null});setFailed(false);setObserved(await snapshot(contract,deployTx));setNotice('Đã bỏ khóa của TX thất bại đã đối chiếu. Chưa gửi lại; chuẩn bị sẽ đọc số dư mới.');
 });}
 return <section className="card" style={{padding:24,marginTop:20,overflowWrap:'anywhere'}}><h2>5. Thử nạp/rút đúng 0,001 RTD</h2><p>Contract: {contract}</p><p>Mỗi bước có chữ ký và phí mạng riêng. Approve chỉ cấp quyền; nạp mới chuyển RTD. Thanh toán phí bằng RTM để đối chiếu RTD.</p><ol><li>Mở nạp: set_paused(false), không chuyển token.</li><li>Approve 0,001 RTD cho đúng contract custody.</li><li>Nạp 0,001 RTD từ ví 37 vào custody.</li><li>Rút 0,001 RTD về chính ví 37.</li></ol><label style={{display:'flex',gap:12,alignItems:'center',margin:'16px 0'}}><input type="checkbox" style={{width:20}} checked={consent} onChange={e=>setConsent(e.target.checked)}/>Tôi đồng ý thử 0,001 RTD testnet và tự xác nhận từng giao dịch trong ví.</label><div style={{display:'flex',gap:12,flexWrap:'wrap'}}><button disabled={busy||!ready} onClick={()=>void refresh()}>Đọc trạng thái / số dư</button><button disabled={busy||!ready||!consent||!!flow.current||done} onClick={()=>void prepare()}>{next?'Chuẩn bị: '+titles[next]:'Chuẩn bị bước tiếp theo'}</button>{prepared&&<button onClick={sign} disabled={busy||!consent} style={{background:'#ff7937',color:'#111'}}>Ký: {titles[prepared.pending.kind]}</button>}</div>{observed&&<div style={{marginTop:20}}><p>Paused: {String(observed.paused)}</p><table><thead><tr><th>Chỉ số</th><th>RTD</th></tr></thead><tbody>{([['Ví 37',observed.wallet],['Token trong custody',observed.vault],['Số dư custody của ví 37',observed.credit],['Tổng liabilities',observed.total],['Allowance cho custody',observed.allowance]] as const).map(([name,n])=><tr key={name}><td>{name}</td><td>{amount(n)}</td></tr>)}</tbody></table><small>Snapshot đọc tuần tự; có giao dịch khác đồng thời có thể cần đối chiếu thủ công.</small></div>}{flow.current&&<div style={{marginTop:20}}><strong>Đang chờ: {titles[flow.current.kind]}</strong><p>{flow.current.unknown?'Ví chưa trả TX ID; không ký lại.':'Kiểm tra TX trước khi làm bước tiếp.'}</p><label htmlFor="probe-tx">TX ID bước này</label><input id="probe-tx" style={{width:'100%',margin:'12px 0'}} value={manual} onChange={e=>setManual(e.target.value)} placeholder="tx_…"/><button disabled={busy} onClick={()=>void verify()}>Kiểm tra TX bước đang chờ</button>{failed&&<button disabled={busy} onClick={()=>void retryFailed()} style={{marginLeft:12}}>Bỏ khóa TX đã xác minh thất bại</button>}</div>}{done&&<p className="positive">Đã hoàn tất một vòng nạp/rút được đối chiếu. Không tự chạy vòng mới.</p>}{flow.history.length>0&&<ul>{flow.history.map(h=><li key={h.txId}>{titles[h.kind]} — <button onClick={()=>void navigator.clipboard.writeText(h.txId).then(()=>setNotice('Đã copy TX ID.')).catch(()=>setNotice(h.txId))} title="Bấm để copy TX">{h.txId}</button></li>)}</ul>}{notice&&<p role="status">{notice}</p>}</section>;
}
