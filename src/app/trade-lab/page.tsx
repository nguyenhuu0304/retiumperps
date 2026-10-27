"use client";
import { useMemo, useState } from "react";

/** Simulation only. Never connects to wallet/Custody or sends a transaction. */
const UNIT = 10n ** 18n;
type Side = "long" | "short";
function parseUnits(s: string): bigint {
  if (!/^(0|[1-9]\d{0,9})(\.\d{1,18})?$/.test(s)) throw Error("Invalid decimal input");
  const [whole, fractional = ""] = s.split(".");
  return BigInt(whole) * UNIT + BigInt(fractional.padEnd(18, "0"));
}
function formatUnits(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const fraction = (abs % UNIT).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return sign + (abs / UNIT).toString() + (fraction ? "." + fraction : "");
}
export default function TradeLab() {
  const [side, setSide] = useState<Side>("long");
  const [margin, setMargin] = useState("10");
  const [leverage, setLeverage] = useState("2");
  const [entry, setEntry] = useState("100000");
  const [mark, setMark] = useState("105000");
  const output = useMemo(() => {
    try {
      const m = parseUnits(margin), e = parseUnits(entry), p = parseUnits(mark);
      const lev = Number(leverage);
      if (m < UNIT || m > 1000n * UNIT || e <= 0n || p <= 0n || !Number.isInteger(lev) || lev < 1 || lev > 3) throw Error("Margin must be 1–1000, leverage 1–3x; prices positive");
      const notional = m * BigInt(lev);
      const signed = notional * (p - e) / e * (side === "long" ? 1n : -1n);
      const pnl = signed > m ? m : signed < -m ? -m : signed;
      const equity = m + pnl;
      const maintenance = notional * 500n / 10000n;
      const fee = notional * 10n / 10000n;
      return { pnl: formatUnits(pnl), equity: formatUnits(equity), maintenance: formatUnits(maintenance), openFee: formatUnits(fee), liquidatable: equity <= maintenance, error: "" };
    } catch (err) { return { pnl: "—", equity: "—", maintenance: "—", openFee: "—", liquidatable: false, error: err instanceof Error ? err.message : "Invalid input" }; }
  }, [side, margin, leverage, entry, mark]);
  const fields = [{label:"Demo margin",value:margin,set:setMargin},{label:"Leverage (1–3)",value:leverage,set:setLeverage},{label:"Entry price",value:entry,set:setEntry},{label:"Mark price",value:mark,set:setMark}];
  return <main style={{maxWidth:760,margin:"48px auto",padding:24,fontFamily:"system-ui, sans-serif",lineHeight:1.6}}>
    <h1>Retium Perps · Trade Lab</h1>
    <p style={{background:"#fff1c5",color:"#513900",padding:14,borderRadius:10}}><strong>SIMULATION ONLY.</strong> No wallet connection, blockchain write, RTD deposit, liquidation execution or payouts. Prices are entered manually.</p>
    <label>Side <select value={side} onChange={e=>setSide(e.target.value as Side)} style={{marginLeft:12,padding:8}}><option value="long">Long</option><option value="short">Short</option></select></label>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:16,marginTop:18}}>{fields.map(f=><label key={f.label} style={{display:"grid",gap:4}}>{f.label}<input style={{padding:10,border:"1px solid #aaa",borderRadius:8}} value={f.value} inputMode="decimal" onChange={e=>f.set(e.target.value)} /></label>)}</div>
    {output.error && <p role="alert" style={{color:"#bc2929"}}>{output.error}</p>}
    <section style={{marginTop:24,padding:18,border:"1px solid #ccc",borderRadius:12}}><h2>Risk preview (demo units)</h2><p>PnL: <b>{output.pnl}</b></p><p>Equity: <b>{output.equity}</b></p><p>Maintenance: <b>{output.maintenance}</b></p><p>Opening fee: <b>{output.openFee}</b></p><p>Liquidation threshold breached: <b>{output.liquidatable ? "YES" : "NO"}</b></p></section>
    <p style={{fontSize:13,opacity:.75}}>This UI mirrors the Phase A fixed-point math for preview only. The Rust contract remains separate. Validate cross-language parity before using real funds.</p>
  </main>;
}
