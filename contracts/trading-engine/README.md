# Retium Perps Trading Engine – Rust v0.3.0 (Phase A)

This package is **only a local Rust risk-math starter**, not a deployed or deployable Retium trading contract.
It does not read private keys, contact an RPC, sign transactions, move tokens, or modify Custody v0.2.0.

## Why the separation?
Review of the already deployed AssemblyScript custody source shows:
- only `market`, `account`, `init`, `set_paused`, `deposit`, and `withdraw` actions;
- `guard(wallet(caller))` for state-changing actions, disallowing ordinary contract callers;
- no lock, unlock, PnL settlement, or liquidation interface.

Do not attempt direct trading settlement or admin workarounds on this existing vault.

## Run on Windows PowerShell
```powershell
cd "D:\Projects\Retium\retium-perps\contracts\trading-engine"
cargo test
```

## Scope
- `src/lib.rs`: deterministic fixed-point PnL, maintenance margin, replay/stale-price checks, bounded position construction.
- 4 built-in unit tests, **not run in the authoring environment** (Rust compiler unavailable here).
- Leverage limited to **1–3x**, matching the current TypeScript sandbox. No real oracle or authentication yet.

## Later phases
B. Create Retium-specific Rust/WASM contract using official `retium-contract` crate, following current docs.
C. Add authenticated price updates and replay protection, stateful positions, robust accounting, property tests.
D. Design a new separate margin/settlement vault if required; preserve existing deployed Custody v0.2.0 unchanged.
E. Perform local/integration/security tests and `retium deploy --dry-run` before any separate testnet deployment.

Read docs: https://docs.retium.org/developers/crate-retium-contract
