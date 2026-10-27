import test from 'node:test';
import assert from 'node:assert/strict';
import {UNIT as U, parseAmount, formatAmount, initialState, openPosition, updateQuote, settle, addMargin, preview, ledgerTotal, assertFresh} from '../src/lib/engine.ts';
const now=1000000;
const quote=(s,p,t=now+1)=>updateQuote(s,{price:BigInt(p)*U,at:t,sequence:s.quote.sequence+1},t);
test('strict amounts preserve 18 decimals; no negative, exponent, zero, overflow or separators',()=>{
 assert.equal(parseAmount('1.000000000000000001'),U+1n);
 for(const s of ['0','-1','1e3','NaN','01','1,000','1.0000000000000000001','10000000000'])assert.throws(()=>parseAmount(s));
 assert.equal(formatAmount(-U-1n,18),'-1.000000000000000001');
});
test('Long and Short have opposite PnL, fees are accounted and collateral is not double-counted',()=>{
 for(const side of ['long','short']){
 let s=initialState(now);const total=ledgerTotal(s);
 s=openPosition(s,side,100n*U,2,now);assert.equal(s.wallet,8998n*U/10n);assert.equal(ledgerTotal(s),total);
 s=quote(s,110000);assert.equal(preview(s.position,s.quote.price).pnl,(side==='long'?20n:-20n)*U);
 s=settle(s,1,false,now+1);assert.equal(ledgerTotal(s),total);assert.equal(s.position,null);assert.equal(s.trades[0].fee,4n*U/10n);
 assert.throws(()=>settle(s,1,false,now+1),/POSITION_NOT_OPEN/);
 }
});
test('freshness, future timestamps and replayed oracle sequence reject',()=>{
 const s=initialState(now);
 assert.throws(()=>openPosition(s,'long',U,2,now+30001),/STALE_PRICE/);
 assert.throws(()=>assertFresh({...s.quote,at:now+1},now),/FUTURE_PRICE/);
 assert.throws(()=>updateQuote(s,{...s.quote},now),/REPLAYED_PRICE/);
 assert.throws(()=>updateQuote(s,{...s.quote,at:now-1,sequence:2},now),/REPLAYED_PRICE/);
});
test('safe operations reject invalid leverage, side, insufficient wallet and pool',()=>{
 const s=initialState(now);
 assert.throws(()=>openPosition(s,'long',U,4,now),/INVALID_LEVERAGE/);
 assert.throws(()=>openPosition(s,'other',U,2,now),/INVALID_SIDE/);
 assert.throws(()=>openPosition(s,'long',1000n*U,3,now),/INSUFFICIENT_DEMO_BALANCE/);
 assert.throws(()=>openPosition({...s,pool:0n},'long',U,1,now),/INSUFFICIENT_POOL_RESERVE/);
 const p=openPosition(s,'long',U,1,now);assert.throws(()=>openPosition(p,'short',U,1,now),/POSITION_EXISTS/);
});
test('margin addition does not enlarge notional or profit entitlement',()=>{
 let s=openPosition(initialState(now),'long',100n*U,3,now);const total=ledgerTotal(s);
 s=addMargin(s,10n*U);assert.equal(s.position.margin,110n*U);assert.equal(s.position.profitCap,100n*U);assert.equal(s.position.notional,300n*U);assert.equal(ledgerTotal(s),total);
});
test('liquidation threshold exact boundary, residual returned and reward conserved',()=>{
 let s=openPosition(initialState(now),'long',100n*U,2,now);const total=ledgerTotal(s);
 assert.throws(()=>settle(s,1,true,now),/NOT_LIQUIDATABLE/);
 s=quote(s,55000);assert.equal(preview(s.position,s.quote.price).equity,10n*U);
 assert.throws(()=>settle(s,1,false,now+1),/LIQUIDATION_REQUIRED/);
 s=settle(s,1,true,now+1);assert.equal(s.keeper,U);assert.equal(s.trades[0].returned,88n*U/10n);assert.equal(ledgerTotal(s),total);
});
test('price gap through bankruptcy cannot create negative balance; profit cap prevents pool insolvency',()=>{
 for(const side of ['long','short'])for(const price of [1n,50000n,100000n,150000n,1000000000n]){
 let s=openPosition(initialState(now),side,100n*U,3,now);const total=ledgerTotal(s);
 s=quote(s,price);const v=preview(s.position,s.quote.price);
 assert.ok(v.pnl>=-100n*U&&v.pnl<=100n*U);
 s=settle(s,1,v.liquidatable,now+1);assert.ok(s.wallet>=0n&&s.pool>=0n&&s.keeper>=0n);assert.equal(ledgerTotal(s),total);
 }
});
test('1000 deterministic scenario sequences preserve the complete ledger',()=>{
 let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let i=0;i<1000;i++){
 let s=initialState(now);const before=JSON.stringify(s,(_,v)=>typeof v==='bigint'?v.toString():v);
 const margin=BigInt(1+random()%200)*U, side=random()%2?'long':'short', lev=1+random()%3;
 const opened=openPosition(s,side,margin,lev,now);assert.equal(JSON.stringify(s,(_,v)=>typeof v==='bigint'?v.toString():v),before);
 s=quote(opened,BigInt(1000+random()%500000));
 s=settle(s,1,preview(s.position,s.quote.price).liquidatable,now+1);
 assert.equal(ledgerTotal(s),101000n*U);
 }
});
