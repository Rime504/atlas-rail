# ADR 0003: Isolated Signer Adapter Boundary

## Context
Application-level private key custody creates significant operational and security liabilities.

## Decision
Isolate all signing functionality behind a pluggable `SignerAdapter` interface. v1 provides a `MockDevnetSignerAdapter` for local devnet testing and an `ExternalCustodySignerAdapter` stub.

## Consequences
- Atlas Rail application code never handles, requests, or stores private keys.
- Production users integrate customer-controlled HSM or custody signing adapters cleanly.
