# Perps feasibility — 26 October 2026

Status: GO for isolated simulation; NO-GO for public live trading.

## Checked sources

Official Retium SDK main resolved to `09f27815236946d67a9be5984504a5bcdf8cb7cd` during research. Read AGENTS.md and contract `lib.rs`, `call.rs`, `env.rs`, `crypto.rs`, `storage.rs`, token and wallet docs.

- https://github.com/Retium-Org/retium-sdk
- https://docs.retium.org/developers/writing-contracts
- https://docs.retium.org/developers/connecting-a-wallet
- https://docs.retium.org/developers/tokens

Contract primitives include storage, code hashes, block timestamps, cross-contract calls and ML-DSA signature verification. These do not constitute a ready perpetual engine. A nested token call may return an application error without trapping; state must not credit failed transfers. Native Rust host stubs are insufficient evidence of stateful VM behavior; runtime and chain tests will be required.

Previous Safehouse adapter fixes a 1:1 reference, not a BTC market price. Never reuse it as BTC/USD oracle. External quote transport is not on-chain proof. No native Pyth/Chainlink deployment was confirmed. RPC reads from this research host returned HTTP 403; no conclusion about global network availability follows.

## Proposed staged design

1. Current bounded-payout model and invariant tests.
2. Retium Rust proof-of-concept for authorized initialization, RTD pull/payout, atomic failures, immutable asset identity, unit conversions and signed quote authentication.
3. Delayed requests with deterministic quote selection, expiry/cancel/refund, side-aware acceptable price, canonical chain/market domain separation, sequence and publish-time checks. Delayed execution alone does not prevent keeper cherry-picking.
4. Funding accounting, capped solvency model or alternative matched/hedged design, liquidation and explicit stale-price recovery/emergency policy. Keepers must be economically viable and replaceable.
5. Actual testnet lifecycle and adversarial tests. Keep new contracts, service keys, storage, repository and Vercel project isolated from Retium Pay.

## Unresolved before launch

- RTD identity and behavior against the current network; successful old lending probes do not certify this new contract.
- Authentic external feed and on-chain verification, trust disclosure and operational SLA.
- Execution latency/finality and gas budget. Frequent pushed-price transactions could be expensive; measure before choosing intervals. ML-DSA is not automatically compatible with upstream oracle signatures.
- Unlimited long profit cannot be made fully solvent merely by limiting leverage/open interest. Current cap is explicit, not a claim of hedging.
- Multi-user vault solvency, share pricing/withdrawal restrictions, liquidation bad debt, fees/funding conservation and rounding directions.
- Initializer front-running defense; owner/oracle/keeper separation and authority limitations.
- Restart-safe queue, unknown submission recovery, cancellation semantics, nonce management.

No live funds, signatures, deployments, database changes or messages were sent during the work.
