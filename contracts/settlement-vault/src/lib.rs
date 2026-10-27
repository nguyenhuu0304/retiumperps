
#![cfg_attr(target_arch = "wasm32", no_std)]
extern crate alloc;

use alloc::{
    format,
    string::{String, ToString},
};

use retium_contract::{
    call, entrypoint, error, ok, storage, Call, Reply,
};

// ======================================================
// RETIUM PERPS - SETTLEMENT VAULT
// Rust / WASM / Retium Testnet
//
// Version: v0.2.1-hardening
//
// Deposit / Withdraw token integration
// Position settlement remains DISABLED.
//
// Requires runtime atomic rollback verification.
// NOT APPROVED FOR PUBLIC DEPOSITS.
// ======================================================

// Existing RTD asset configuration from RetiumPay.
const ASSET: &str =
    "c1d3885930a23a099e28e6f55f8ee8d8908902b57a7ef9d28de6756819d5611c";

const ASSET_HASH: &str =
    "5c6b3392d5f3769522befe48cb5dc53db3e633e2f3a63f29abba74433ef768a2";

// Existing owner wallet #37.
const OWNER: &str =
    "retef25ddec9d77f15810718a59551061df10024179bc6da4952432f236448575a88cb37";

// 10 tokens, 18 decimals.
const CAP: u128 = 10_000_000_000_000_000_000;

entrypoint!(handle);

retium_contract::rcp_metadata!(
    r#"{"rcp_type":"retium_perps_rtd_vault","traits":["testnet","collateral","rtd","hardening"],"capabilities":["execute"],"lockable_fields":[],"evolves_from":"","weight":5,"version":"v0.2.1"}"#
);

// ======================================================
// RETIUM HOST IMPORTS
// ======================================================

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn get_contract_code_hash(
        contract: usize,
        contract_len: i32,
        output: usize,
        max_len: i32,
    ) -> i32;
}

// ======================================================
// STORAGE HELPERS
// ======================================================

fn fail(reason: &str) -> ! {
    retium_contract::fail(reason)
}

fn read(key: &str) -> String {
    storage::get(key)
        .unwrap_or_else(|_| fail("STORAGE_READ_FAILED"))
        .unwrap_or_default()
}

fn write(key: &str, value: &str) {
    storage::set(key, value)
        .unwrap_or_else(|_| fail("STORAGE_WRITE_FAILED"));
}

fn number(key: &str) -> u128 {
    let raw = read(key);

    if raw.is_empty() {
        return 0;
    }

    raw.parse::<u128>()
        .unwrap_or_else(|_| fail("CORRUPT_LEDGER"))
}

fn save_number(key: &str, value: u128) {
    write(key, &value.to_string());
}

// ======================================================
// CHECKED ARITHMETIC
// ======================================================

fn plus(a: u128, b: u128) -> u128 {
    a.checked_add(b)
        .unwrap_or_else(|| fail("OVERFLOW"))
}

fn minus(a: u128, b: u128) -> u128 {
    a.checked_sub(b)
        .unwrap_or_else(|| fail("UNDERFLOW"))
}

fn amount(raw: &str) -> Result<u128, &'static str> {
    if raw.is_empty()
        || raw.len() > 39
        || !raw.bytes().all(|c| c.is_ascii_digit())
    {
        return Err("BAD_AMOUNT");
    }

    let value = raw.parse::<u128>()
        .map_err(|_| "BAD_AMOUNT")?;

    if value == 0 || value > CAP {
        return Err("AMOUNT_OUT_OF_RANGE");
    }

    Ok(value)
}

// ======================================================
// WALLET AND OWNERSHIP
// ======================================================

fn valid_wallet(wallet: &str) -> bool {
    wallet.len() == 72
        && wallet.starts_with("rete")
        && wallet.as_bytes()[4..]
            .iter()
            .all(|c| {
                c.is_ascii_digit()
                    || (b'a'..=b'f').contains(c)
            })
}

fn owner(caller: &str) -> bool {
    valid_wallet(OWNER) && caller == OWNER
}

fn initialized() -> bool {
    read("vault:init") == "1"
}

fn require_ready() {
    if !initialized() {
        fail("NOT_INITIALIZED");
    }
}

// ======================================================
// CONTRACT ID AND ASSET IDENTITY
// ======================================================

fn self_id() -> String {
    retium_contract::env::contract_id()
        .unwrap_or_else(|_| fail("SELF_ID_FAILED"))
}

#[cfg(target_arch = "wasm32")]
fn verify_asset() {
    let id = ASSET.as_bytes();
    let mut output = [0u8; 128];

    let len = unsafe {
        get_contract_code_hash(
            id.as_ptr() as usize,
            id.len() as i32,
            output.as_mut_ptr() as usize,
            output.len() as i32,
        )
    };

    if len != 64
        || &output[..64] != ASSET_HASH.as_bytes()
    {
        fail("ASSET_CODE_HASH_MISMATCH");
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn verify_asset() {
    // Native tests cannot verify blockchain identity.
}

// ======================================================
// TOKEN CALLS
// ======================================================

fn token_call(method: &str, args: &[&str]) -> String {
    verify_asset();

    let reply = call::contract(ASSET, method, args)
        .unwrap_or_else(|_| fail("TOKEN_CALL_FAILED"));

    if call::is_error_reply(&reply) {
        fail("TOKEN_REJECTED");
    }

    reply
}

fn parse_balance(reply: &str) -> Option<u128> {
    let text = reply.trim();

    let raw =
        if text.starts_with('"') && text.ends_with('"') {
            &text[1..text.len() - 1]
        } else {
            text
        };

    if raw.is_empty()
        || !raw.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }

    raw.parse::<u128>().ok()
}

fn balance(wallet: &str) -> u128 {
    let reply = token_call("balance_of", &[wallet]);

    parse_balance(&reply)
        .unwrap_or_else(|| {
            fail("UNSUPPORTED_TOKEN_BALANCE_REPLY")
        })
}

// ======================================================
// REENTRANCY PROTECTION
// ======================================================

fn enter() {
    // Fail closed on unexpected lock values.
    if read("vault:lock") != "0" {
        fail("VAULT_LOCKED_OR_CORRUPT");
    }

    write("vault:lock", "1");

    if read("vault:lock") != "1" {
        fail("LOCK_VERIFICATION_FAILED");
    }
}

fn leave() {
    if read("vault:lock") != "1" {
        fail("INVALID_UNLOCK_STATE");
    }

    write("vault:lock", "0");
}

fn require_unlocked() {
    if read("vault:lock") != "0" {
        fail("VAULT_LOCKED_OR_CORRUPT");
    }
}

// ======================================================
// ACCOUNTING
// ======================================================

fn account_key(wallet: &str) -> String {
    format!("vault:free:{}", wallet)
}

fn check_solvency() {
    let liabilities = number("vault:total");

    if liabilities > CAP {
        fail("VAULT_LIABILITY_CAP_EXCEEDED");
    }

    let contract = self_id();
    let actual = balance(&contract);

    if actual < liabilities {
        fail("VAULT_INSOLVENT");
    }
}

// ======================================================
// REAL TOKEN DEPOSIT
// ======================================================

fn deposit(wallet: &str, value: u128) -> String {
    require_ready();

    if read("vault:paused") != "0" {
        fail("DEPOSITS_PAUSED");
    }

    enter();

    // Check solvency before any external transfer.
    check_solvency();

    let current_total = number("vault:total");
    let next_total = plus(current_total, value);

    if next_total > CAP {
        fail("VAULT_CAP_EXCEEDED");
    }

    let key = account_key(wallet);
    let next_free = plus(number(&key), value);

    let contract = self_id();

    let before = balance(&contract);
    let user_before = balance(wallet);

    if user_before < value {
        fail("INSUFFICIENT_WALLET_BALANCE");
    }

    let value_string = value.to_string();

    // User must have approved this vault beforehand.
    token_call(
        "transfer_from",
        &[wallet, &contract, &value_string],
    );

    let after = balance(&contract);
    let user_after = balance(wallet);

    if after != plus(before, value)
        || user_after != minus(user_before, value)
    {
        fail("DEPOSIT_TOKEN_DELTA_MISMATCH");
    }

    // Update liabilities only after verified transfer.
    save_number(&key, next_free);
    save_number("vault:total", next_total);

    check_solvency();

    leave();

    format!(
        "DEPOSIT_OK;amount={};free={}",
        value, next_free
    )
}

// ======================================================
// REAL TOKEN WITHDRAWAL
// ======================================================

fn withdraw(wallet: &str, value: u128) -> String {
    require_ready();

    enter();

    // Validate solvency before state changes.
    check_solvency();

    let key = account_key(wallet);
    let free = number(&key);
    let total = number("vault:total");

    if value > free {
        fail("INSUFFICIENT_FREE_MARGIN");
    }

    if value > total {
        fail("INVALID_TOTAL_LIABILITY");
    }

    let next_free = minus(free, value);
    let next_total = minus(total, value);

    let contract = self_id();

    let before = balance(&contract);
    let user_before = balance(wallet);

    if before < value {
        fail("INSUFFICIENT_VAULT_BALANCE");
    }

    // Checks-effects-interactions.
    // Revert is REQUIRED if external transfer fails.
    save_number(&key, next_free);
    save_number("vault:total", next_total);

    let value_string = value.to_string();

    token_call(
        "transfer",
        &[wallet, &value_string],
    );

    let after = balance(&contract);
    let user_after = balance(wallet);

    if after != minus(before, value)
        || user_after != plus(user_before, value)
    {
        fail("WITHDRAW_TOKEN_DELTA_MISMATCH");
    }

    check_solvency();

    leave();

    format!(
        "WITHDRAW_OK;amount={};free={}",
        value, next_free
    )
}

// ======================================================
// CONTRACT ACTIONS
// ======================================================

fn execute(c: Call) -> Result<String, &'static str> {
    if c.value() != 0 {
        return Err("NO_NATIVE_RTM_ACCEPTED");
    }

    let caller = c.caller();

    match c.action() {
        "info" => {
            if !c.args().is_empty() {
                return Err("BAD_ARGS");
            }

            Ok(
                "RTD_VAULT;TESTNET;VERSION=0.2.1;\
                 NO_POSITION_SETTLEMENT"
                    .to_string(),
            )
        }

        "init" => {
            if !c.args().is_empty() {
                return Err("BAD_ARGS");
            }

            if !owner(caller) {
                return Err("OWNER_ONLY");
            }

            if initialized() {
                return Err("ALREADY_INITIALIZED");
            }

            // Asset check before initialization.
            verify_asset();

            write("vault:owner", OWNER);
            write("vault:asset", ASSET);
            write("vault:asset_hash", ASSET_HASH);

            // Deposits disabled by default.
            write("vault:paused", "1");
            write("vault:lock", "0");

            save_number("vault:total", 0);
            write("vault:init", "1");

            Ok("INITIALIZED_PAUSED".to_string())
        }

        "status" => {
            if !c.args().is_empty() {
                return Err("BAD_ARGS");
            }

            Ok(format!(
                "initialized={};paused={};total={};asset={}",
                initialized(),
                read("vault:paused"),
                number("vault:total"),
                ASSET
            ))
        }

        "account" => {
            if c.args().len() != 1 {
                return Err("BAD_ARGS");
            }

            let wallet = c.arg(0)
                .map_err(|_| "BAD_ARGS")?;

            if !valid_wallet(wallet) {
                return Err("BAD_WALLET");
            }

            Ok(format!(
                "account={};free={};locked=0",
                wallet,
                number(&account_key(wallet))
            ))
        }

        "pause" | "unpause" => {
            require_ready();

            if !owner(caller) {
                return Err("OWNER_ONLY");
            }

            if !c.args().is_empty() {
                return Err("BAD_ARGS");
            }

            require_unlocked();

            let paused =
                if c.action() == "pause" {
                    "1"
                } else {
                    "0"
                };

            write("vault:paused", paused);

            Ok(format!(
                "PAUSE_UPDATED;paused={}",
                paused
            ))
        }

        "deposit" | "withdraw" => {
            require_ready();

            if !valid_wallet(caller) {
                return Err("BAD_CALLER");
            }

            if c.args().len() != 1 {
                return Err("BAD_ARGS");
            }

            let value = amount(
                c.arg(0).map_err(|_| "BAD_ARGS")?
            )?;

            if c.action() == "deposit" {
                Ok(deposit(caller, value))
            } else {
                Ok(withdraw(caller, value))
            }
        }

        // Do not allow state changes to margin or PnL
        // until Position Engine authorization exists.
        "lock_margin"
        | "unlock_margin"
        | "settle_pnl"
        | "liquidate" => {
            Err("POSITION_ENGINE_NOT_CONNECTED")
        }

        _ => Err("UNKNOWN_ACTION"),
    }
}

pub fn handle(c: Call) -> Reply {
    match execute(c) {
        Ok(message) => ok(&message),
        Err(reason) => error(reason),
    }
}

// ======================================================
// UNIT TESTS
// ======================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_amounts() {
        assert_eq!(amount("100").unwrap(), 100);

        assert!(amount("0").is_err());
        assert!(amount("-1").is_err());
        assert!(amount("1.5").is_err());
        assert!(amount("999999999999999999999999999").is_err());
    }

    #[test]
    fn validates_wallets() {
        assert!(valid_wallet(OWNER));
        assert!(!valid_wallet("rete-invalid"));
    }

    #[test]
    fn ownership_is_fixed() {
        assert!(owner(OWNER));
        assert!(!owner("invalid"));
    }

    #[test]
    fn parses_token_balances() {
        assert_eq!(parse_balance("123"), Some(123));
        assert_eq!(parse_balance("\"123\""), Some(123));
        assert_eq!(parse_balance("abc"), None);
        assert_eq!(parse_balance(""), None);
        assert_eq!(parse_balance("-1"), None);
    }

    #[test]
    fn arithmetic_checks() {
        assert_eq!(plus(10, 20), 30);
        assert_eq!(minus(20, 10), 10);
    }

    #[test]
    fn cap_is_positive() {
        assert!(CAP > 0);
        assert!(amount(&CAP.to_string()).is_ok());
    }
}
