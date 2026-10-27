#![cfg_attr(target_arch = "wasm32", no_std)]
extern crate alloc;

use alloc::{format, string::{String, ToString}};
use retium_contract::{entrypoint, error, ok, storage, Call, Reply};
use retium_perps_risk_core::{make_position, preview, Side};

// Phase C is a TESTNET SANDBOX, not a perpetual exchange or escrow.
// User-supplied demo prices are NOT authenticated oracle prices.
// No token transfer, no custody call, no reward or payout, and no settlement.
entrypoint!(handle);
retium_contract::rcp_metadata!(
    r#"{"rcp_type":"retium_perps_positions_sandbox","traits":["testnet","sandbox","no_oracle","no_settlement"],"capabilities":["execute"],"lockable_fields":[],"evolves_from":"","weight":5,"version":"v0.3.0-phase-c"}"#
);

const MAX_ARGS: usize = 5;
const MAX_MARGIN: i128 = 1_000_000_000_000_000_000_000; // 1000 demo units, 18 decimals
const MAX_PRICE: i128 = 100_000_000_000_000_000_000_000_000_000; // demo input bound


struct DemoPosition {
    id: u64,
    side: Side,
    margin: i128,
    leverage: u8,
    entry: i128,
}

fn parse_positive(raw: &str) -> Result<i128, &'static str> {
    let value = raw.parse::<i128>().map_err(|_| "INVALID_INTEGER")?;
    if value <= 0 { return Err("POSITIVE_REQUIRED"); }
    Ok(value)
}

fn parse_side(raw: &str) -> Result<Side, &'static str> {
    match raw { "long" => Ok(Side::Long), "short" => Ok(Side::Short), _ => Err("INVALID_SIDE") }
}

fn side_name(side: Side) -> &'static str {
    match side { Side::Long => "long", Side::Short => "short" }
}

fn validate_address(caller: &str) -> Result<(), &'static str> {
    // Match the 72-byte wallet format used by the existing Custody probe.
    if caller.len() != 72 || !caller.starts_with("rete") || !caller.as_bytes()[4..].iter().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err("WALLET_REQUIRED");
    }
    Ok(())
}

fn position_key(account: &str) -> String { format!("demo-position:{}", account) }
fn next_id_key(account: &str) -> String { format!("demo-next-id:{}", account) }

fn encode(p: &DemoPosition) -> String {
    format!("{}|{}|{}|{}|{}", p.id, side_name(p.side), p.margin, p.leverage, p.entry)
}

fn decode(raw: &str) -> Result<DemoPosition, &'static str> {
    let mut parts = raw.split('|');
    let id = parts.next().ok_or("BAD_STATE")?.parse::<u64>().map_err(|_| "BAD_STATE")?;
    let side = parse_side(parts.next().ok_or("BAD_STATE")?).map_err(|_| "BAD_STATE")?;
    let margin = parse_positive(parts.next().ok_or("BAD_STATE")?).map_err(|_| "BAD_STATE")?;
    let leverage = parts.next().ok_or("BAD_STATE")?.parse::<u8>().map_err(|_| "BAD_STATE")?;
    let entry = parse_positive(parts.next().ok_or("BAD_STATE")?).map_err(|_| "BAD_STATE")?;
    if parts.next().is_some() || id == 0 { return Err("BAD_STATE"); }
    make_position(side, margin, leverage, entry).map_err(|_| "BAD_STATE")?;
    Ok(DemoPosition { id, side, margin, leverage, entry })
}

fn validate_open(side: Side, margin: i128, leverage: u8, entry: i128) -> Result<DemoPosition, &'static str> {
    if margin > MAX_MARGIN || entry > MAX_PRICE { return Err("INPUT_LIMIT"); }
    make_position(side, margin, leverage, entry).map_err(|_| "RISK_INPUT_REJECTED")?;
    Ok(DemoPosition { id: 0, side, margin, leverage, entry })
}

fn read_position(account: &str) -> Result<Option<DemoPosition>, &'static str> {
    let stored = storage::get(&position_key(account)).map_err(|_| "STORAGE_READ_FAILED")?;
    match stored { Some(raw) if !raw.is_empty() => Ok(Some(decode(&raw)?)), _ => Ok(None) }
}

fn save_position(account: &str, p: &DemoPosition) -> Result<(), &'static str> {
    storage::set(&position_key(account), &encode(p)).map_err(|_| "STORAGE_WRITE_FAILED")
}

fn expect_args(call: &Call, n: usize) -> Result<(), &'static str> {
    if call.args().len() != n || n > MAX_ARGS { Err("BAD_ARGUMENT_COUNT") } else { Ok(()) }
}

fn inner(call: Call) -> Result<String, &'static str> {
    if call.value() != 0 { return Err("NO_ATTACHED_RTM"); }
    match call.action() {
        "info" => {
            expect_args(&call, 0)?;
            Ok("phase_c;stateful_demo_positions;no_oracle;no_custody;no_settlement".to_string())
        }
        "preview" => {
            expect_args(&call, 5)?;
            let side = parse_side(call.arg(0).map_err(|_| "ARG")?)?;
            let margin = parse_positive(call.arg(1).map_err(|_| "ARG")?)?;
            let leverage = call.arg(2).map_err(|_| "ARG")?.parse::<u8>().map_err(|_| "INVALID_LEVERAGE")?;
            let entry = parse_positive(call.arg(3).map_err(|_| "ARG")?)?;
            let mark = parse_positive(call.arg(4).map_err(|_| "ARG")?)?;
            let candidate = validate_open(side, margin, leverage, entry)?;
            let (p, fee) = make_position(candidate.side, candidate.margin, candidate.leverage, candidate.entry).map_err(|_| "RISK")?;
            let result = preview(&p, mark).map_err(|_| "RISK")?;
            Ok(format!("DEMO_ONLY;pnlAtomic={};equityAtomic={};maintenanceAtomic={};openFeeAtomic={};liquidatable={};profitCapped={}", result.pnl, result.equity, result.maintenance, fee, result.liquidatable, result.profit_capped))
        }
        "get_position" => {
            expect_args(&call, 0)?;
            validate_address(call.caller())?;
            match read_position(call.caller())? {
                Some(p) => Ok(format!("DEMO_ONLY;id={};side={};marginAtomic={};leverage={};entryPriceAtomic={}", p.id, side_name(p.side), p.margin, p.leverage, p.entry)),
                None => Ok("NO_OPEN_DEMO_POSITION".to_string()),
            }
        }
        "open_position" => {
            expect_args(&call, 4)?;
            validate_address(call.caller())?;
            if read_position(call.caller())?.is_some() { return Err("POSITION_ALREADY_OPEN"); }
            let side = parse_side(call.arg(0).map_err(|_| "ARG")?)?;
            let margin = parse_positive(call.arg(1).map_err(|_| "ARG")?)?;
            let leverage = call.arg(2).map_err(|_| "ARG")?.parse::<u8>().map_err(|_| "INVALID_LEVERAGE")?;
            let entry = parse_positive(call.arg(3).map_err(|_| "ARG")?)?;
            let mut p = validate_open(side, margin, leverage, entry)?;
            let key = next_id_key(call.caller());
            let last = storage::get(&key).map_err(|_| "STORAGE_READ_FAILED")?.unwrap_or_default();
            let current = if last.is_empty() { 0 } else { last.parse::<u64>().map_err(|_| "BAD_COUNTER")? };
            p.id = current.checked_add(1).ok_or("COUNTER_OVERFLOW")?;
            storage::set(&key, &p.id.to_string()).map_err(|_| "STORAGE_WRITE_FAILED")?;
            save_position(call.caller(), &p)?;
            Ok(format!("DEMO_OPENED;id={};no_funds_held", p.id))
        }
        "add_margin" => {
            expect_args(&call, 1)?;
            validate_address(call.caller())?;
            let mut p = read_position(call.caller())?.ok_or("NO_OPEN_POSITION")?;
            let extra = parse_positive(call.arg(0).map_err(|_| "ARG")?)?;
            let new_margin = p.margin.checked_add(extra).ok_or("OVERFLOW")?;
            validate_open(p.side, new_margin, p.leverage, p.entry)?;
            p.margin = new_margin;
            save_position(call.caller(), &p)?;
            Ok(format!("DEMO_MARGIN_UPDATED;marginAtomic={};no_funds_held", p.margin))
        }
        "close_position" => {
            expect_args(&call, 1)?;
            validate_address(call.caller())?;
            let p = read_position(call.caller())?.ok_or("NO_OPEN_POSITION")?;
            let mark = parse_positive(call.arg(0).map_err(|_| "ARG")?)?;
            if mark > MAX_PRICE { return Err("PRICE_LIMIT"); }
            let (rp, _) = make_position(p.side, p.margin, p.leverage, p.entry).map_err(|_| "RISK")?;
            let x = preview(&rp, mark).map_err(|_| "RISK")?;
            // Close is a demo bookkeeping action only. Never settle to a token balance.
            storage::set(&position_key(call.caller()), "").map_err(|_| "STORAGE_WRITE_FAILED")?;
            Ok(format!("DEMO_CLOSED;id={};pnlAtomic={};no_payout", p.id, x.pnl))
        }
        "liquidate" | "withdraw" | "deposit" | "settle" | "set_oracle" => Err("ACTION_DISABLED_NO_TRUSTED_ORACLE_OR_SETTLEMENT"),
        _ => Err("UNKNOWN_ACTION"),
    }
}

pub fn handle(call: Call) -> Reply {
    match inner(call) { Ok(answer) => ok(&answer), Err(message) => error(message) }
}

#[cfg(test)]
mod tests {
    use super::*;
    const WALLET: &str = "retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37";
    fn call(action: &str, args: &str) -> Call {
        Call::from_json(&format!("{{\"action\":\"{}\",\"caller\":\"{}\",\"args\":{},\"value\":\"0\"}}", action, WALLET, args)).unwrap()
    }
    #[test] fn info_ok() { assert!(handle(call("info", "[]")).is_ok()); }
    #[test] fn preview_ok() { assert!(handle(call("preview", "[\"long\",\"1000000000000000000\",\"2\",\"100000000000000000000\",\"110000000000000000000\"]")).is_ok()); }
    #[test] fn liquidation_disabled() { assert!(handle(call("liquidate", "[]")).is_err()); }
    #[test] fn no_withdrawal() { assert!(handle(call("withdraw", "[]")).is_err()); }
    #[test] fn encoding_roundtrip() {
        let p = validate_open(Side::Long, 1_000_000_000_000_000_000, 2, 100_000_000_000_000_000_000).unwrap();
        let p = DemoPosition { id: 1, ..p };
        let restored = decode(&encode(&p)).unwrap();
        assert_eq!(restored.id, 1);
        assert_eq!(restored.margin, p.margin);
        assert_eq!(restored.leverage, 2);
    }
    #[test] fn account_validation() { assert!(validate_address(WALLET).is_ok()); assert!(validate_address("rete-test").is_err()); }
    #[test] fn invalid_leverage() { assert!(validate_open(Side::Long, 1_000_000_000_000_000_000, 8, 100_000_000_000_000_000_000).is_err()); }
}
