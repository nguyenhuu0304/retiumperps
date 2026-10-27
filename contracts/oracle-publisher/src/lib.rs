#![cfg_attr(target_arch = "wasm32", no_std)]
extern crate alloc;

use alloc::{format, string::{String, ToString}};
use retium_contract::{entrypoint, error, ok, storage, Call, Reply};

// IMPORTANT: Must be set to the wallet that WILL sign on-chain calls BEFORE building.
// An invalid/unset value makes init and publish FAIL CLOSED. No first-caller takeover.
const OWNER_WALLET: &str = "retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37";
const MAX_PRICE_ATOMIC: u128 = 100_000_000_000_000_000_000_000_000_000;

entrypoint!(handle);
retium_contract::rcp_metadata!(
    r#"{"rcp_type":"retium_perps_oracle_staging","traits":["testnet","oracle","staging","no_settlement"],"capabilities":["execute"],"lockable_fields":[],"evolves_from":"","weight":5,"version":"v0.1.0"}"#
);

fn valid_wallet(w: &str) -> bool {
    w.len() == 72 && w.starts_with("rete") &&
        w.as_bytes()[4..].iter().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c))
}

fn configured_owner() -> bool { valid_wallet(OWNER_WALLET) }
fn authorized(caller: &str) -> bool { configured_owner() && caller == OWNER_WALLET }
fn positive(raw: &str) -> Result<u128, &'static str> {
    let v = raw.parse::<u128>().map_err(|_| "BAD_INTEGER")?;
    if v == 0 { Err("ZERO_NOT_ALLOWED") } else { Ok(v) }
}
fn format_quote(sequence: u64, price: u128, stamp: u64) -> String {
    format!("{}|{}|{}", sequence, price, stamp)
}
fn parse_quote(raw: &str) -> Result<(u64, u128, u64), &'static str> {
    let mut parts = raw.split('|');
    let seq = parts.next().ok_or("BAD_QUOTE")?.parse::<u64>().map_err(|_| "BAD_QUOTE")?;
    let price = positive(parts.next().ok_or("BAD_QUOTE")?).map_err(|_| "BAD_QUOTE")?;
    let stamp = parts.next().ok_or("BAD_QUOTE")?.parse::<u64>().map_err(|_| "BAD_QUOTE")?;
    if seq == 0 || stamp == 0 || parts.next().is_some() || price > MAX_PRICE_ATOMIC {return Err("BAD_QUOTE")}
    Ok((seq, price, stamp))
}
fn execute(call: Call) -> Result<String, &'static str> {
    if call.value() != 0 {return Err("RTM_NOT_ACCEPTED")}
    match call.action() {
        "info" => {
            if !call.args().is_empty() {return Err("BAD_ARGS")}
            Ok("ORACLE_STAGING;NO_SETTLEMENT;UNTRUSTED_OPERATOR_TIMESTAMP".to_string())
        }
        "init" => {
            if !call.args().is_empty() {return Err("BAD_ARGS")}
            if !authorized(call.caller()) {return Err("NOT_CONFIGURED_OWNER")}
            if storage::get("oracle:initialized").map_err(|_| "READ_FAILED")?.is_some() {return Err("ALREADY_INITIALIZED")}
            storage::set("oracle:owner", OWNER_WALLET).map_err(|_| "WRITE_FAILED")?;
            storage::set("oracle:paused", "1").map_err(|_| "WRITE_FAILED")?;
            storage::set("oracle:initialized", "1").map_err(|_| "WRITE_FAILED")?;
            Ok("INITIALIZED_PAUSED".to_string())
        }
        "status" => {
            if !call.args().is_empty() {return Err("BAD_ARGS")}
            let owner = storage::get("oracle:owner").map_err(|_| "READ_FAILED")?.unwrap_or_default();
            let paused = storage::get("oracle:paused").map_err(|_| "READ_FAILED")?.unwrap_or_default();
            let raw = storage::get("oracle:BTCUSD").map_err(|_| "READ_FAILED")?.unwrap_or_default();
            Ok(format!("STAGING_ONLY;initialized={};owner={};paused={};BTCUSD={}", !owner.is_empty(),owner,paused,raw))
        }
        "pause" | "unpause" => {
            if !call.args().is_empty() {return Err("BAD_ARGS")}
            if !authorized(call.caller()) {return Err("UNAUTHORIZED")}
            if storage::get("oracle:initialized").map_err(|_| "READ_FAILED")?.is_none() {return Err("NOT_INITIALIZED")}
            let target = if call.action() == "pause" {"1"} else {"0"};
            storage::set("oracle:paused", target).map_err(|_| "WRITE_FAILED")?;
            Ok(if target == "1" {"PAUSED"} else {"UNPAUSED"}.to_string())
        }
        "publish_btcusd" => {
            if call.args().len() != 3 {return Err("BAD_ARGS")}
            if !authorized(call.caller()) {return Err("UNAUTHORIZED")}
            if storage::get("oracle:initialized").map_err(|_| "READ_FAILED")?.as_deref() != Some("1") {return Err("NOT_INITIALIZED")}
            if storage::get("oracle:paused").map_err(|_| "READ_FAILED")?.as_deref() != Some("0") {return Err("PAUSED")}
            let seq = call.arg(0).map_err(|_| "BAD_ARGS")?.parse::<u64>().map_err(|_| "BAD_SEQUENCE")?;
            let price = positive(call.arg(1).map_err(|_| "BAD_ARGS")?)?;
            let stamp = call.arg(2).map_err(|_| "BAD_ARGS")?.parse::<u64>().map_err(|_| "BAD_STAMP")?;
            if seq == 0 || stamp == 0 || price > MAX_PRICE_ATOMIC {return Err("OUT_OF_RANGE")}
            if let Some(previous) = storage::get("oracle:BTCUSD").map_err(|_| "READ_FAILED")? {
                let (last_seq, _, last_stamp) = parse_quote(&previous)?;
                if seq <= last_seq || stamp <= last_stamp {return Err("REPLAY_OR_NONMONOTONIC")}
            }
            storage::set("oracle:BTCUSD", &format_quote(seq, price, stamp)).map_err(|_| "WRITE_FAILED")?;
            Ok(format!("PUBLISHED_STAGING;seq={};priceAtomic={};operatorStamp={}",seq,price,stamp))
        }
        _ => Err("UNKNOWN_ACTION"),
    }
}
pub fn handle(call: Call) -> Reply {
    match execute(call) { Ok(message) => ok(&message), Err(reason) => error(reason) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn owner_configuration_is_fail_closed() { assert!(!authorized("rete00000000000000000000000000000000000000000000000000000000000000000000")); }
    #[test] fn rejects_non_positive() {assert!(positive("0").is_err());assert!(positive("-1").is_err());assert!(positive("1.5").is_err());}
    #[test] fn round_trip() {assert_eq!(parse_quote(&format_quote(7, 100_000, 12)).unwrap(), (7, 100_000, 12));}
    #[test] fn rejects_corrupt_quotes() {for s in ["", "0|10|2", "1|0|2", "1|10|0", "1|10|2|3", "abc|4|1"] {assert!(parse_quote(s).is_err());}}
}
