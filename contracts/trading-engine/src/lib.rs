#![cfg_attr(target_arch = "wasm32", no_std)]
//! Retium Perps v0.3.0: deterministic, test-only Rust risk core.
//! IMPORTANT: This crate cannot sign, deploy, transfer, lock custody assets, or settle positions.
//! Amounts and prices use 18-decimal fixed point and checked i128 math.

pub const UNIT: i128 = 1_000_000_000_000_000_000;
pub const BPS: i128 = 10_000;
pub const FEE_BPS: i128 = 10;
pub const MAINTENANCE_BPS: i128 = 500;
pub const MAX_QUOTE_AGE_MS: u64 = 30_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Side { Long, Short }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RiskError {
    InvalidAmount, InvalidPrice, InvalidLeverage, InvalidTime,
    StalePrice, ReplayedPrice, Overflow,
}

pub type RiskResult<T> = Result<T, RiskError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub price: i128,
    pub at_ms: u64,
    pub sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Position {
    pub side: Side,
    pub margin: i128,
    pub notional: i128,
    pub entry: i128,
    pub profit_cap: i128,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Preview {
    pub raw_pnl: i128,
    pub pnl: i128,
    pub equity: i128,
    pub maintenance: i128,
    pub liquidatable: bool,
    pub profit_capped: bool,
}

fn gcd(mut a: u128, mut b: u128) -> u128 {
    while b != 0 { let r = a % b; a = b; b = r; }
    a
}

fn mul_div(a: i128, b: i128, denominator: i128) -> RiskResult<i128> {
    if denominator == 0 { return Err(RiskError::InvalidAmount); }
    // Reduce factors before multiplying. This handles ordinary 18-decimal
    // notionals/prices that would overflow a naive i128 a*b/denominator.
    let negative = (a < 0) ^ (b < 0) ^ (denominator < 0);
    let mut x = a.unsigned_abs();
    let mut y = b.unsigned_abs();
    let mut d = denominator.unsigned_abs();
    let g1 = gcd(x, d); x /= g1; d /= g1;
    let g2 = gcd(y, d); y /= g2; d /= g2;
    let product = x.checked_mul(y).ok_or(RiskError::Overflow)?;
    let magnitude = product / d;
    if negative {
        if magnitude > (i128::MAX as u128) + 1 { return Err(RiskError::Overflow); }
        if magnitude == (i128::MAX as u128) + 1 { Ok(i128::MIN) }
        else { Ok(-(magnitude as i128)) }
    } else {
        if magnitude > i128::MAX as u128 { return Err(RiskError::Overflow); }
        Ok(magnitude as i128)
    }
}

pub fn assert_fresh(q: &Quote, now_ms: u64) -> RiskResult<()> {
    if q.price <= 0 || q.sequence == 0 { return Err(RiskError::InvalidPrice); }
    if q.at_ms > now_ms { return Err(RiskError::InvalidTime); }
    if now_ms - q.at_ms > MAX_QUOTE_AGE_MS { return Err(RiskError::StalePrice); }
    Ok(())
}

pub fn check_next_quote(previous: &Quote, next: &Quote, now_ms: u64) -> RiskResult<()> {
    assert_fresh(next, now_ms)?;
    if next.sequence <= previous.sequence || next.at_ms < previous.at_ms {
        return Err(RiskError::ReplayedPrice);
    }
    Ok(())
}

pub fn make_position(side: Side, margin: i128, leverage: u8, entry: i128) -> RiskResult<(Position, i128)> {
    // Preserve current TS sandbox rule: leverage 1..=3, margin 1..=1000 RTD.
    if !(1..=3).contains(&leverage) { return Err(RiskError::InvalidLeverage); }
    if margin < UNIT || margin > 1000 * UNIT { return Err(RiskError::InvalidAmount); }
    if entry <= 0 { return Err(RiskError::InvalidPrice); }
    let notional = margin.checked_mul(i128::from(leverage)).ok_or(RiskError::Overflow)?;
    let open_fee = mul_div(notional, FEE_BPS, BPS)?;
    Ok((Position { side, margin, notional, entry, profit_cap: margin }, open_fee))
}

pub fn preview(position: &Position, current_price: i128) -> RiskResult<Preview> {
    if current_price <= 0 || position.entry <= 0 { return Err(RiskError::InvalidPrice); }
    if position.margin <= 0 || position.notional <= 0 || position.profit_cap < 0 {
        return Err(RiskError::InvalidAmount);
    }
    let delta = current_price.checked_sub(position.entry).ok_or(RiskError::Overflow)?;
    let direction = match position.side { Side::Long => 1, Side::Short => -1 };
    let raw_pnl = mul_div(position.notional, delta, position.entry)?
        .checked_mul(direction).ok_or(RiskError::Overflow)?;
    let loss_limit = position.margin.checked_neg().ok_or(RiskError::Overflow)?;
    let pnl = raw_pnl.clamp(loss_limit, position.profit_cap);
    let equity = position.margin.checked_add(pnl).ok_or(RiskError::Overflow)?;
    let maintenance = mul_div(position.notional, MAINTENANCE_BPS, BPS)?;
    Ok(Preview {
        raw_pnl, pnl, equity, maintenance,
        liquidatable: equity <= maintenance,
        profit_capped: raw_pnl > position.profit_cap,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const ENTRY: i128 = 100_000 * UNIT;

    #[test]
    fn long_gain_and_short_loss() {
        let (long, fee) = make_position(Side::Long, 10 * UNIT, 3, ENTRY).unwrap();
        assert_eq!(fee, 30 * UNIT / 1000);
        let p = preview(&long, 110_000 * UNIT).unwrap();
        assert_eq!(p.pnl, 3 * UNIT);
        let (short, _) = make_position(Side::Short, 10 * UNIT, 3, ENTRY).unwrap();
        assert_eq!(preview(&short, 110_000 * UNIT).unwrap().pnl, -3 * UNIT);
    }

    #[test]
    fn cap_profit_and_max_loss() {
        let (pos, _) = make_position(Side::Long, 10 * UNIT, 3, ENTRY).unwrap();
        let winner = preview(&pos, 200_000 * UNIT).unwrap();
        assert_eq!(winner.pnl, 10 * UNIT);
        assert!(winner.profit_capped);
        let loser = preview(&pos, 1).unwrap();
        assert_eq!(loser.pnl, -10 * UNIT);
        assert!(loser.liquidatable);
    }

    #[test]
    fn reject_stale_and_replayed_quote() {
        let old = Quote { price: ENTRY, at_ms: 1000, sequence: 5 };
        let stale = Quote { price: ENTRY, at_ms: 1000, sequence: 6 };
        assert_eq!(assert_fresh(&stale, 31_001), Err(RiskError::StalePrice));
        assert_eq!(check_next_quote(&old, &old, 1000), Err(RiskError::ReplayedPrice));
    }

    #[test]
    fn no_float_or_unchecked_large_notional() {
        assert_eq!(make_position(Side::Long, UNIT, 4, ENTRY), Err(RiskError::InvalidLeverage));
        let invalid = Position { side: Side::Long, margin: i128::MAX, notional: i128::MAX, entry: 1, profit_cap: 1 };
        assert_eq!(preview(&invalid, i128::MAX), Err(RiskError::Overflow));
    }
}
