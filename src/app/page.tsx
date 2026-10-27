'use client';
import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';
import Link from 'next/link';
import { UNIT, FEE_BPS, BPS, MAX_AGE_MS, initialState, parseAmount, formatAmount, openPosition, addMargin, settle, preview, updateQuote, type Side, type State } from '../lib/engine';
const errors: Record<string, string> = {
  INVALID_AMOUNT: 'Nhập số dương, tối đa 18 chữ số thập phân.', AMOUNT_OUT_OF_RANGE: 'Số lượng ngoài giới hạn.',
  POSITION_EXISTS: 'Đóng vị thế hiện tại trước khi mở vị thế mới.', MARGIN_LIMIT: 'Ký quỹ thử nghiệm từ 1 đến 1.000 RTD.',
  INSUFFICIENT_DEMO_BALANCE: 'Không đủ số dư mô phỏng, hãy giảm số lượng.', INSUFFICIENT_POOL_RESERVE: 'Quỹ thử nghiệm không đủ dự trữ.',
  STALE_PRICE: 'Giá kịch bản quá 30 giây. Bấm Làm mới giá rồi thử lại.', FUTURE_PRICE: 'Thời gian giá không hợp lệ.',
  NOT_LIQUIDATABLE: 'Vị thế chưa đủ điều kiện thanh lý.', LIQUIDATION_REQUIRED: 'Vị thế đã chạm mức thanh lý. Chọn Mô phỏng thanh lý.',
  POSITION_NOT_OPEN: 'Vị thế đã đóng hoặc không tồn tại.', NO_POSITION: 'Chưa có vị thế mở.', INVALID_PRICE: 'Giá phải lớn hơn 0.',
};
export default function Page() {
  const [state, setState] = useState<State>(() => initialState(Date.now()));
  const [now, setNow] = useState(() => Date.now());
  const [side, setSide] = useState<Side>('long');
  const [margin, setMargin] = useState('100');
  const [extra, setExtra] = useState('10');
  const [leverage, setLeverage] = useState(2);
  const [scenario, setScenario] = useState('100000');
  const [points, setPoints] = useState<number[]>([100000]);
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState(false);
  const [lang, setLang] = useState<'vi' | 'en'>('vi');
  const [light, setLight] = useState(false);
  const [wallet, setWallet] = useState('');
  const [connecting, setConnecting] = useState(false);
  const lock = useRef(false);
  const t = (vi: string, en: string) => lang === 'vi' ? vi : en;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const stale = now - state.quote.at > MAX_AGE_MS;
  const position = state.position;
  const mark = position ? preview(position, state.quote.price) : null;
  let parsed = 0n;
  try { parsed = parseAmount(margin); } catch { /* Invalid input is shown on review. */ }
  const notional = parsed * BigInt(leverage), fee = notional * FEE_BPS / BPS;
  const freePool = state.pool - (position?.profitCap ?? 0n);
  function run(action: (s: State) => State, message: string) {
    try { const next = action(state); setState(next); setNotice(message); setReview(false); }
    catch (e) { const code = e instanceof Error ? e.message : ''; setNotice(lang === 'vi' ? errors[code] || code : code.replaceAll('_', ' ')); setReview(false); }
  }
  function applyPrice(price: bigint) {
    try {
      const at = Date.now();
      const next = updateQuote(state, { price, at, sequence: state.quote.sequence + 1 }, at);
      setState(next); setReview(false);
      setNotice(t('Đã cập nhật giá kịch bản — không phải giá thị trường.', 'Scenario price updated — not a market feed.'));
      setScenario(formatAmount(price, 18)); setPoints(p => [...p.slice(-23), Number(price / (UNIT / 100n)) / 100]);
    } catch (e) { const c = e instanceof Error ? e.message : ''; setNotice(lang === 'vi' ? errors[c] || c : c.replaceAll('_', ' ')); }
  }
  async function connect() {
    if (lock.current) return; lock.current = true; setConnecting(true);
    try {
      const provider = (window as unknown as { retium?: { request: (i: {method: string}) => Promise<{ address: string; chainId: number }> } }).retium;
      if (!provider) throw Error(t('Ví chưa sẵn sàng. Cài extension hoặc chờ SDK tải xong.', 'Wallet not ready. Install the extension or wait for the SDK.'));
      const a = await provider.request({method: 'retium_requestAccounts'});
      if (!/^rete[0-9a-f]{68}$/.test(a.address) || Number(a.chainId) !== 3) throw Error(t('Chọn ví testnet chain 3.', 'Select testnet chain 3.'));
      setWallet(a.address); setNotice(t('Chỉ xem địa chỉ. Số dư sandbox không phải số dư ví này.', 'Address only. Sandbox balances are not this wallet’s balances.'));
    } catch (e) { setNotice(e instanceof Error ? e.message : t('Đã hủy kết nối.', 'Connection cancelled.')); }
    finally { lock.current = false; setConnecting(false); }
  }
  const low = Math.min(...points) * 0.995, high = Math.max(...points) * 1.005;
  const polyline = (points.length === 1 ? [points[0], points[0]] : points).map((p, i, a) => `${i / (a.length - 1) * 800},${185 - (p - low) / (high - low || 1) * 160}`).join(' ');
  return <div className={light ? 'app light' : 'app'}>
    <Script src="https://wallet.retium.org/connect/sdk/retium-sdk-1.3.0.js" integrity="sha384-FTG6s31+cSLKvZXfREum814s/L2AnqVyikuFQvMKIvFfAz40ksTcaXVbRmkHGGTU" crossOrigin="anonymous" strategy="afterInteractive" />
    <header><Link className="brand" href="/"><span className="brand-icon">R</span> Retium <strong>Perps</strong><small>LAB</small></Link><nav aria-label="Main"><a href="#trade">{t('Giao dịch', 'Trade')}</a><a href="#positions">{t('Vị thế', 'Positions')}</a><a href="#rules">{t('Quy tắc', 'Rules')}</a></nav><div className="header-actions"><button onClick={() => setLang(v => v === 'vi' ? 'en' : 'vi')}>{lang.toUpperCase()}</button><button aria-label="Toggle theme" onClick={() => setLight(v => !v)}>{light ? '☾' : '☀'}</button><button className="wallet" disabled={connecting} onClick={() => wallet ? setWallet('') : void connect()} title={wallet || undefined}>{connecting ? '…' : wallet ? `${wallet.slice(0, 8)}…${wallet.slice(-5)} ×` : t('Kết nối ví · chỉ đọc', 'Connect wallet · read only')}</button></div></header>
    <main id="trade"><div className="intro"><div><p className="eyebrow">INDEPENDENT RESEARCH · V0.1</p><h1>{t('Một nơi để thử chiến lược.', 'A place to test your thesis.')}</h1><p>{t('Long. Short. Hiểu rủi ro trước khi giao dịch.', 'Long. Short. Understand the risk before the trade.')}</p></div><span className="sandbox-dot">SANDBOX ONLY</span></div>
    <div className="warning"><span>◈</span><div><strong>{t('Tiền mô phỏng. Giá thủ công. Không gửi giao dịch.', 'Simulated funds. Manual prices. No transactions.')}</strong><p>{t('Không có BTC hay RTD thật được chuyển. Mô phỏng mất khi tải lại trang.', 'No actual BTC or RTD moves. Reloading resets the simulation.')}</p></div><button onClick={() => { setState(initialState(Date.now())); setPoints([100000]); setScenario('100000'); setReview(false); setNotice(t('Đã đặt lại sandbox.', 'Sandbox reset.')); }}>{t('Đặt lại', 'Reset')}</button></div>
    <section className="stats" aria-label="Sandbox account"><div><span>{t('Số dư thử nghiệm', 'Demo balance')}</span><strong>{formatAmount(state.wallet, 4)} <small>RTD</small></strong></div><div><span>{t('Ký quỹ vị thế', 'Position margin')}</span><strong>{formatAmount(position?.margin ?? 0n)} <small>RTD</small></strong></div><div><span>{t('PnL mô phỏng', 'Simulated PnL')}</span><strong className={(mark?.pnl ?? 0n) < 0n ? 'negative' : 'positive'}>{formatAmount(mark?.pnl ?? 0n)} <small>RTD</small></strong></div><div><span>{t('Quỹ còn khả dụng', 'Available sandbox pool')}</span><strong>{formatAmount(freePool, 2)} <small>RTD</small></strong></div></section>
    <div className="workspace"><section className="market card"><div className="market-head"><div className="pair"><span className="bitcoin">₿</span><div><h2>BTC / USD</h2><span>{t('Hợp đồng mô phỏng · ký quỹ RTD', 'Simulated contract · RTD margin')}</span></div></div><div className="price"><strong>${formatAmount(state.quote.price, 2)}</strong><span className={stale ? 'negative' : 'positive'}>{stale ? t('Giá quá cũ', 'Stale scenario') : t('Giá kịch bản', 'Scenario price')}</span></div></div>
      <div className="chart-top"><span>{t('Đường giá bạn tự mô phỏng', 'Your scenario path')}</span><span>MANUAL · USD</span></div><svg className="chart" viewBox="0 0 800 215" role="img" aria-label={t('Đồ thị giá kịch bản thủ công, không phải lịch sử BTC', 'Manual scenario prices, not BTC history')}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff783d" stopOpacity=".24"/><stop offset="100%" stopColor="#ff783d" stopOpacity="0"/></linearGradient></defs>{[35, 85, 135, 185].map(y => <line key={y} x1="0" x2="800" y1={y} y2={y} stroke="currentColor" opacity=".1"/>)}<polygon points={`0,215 ${polyline} 800,215`} fill="url(#fill)"/><polyline points={polyline} fill="none" stroke="#ff783d" strokeWidth="3" vectorEffect="non-scaling-stroke"/></svg>
      <div className="price-controls"><label>{t('Giá thử nghiệm BTC/USD', 'BTC/USD scenario price')}<input value={scenario} onChange={e => setScenario(e.target.value)} inputMode="decimal" /></label><button onClick={() => { try { applyPrice(parseAmount(scenario)); } catch { setNotice(t('Nhập giá hợp lệ.', 'Enter a valid price.')); } }}>{t('Áp dụng giá', 'Apply price')}</button><button onClick={() => applyPrice(state.quote.price)}>{t('Làm mới giá', 'Refresh price')}</button></div><div className="shocks">{[-10, -5, 5, 10].map(n => <button key={n} onClick={() => applyPrice(state.quote.price * BigInt(100 + n) / 100n)}>{n > 0 ? '+' : ''}{n}%</button>)}<span>{t('Giá hết hạn sau 30 giây.', 'Prices expire after 30 seconds.')}</span></div>
    </section>
    <section className="order card"><div className="section-title"><h2>{t('Mở vị thế', 'Open position')}</h2><span className="tag">ISOLATED</span></div><div className="sides"><button className={side === 'long' ? 'selected long' : ''} onClick={() => { setSide('long'); setReview(false); }}>Long <small>↗</small></button><button className={side === 'short' ? 'selected short' : ''} onClick={() => { setSide('short'); setReview(false); }}>Short <small>↘</small></button></div><label>{t('Ký quỹ mô phỏng', 'Demo margin')}<div className="amount"><input value={margin} onChange={e => { setMargin(e.target.value); setReview(false); }} inputMode="decimal"/><span>RTD</span></div></label><div className="percent">{[20, 50, 75].map(n => <button key={n} onClick={() => { setMargin(formatAmount(state.wallet * BigInt(n) / 100n, 4)); setReview(false); }}>{n}%</button>)}</div><label className="leverage-label">{t('Đòn bẩy', 'Leverage')}<strong>{leverage}×</strong></label><input aria-label="Leverage" type="range" min="1" max="3" value={leverage} onChange={e => { setLeverage(Number(e.target.value)); setReview(false); }}/><div className="range-ticks"><span>1×</span><span>2×</span><span>3×</span></div><dl className="details"><div><dt>{t('Quy mô vị thế', 'Position size')}</dt><dd>{formatAmount(notional)} RTD</dd></div><div><dt>{t('Phí mở · 0,1%', 'Open fee · 0.1%')}</dt><dd>{formatAmount(fee)} RTD</dd></div><div><dt>{t('Trần lãi sandbox', 'Sandbox profit cap')}</dt><dd>+{formatAmount(parsed)} RTD</dd></div><div><dt>Funding</dt><dd>{t('Chưa mô phỏng', 'Not simulated')}</dd></div></dl><p className="cap-note">{t('Lãi tối đa bằng ký quỹ ban đầu; lỗ tối đa bằng ký quỹ. Phí tính riêng. Đây không phải Perps không giới hạn lợi nhuận.', 'Profit is capped at original margin; loss is capped at margin. Fees are separate. This is not an uncapped perpetual.')}</p>
    {review ? <div className="review"><strong>{t('Xác nhận mô phỏng', 'Confirm simulation')}</strong><p>{side.toUpperCase()} · {leverage}× · {formatAmount(parsed)} RTD</p><p>{t('Giá mở dùng giá kịch bản mới nhất lúc xác nhận.', 'Entry uses the latest scenario price at confirmation.')}</p><button className="primary" onClick={() => run(s => openPosition(s, side, parseAmount(margin), leverage, Date.now()), t('Đã mở vị thế mô phỏng.', 'Simulated position opened.'))}>{t('Mở thử nghiệm', 'Open simulated position')}</button><button onClick={() => setReview(false)}>{t('Quay lại', 'Back')}</button></div> : <button className={`primary ${side === 'short' ? 'sell' : ''}`} disabled={!!position} onClick={() => { try { openPosition(state, side, parseAmount(margin), leverage, Date.now()); setReview(true); setNotice(''); } catch(e) { const c=e instanceof Error?e.message:'';setNotice(lang==='vi'?errors[c]||c:c.replaceAll('_',' ')); } }}>{position ? t('Đã có vị thế mở', 'A position is open') : t('Kiểm tra vị thế mô phỏng', 'Review simulated position')}</button>}
    <button className="live-locked" disabled>{t('Giao dịch on-chain chưa bật', 'On-chain trading is disabled')}</button></section></div>
    {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    <section id="positions" className="card position-card"><div className="section-title"><h2>{t('Vị thế của bạn', 'Your position')}</h2><span className="tag">{position ? '1 OPEN' : '0 OPEN'}</span></div>{position && mark ? <><div className="position-grid"><div><span>BTC/USD</span><strong className={position.side === 'long' ? 'positive' : 'negative'}>{position.side.toUpperCase()}</strong></div><div><span>{t('Giá mở', 'Entry price')}</span><strong>${formatAmount(position.entry, 2)}</strong></div><div><span>{t('Ký quỹ', 'Margin')}</span><strong>{formatAmount(position.margin)} RTD</strong></div><div><span>{t('Vốn còn lại trước phí', 'Equity before fees')}</span><strong>{formatAmount(mark.equity)} RTD</strong></div><div><span>{t('Ngưỡng duy trì', 'Maintenance')}</span><strong>{formatAmount(mark.maintenance)} RTD</strong></div><div><span>{t('Trạng thái', 'Status')}</span><strong className={mark.liquidatable ? 'negative' : 'positive'}>{mark.liquidatable ? t('Có thể thanh lý', 'Liquidatable') : t('Đang mở', 'Open')}</strong></div></div><div className="position-actions"><label>{t('Thêm ký quỹ RTD', 'Add RTD margin')}<input value={extra} onChange={e => setExtra(e.target.value)} inputMode="decimal"/></label><button onClick={() => run(s => addMargin(s, parseAmount(extra)), t('Đã thêm ký quỹ mô phỏng.', 'Demo margin added.'))}>{t('Thêm ký quỹ', 'Add margin')}</button><button onClick={() => run(s => settle(s, position.id, false, Date.now()), t('Đã đóng vị thế mô phỏng.', 'Simulated position closed.'))}>{t('Đóng vị thế', 'Close position')}</button><button className="danger" onClick={() => run(s => settle(s, position.id, true, Date.now()), t('Đã mô phỏng thanh lý.', 'Liquidation simulated.'))}>{t('Mô phỏng thanh lý', 'Simulate liquidation')}</button></div>{mark.capped && <p className="negative">{t('PnL đã chạm trần lợi nhuận sandbox.', 'PnL has reached the sandbox profit cap.')}</p>}</> : <div className="empty"><span>↗ ↘</span><p>{t('Chưa có vị thế. Thử Long hoặc Short bằng số dư mô phỏng.', 'No positions yet. Try a Long or Short with demo funds.')}</p></div>}</section>
    <section className="card history"><div className="section-title"><h2>{t('Lịch sử phiên thử', 'Session history')}</h2><span>{t('50 mục gần nhất · chỉ trong bộ nhớ', 'Latest 50 · in memory only')}</span></div>{state.trades.length ? <div className="table-scroll"><table><thead><tr><th>ID</th><th>{t('Hướng', 'Side')}</th><th>PnL</th><th>{t('Tổng phí', 'Total fees')}</th><th>{t('Hoàn về ví', 'Returned')}</th><th>{t('Trạng thái', 'Status')}</th></tr></thead><tbody>{state.trades.map(tr => <tr key={tr.id}><td>#{tr.id}</td><td>{tr.side.toUpperCase()}</td><td className={tr.pnl < 0n ? 'negative' : 'positive'}>{formatAmount(tr.pnl)}</td><td>{formatAmount(tr.fee)}</td><td>{formatAmount(tr.returned)}</td><td>{tr.status}</td></tr>)}</tbody></table></div> : <p className="muted">{t('Giao dịch mô phỏng đã đóng sẽ xuất hiện ở đây.', 'Closed simulated trades will appear here.')}</p>}</section>
    <footer id="rules"><strong>Retium Perps · Research sandbox</strong><p>{t('Giá khởi đầu 100.000 USD chỉ là giả định. Phí mở/đóng 0,1% quy mô lúc mở; duy trì 5% quy mô lúc mở. Thanh lý có thưởng mô phỏng tối đa 1% ký quỹ. Không có funding, phí mạng, slippage, keeper hay oracle thật trong bản này.', 'The initial $100,000 price is hypothetical. Open/close fee: 0.1% of entry notional. Maintenance: 5% of entry notional. Simulated liquidation reward: up to 1% of margin. Funding, gas, slippage, keepers and real oracles are not implemented.')}</p><p>{t('Dự án riêng. Không đọc/ghi dữ liệu Retium Pay. Không nạp tiền thật.', 'Independent project. No access to Retium Pay data. Do not deposit real funds.')}</p></footer>
    </main></div>;
}
