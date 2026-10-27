#![cfg_attr(target_arch = "wasm32", no_std)]
//! Deterministic policy library ONLY. No authenticating source signatures,
//! no external fetch, no blockchain state or settlement. Never treat a quote
//! that passes this guard as a trusted price without an authenticated feed.

pub const MAX_AGE_MS: u64 = 30_000;
pub const MAX_FUTURE_SKEW_MS: u64 = 1_000;
pub const MAX_DEVIATION_BPS: u128 = 200; // 2%, illustrative guard
pub const BPS: u128 = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quote {
    pub price_atomic: u128,
    pub published_at_ms: u64,
    pub sequence: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuoteError {
    InvalidPrice,
    InvalidSequence,
    Stale,
    TooFarInFuture,
    Replayed,
    ExcessiveDeviation,
    ArithmeticOverflow,
    NoQuorum,
}

pub fn check_quote(
    candidate: Quote,
    previous: Option<Quote>,
    now_ms: u64,
) -> Result<(), QuoteError> {
    if candidate.price_atomic == 0 { return Err(QuoteError::InvalidPrice) }
    if candidate.sequence == 0 { return Err(QuoteError::InvalidSequence) }
    if candidate.published_at_ms > now_ms.saturating_add(MAX_FUTURE_SKEW_MS) {
        return Err(QuoteError::TooFarInFuture)
    }
    if now_ms.saturating_sub(candidate.published_at_ms) > MAX_AGE_MS {
        return Err(QuoteError::Stale)
    }
    if let Some(p) = previous {
        if candidate.sequence <= p.sequence || candidate.published_at_ms < p.published_at_ms {
            return Err(QuoteError::Replayed)
        }
        if p.price_atomic == 0 { return Err(QuoteError::InvalidPrice) }
        let delta = candidate.price_atomic.abs_diff(p.price_atomic);
        // Compare without multiplication overflow: bound magnitude first.
        let scaled = delta.checked_mul(BPS).ok_or(QuoteError::ArithmeticOverflow)?;
        let bound = p.price_atomic.checked_mul(MAX_DEVIATION_BPS).ok_or(QuoteError::ArithmeticOverflow)?;
        if scaled > bound { return Err(QuoteError::ExcessiveDeviation) }
    }
    Ok(())
}

/// Returns median of three caller-provided samples. Quorum requirement is
/// purely numerical; these three values are NOT verified independent signers.
pub fn median_three(samples: [u128; 3]) -> Result<u128, QuoteError> {
    if samples.iter().any(|&x| x == 0) { return Err(QuoteError::NoQuorum) }
    let mut s = samples;
    s.sort_unstable();
    Ok(s[1])
}

#[cfg(test)]
mod tests {
    use super::*;
    const P: Quote = Quote { price_atomic: 100_000_000, published_at_ms: 100_000, sequence: 10 };
    #[test] fn accepts_fresh_incremental() {
        assert_eq!(check_quote(Quote {price_atomic: 101_000_000, published_at_ms: 101_000, sequence: 11}, Some(P), 101_000), Ok(()));
    }
    #[test] fn rejects_replay() {
        assert_eq!(check_quote(P, Some(P), 101_000), Err(QuoteError::Replayed));
    }
    #[test] fn rejects_stale() {
        assert_eq!(check_quote(P, None, 131_000), Err(QuoteError::Stale));
    }
    #[test] fn rejects_future() {
        assert_eq!(check_quote(Quote {published_at_ms: 102_002, ..P}, None, 101_000), Err(QuoteError::TooFarInFuture));
    }
    #[test] fn rejects_jump() {
        let q = Quote {price_atomic: 103_000_000, published_at_ms: 101_000, sequence: 11};
        assert_eq!(check_quote(q, Some(P), 101_000), Err(QuoteError::ExcessiveDeviation));
    }
    #[test] fn accepts_exact_boundary() {
        let q = Quote {price_atomic: 102_000_000, published_at_ms: 101_000, sequence: 11};
        assert_eq!(check_quote(q, Some(P), 101_000), Ok(()));
    }
    #[test] fn median_is_order_independent() {
        assert_eq!(median_three([110,90,100]), Ok(100));
    }
    #[test] fn invalid_inputs() {
        assert_eq!(check_quote(Quote{price_atomic:0,..P}, None, 100_000), Err(QuoteError::InvalidPrice));
        assert_eq!(median_three([0,12,13]), Err(QuoteError::NoQuorum));
    }
    #[test] fn overflowing_comparison_fails_closed() {
        let previous = Quote {price_atomic: u128::MAX/2, ..P};
        let next = Quote {price_atomic: u128::MAX, published_at_ms: 101_000, sequence: 11};
        assert_eq!(check_quote(next, Some(previous), 101_000), Err(QuoteError::ArithmeticOverflow));
    }
}
