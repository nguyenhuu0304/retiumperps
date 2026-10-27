"use client";
import { useMemo, useState } from "react";
// This lab never accesses wallets, RPC, keys, custody or live oracle.
const UNIT = 10n ** 18n;
const BPS = 10000n;
type Side = "long" | "short";
type DemoPosition = { id: number; side: Side; margin: string; leverage: string; entry: string };
function parse(s: string): bigint {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,18})?$/.test(s)) throw Error("Invalid amount; maximum 18 decimals");
  const [w, f = ""] = s.split(".");
  return BigInt(w)*UNIT + BigInt(f.padEnd(18,"0"));
}
function fmtFull(n:bigint):string {
 const neg=n<0n,a=neg?-n:n;const f=(a%UNIT).toString().padStart(18,"0").replace(/0+$/,"");return `${neg?"-":""}${a/UNIT}${f?"."+f:""}`;
}
function fmt(n:bigint):string {
  const negative=n<0n,a=negative?-n:n;
  const f=(a%UNIT).toString().padStart(18,"0").slice(0,6).replace(/0+$/,"");
  return `${negative?"-":""}${a/UNIT}${f?"."+f:""}`;
}
function calc(side:Side, margin:string, leverage:string, entry:string, mark:string) {
  const m=parse(margin),ep=parse(entry),mp=parse(mark),lev=Number(leverage);
  if(m<UNIT||m>1000n*UNIT||ep===0n||mp===0n||!Number.isInteger(lev)||lev<1||lev>3) throw Error("Margin 1–1000; leverage 1–3; prices positive");
  const n=m*BigInt(lev);
  const raw=n*(mp-ep)/ep*(side==="long"?1n:-1n);
  const pnl=raw>m?m:raw< -m?-m:raw;
  const equity=m+pnl, maintenance=n*500n/BPS, fee=n*10n/BPS;
  return {notional:n,pnl,equity,maintenance,fee,liquidatable:equity<=maintenance};
}
const inp={padding:11,borderRadius:9,border:"1px solid #51647c",background:"#1a293e",color:"white",width:"100%"} as const;
const btn={background:"#243d5d",color:"white",border:"1px solid #4b6482",borderRadius:9,padding:"10px 16px",cursor:"pointer"} as const;
export default function PerpsLab() {
 const [side,setSide]=useState<Side>("long"),[margin,setMargin]=useState("10"),[lev,setLev]=useState("2"),[entry,setEntry]=useState("100000"),[mark,setMark]=useState("105000");
 const [position,setPosition]=useState<DemoPosition|null>(null),[history,setHistory]=useState<string[]>([]),[nextId,setNextId]=useState(1);
 const [message,setMessage]=useState("Positions live only in this browser tab. Refresh clears all demo state.");
 const quote=useMemo(()=>{try{return {value:calc(side,margin,lev,entry,mark),error:""}}catch(e){return {value:null,error:e instanceof Error?e.message:"Invalid input"}}},[side,margin,lev,entry,mark]);
 const active=useMemo(()=>{if(!position)return null;try{return {value:calc(position.side,position.margin,position.leverage,position.entry,mark),error:""}}catch(e){return {value:null,error:e instanceof Error?e.message:"Invalid input"}}},[position,mark]);
 const open=()=>{if(!quote.value||position)return;setPosition({id:nextId,side,margin,leverage:lev,entry});setNextId(n=>n+1);setMessage("Opened simulated position #"+nextId+" — NO transaction sent.")};
 const close=()=>{if(!position||!active?.value)return;setHistory(h=>[`#${position.id} ${position.side.toUpperCase()} | demo PnL ${fmt(active.value!.pnl)} | close mark ${mark}`,...h].slice(0,25));setMessage("Closed simulated position #"+position.id+" — NO settlement or payout.");setPosition(null)};
 const add=()=>{if(!position)return;try{const v=parse(margin)+parse(position.margin);if(v>1000n*UNIT)throw Error("Max demo margin 1000");setPosition({...position,margin:fmtFull(v)});setMessage("Increased demo margin; no token moved.")}catch(e){setMessage(e instanceof Error?e.message:"Invalid margin")}};
 const val=(v:bigint|undefined)=>v===undefined?"—":fmt(v);
 return <main style={{maxWidth:1100,margin:"32px auto",padding:26,borderRadius:18,background:"#0a1424",color:"#e5eefb",fontFamily:"system-ui",minHeight:"80vh"}}>
 <div style={{color:"#ffab69",letterSpacing:2,fontSize:12,fontWeight:800}}>RETIUM PERPS · v0.5 DEV SANDBOX</div>
 <h1>Trading & Position Lab</h1><p role="status" style={{background:"#432913",border:"1px solid #9a652c",padding:14,borderRadius:9}}>SIMULATION ONLY. Manual prices, ephemeral demo positions. No trusted oracle, blockchain transaction, custody, real liquidation or RTD payout.</p>
 <div style={{display:"flex",gap:14,flexWrap:"wrap",alignItems:"center"}}><label>Side <select style={{...inp,width:110,marginLeft:8}} value={side} onChange={e=>setSide(e.target.value as Side)}><option value="long">Long</option><option value="short">Short</option></select></label><span>Policy: 1–3x leverage · maintenance 5% · demo fee 0.1% · capped PnL</span></div>
 <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginTop:20}}>{([{label:"Demo margin",value:margin,set:setMargin},{label:"Leverage",value:lev,set:setLev},{label:"Entry price (manual)",value:entry,set:setEntry},{label:"Mark price (manual)",value:mark,set:setMark}]).map(f=><label key={f.label} style={{display:"grid",gap:6,fontSize:13}}>{f.label}<input style={inp} value={f.value} onChange={e=>f.set(e.target.value)}/></label>)}</div>
 {quote.error&&<p role="alert" style={{color:"#ffaaaa"}}>{quote.error}</p>}
 <h2>Order preview</h2><div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>{([["Notional",val(quote.value?.notional)],["PnL",val(quote.value?.pnl)],["Equity",val(quote.value?.equity)],["Maintenance",val(quote.value?.maintenance)],["Open fee",val(quote.value?.fee)],["Liquidation",quote.value?(quote.value.liquidatable?"BREACHED":"Not breached"):"—"]]).map(([a,b])=><div key={a} style={{background:"#1b2a3e",borderRadius:10,padding:14}}><small style={{color:"#a9bad0"}}>{a}</small><div style={{fontSize:19,fontWeight:700,marginTop:5}}>{b}</div></div>)}</div>
 <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:20}}><button style={btn} disabled={!quote.value||!!position} onClick={open}>Open DEMO position</button><button style={btn} disabled={!position} onClick={add}>Add DEMO margin</button><button style={btn} disabled={!position||!active?.value} onClick={close}>Close DEMO position</button></div><p role="status" style={{color:"#a9c5ed"}}>{message}</p>
 <h2>Active demo position</h2>{position?<div style={{background:"#16263b",borderRadius:12,padding:16}}><strong>#{position.id} {position.side.toUpperCase()}</strong><p>Margin {position.margin} · leverage {position.leverage}x · entry {position.entry}</p><p>Mark-to-market PnL: {val(active?.value?.pnl)} · Equity: {val(active?.value?.equity)} · Liquidatable: {active?.value?.liquidatable?"Yes (display only)":"No"}</p></div>:<p>No active simulated position.</p>}
 <h2>Session history</h2>{history.length?<ul>{history.map((h,i)=><li key={i}>{h}</li>)}</ul>:<p>No closed positions in this tab.</p>}
 <h2>Release gates</h2><ol><li>Rust Risk Core and Oracle Guard: local unit tests; independent cross-language parity still required.</li><li>Retium WASM: build and format checks; chain dry-run and state transition tests still required.</li><li>Authenticated oracle publisher/quorum: not implemented.</li><li>Settlement Vault, liquidation keeper and RTD transfers: NOT IMPLEMENTED. Old Custody remains untouched.</li></ol>
 </main>;
}
