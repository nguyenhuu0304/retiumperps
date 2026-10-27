// SANDBOX ONLY. No network, keys, signatures, database or contract adapter.
// BigInt fixed-point arithmetic; integer divisions truncate toward zero.
export const UNIT = 10n ** 18n;
export const BPS = 10000n;
export const FEE_BPS = 10n;
export const MAINTENANCE_BPS = 500n;
export const MAX_AGE_MS = 30000;
const MAX_AMOUNT = 10n ** 27n;
export type Side = 'long' | 'short';
export type Quote = { price: bigint; at: number; sequence: number };
export type Position = { id: number; side: Side; margin: bigint; notional: bigint; entry: bigint; profitCap: bigint; openedAt: number; openFee: bigint };
export type Trade = { id: number; side: Side; entry: bigint; exit: bigint; pnl: bigint; fee: bigint; reward: bigint; returned: bigint; status: 'closed' | 'liquidated' };
export type State = { wallet: bigint; pool: bigint; keeper: bigint; position: Position | null; trades: Trade[]; nextId: number; quote: Quote };
export class SandboxError extends Error {}
function check(ok: boolean, reason: string): asserts ok { if (!ok) throw new SandboxError(reason); }
export function parseAmount(raw: string): bigint {
  check(/^(0|[1-9]\d{0,9})(\.\d{1,18})?$/.test(raw), 'INVALID_AMOUNT');
  const [whole, fraction = ''] = raw.split('.');
  const amount = BigInt(whole) * UNIT + BigInt(fraction.padEnd(18, '0'));
  check(amount > 0n && amount <= MAX_AMOUNT, 'AMOUNT_OUT_OF_RANGE');
  return amount;
}
export function formatAmount(value: bigint, digits = 4): string {
  const negative = value < 0n; const abs = negative ? -value : value;
  const fraction = (abs % UNIT).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
  return `${negative ? '-' : ''}${abs / UNIT}${fraction ? '.' + fraction : ''}`;
}
export function initialState(now: number): State {
  return { wallet: 1000n * UNIT, pool: 100000n * UNIT, keeper: 0n, position: null, trades: [], nextId: 1,
    quote: { price: 100000n * UNIT, at: now, sequence: 1 } };
}
export function assertFresh(q: Quote, now: number) {
  check(Number.isSafeInteger(now) && Number.isSafeInteger(q.at) && Number.isSafeInteger(q.sequence) && q.sequence > 0, 'INVALID_TIME');
  check(q.price > 0n && q.price <= MAX_AMOUNT, 'INVALID_PRICE');
  check(q.at <= now, 'FUTURE_PRICE');
  check(now - q.at <= MAX_AGE_MS, 'STALE_PRICE');
}
export function updateQuote(s: State, q: Quote, now: number): State {
  assertFresh(q, now);
  check(q.sequence > s.quote.sequence && q.at >= s.quote.at, 'REPLAYED_PRICE');
  return { ...s, quote: { ...q } };
}
export function preview(p: Position, price: bigint) {
  check(price > 0n && price <= MAX_AMOUNT, 'INVALID_PRICE');
  const rawPnl = p.notional * (price - p.entry) / p.entry * (p.side === 'long' ? 1n : -1n);
  const pnl = rawPnl > p.profitCap ? p.profitCap : rawPnl < -p.margin ? -p.margin : rawPnl;
  const equity = p.margin + pnl;
  const maintenance = p.notional * MAINTENANCE_BPS / BPS;
  return { rawPnl, pnl, equity, maintenance, liquidatable: equity <= maintenance, capped: rawPnl > p.profitCap };
}
export function openPosition(s: State, side: Side, margin: bigint, leverage: number, now: number): State {
  assertFresh(s.quote, now);
  check(!s.position, 'POSITION_EXISTS');
  check(side === 'long' || side === 'short', 'INVALID_SIDE');
  check(Number.isInteger(leverage) && leverage >= 1 && leverage <= 3, 'INVALID_LEVERAGE');
  check(margin >= UNIT && margin <= 1000n * UNIT, 'MARGIN_LIMIT');
  const notional = margin * BigInt(leverage), fee = notional * FEE_BPS / BPS;
  check(s.wallet >= margin + fee, 'INSUFFICIENT_DEMO_BALANCE');
  // Maximum additional liability is one original margin, reserved from pool.
  check(s.pool >= margin, 'INSUFFICIENT_POOL_RESERVE');
  return { ...s, wallet: s.wallet - margin - fee, pool: s.pool + fee, nextId: s.nextId + 1,
    position: { id: s.nextId, side, margin, notional, entry: s.quote.price, profitCap: margin, openedAt: now, openFee: fee } };
}
export function addMargin(s: State, amount: bigint): State {
  check(!!s.position, 'NO_POSITION');
  check(amount > 0n && amount <= MAX_AMOUNT && amount <= s.wallet, 'INSUFFICIENT_DEMO_BALANCE');
  check(s.position.margin + amount <= 1000n * UNIT, 'MARGIN_LIMIT');
  // Adding collateral never increases the fixed entry notional or profit cap.
  return { ...s, wallet: s.wallet - amount, position: { ...s.position, margin: s.position.margin + amount } };
}
export function settle(s: State, id: number, liquidate: boolean, now: number): State {
  assertFresh(s.quote, now);
  const p = s.position;
  check(!!p && p.id === id, 'POSITION_NOT_OPEN');
  const v = preview(p, s.quote.price);
  check(!liquidate || v.liquidatable, 'NOT_LIQUIDATABLE');
  check(liquidate || !v.liquidatable, 'LIQUIDATION_REQUIRED');
  const fee = v.equity < p.notional * FEE_BPS / BPS ? v.equity : p.notional * FEE_BPS / BPS;
  const remaining = v.equity - fee;
  const reward = liquidate ? (remaining < p.margin / 100n ? remaining : p.margin / 100n) : 0n;
  const returned = remaining - reward;
  const pool = s.pool + p.margin - v.equity + fee;
  check(pool >= 0n, 'POOL_INSOLVENT');
  return { ...s, wallet: s.wallet + returned, pool, keeper: s.keeper + reward, position: null,
    trades: [{ id: p.id, side: p.side, entry: p.entry, exit: s.quote.price, pnl: v.pnl, fee: p.openFee + fee, reward, returned, status: liquidate ? 'liquidated' as const : 'closed' as const }, ...s.trades].slice(0, 50) };
}
export function ledgerTotal(s: State) { return s.wallet + s.pool + s.keeper + (s.position?.margin ?? 0n); }
