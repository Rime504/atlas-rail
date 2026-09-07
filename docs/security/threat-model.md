# Threat Model & Risk Analysis

This document provides a formal security threat model for Atlas Rail.

| Threat Narrative | Mitigations Implemented | Residual Risk | Future Hardening |
|---|---|---|---|
| **Compromised User Credential** | Argon2 password hashing, short-lived JWT access tokens (15m), role-based permissions (RBAC). | Stolen session token valid until expiry. | WebAuthn / Multi-Factor Authentication (MFA). |
| **Malicious API-Key Holder** | Scoped API keys hashed with SHA-256; restricted permissions. | Stolen key allows API execution within key scope. | IP allowlisting per API key. |
| **Double-Spend / Double-Submit Attempt** | `Idempotency-Key` header requirement; payload hash validation; database unique constraint `[organizationId, idempotencyKey]`. | None for identical payloads. | Redis distributed lock during queue execution. |
| **Idempotency-Key Replay** | Replays exact stored response for identical payload hash; rejects payload mismatches with `409 Conflict`. | Stored responses expire after TTL (7 days). | Permanent idempotency index archiving. |
| **Approval Race Condition** | State machine transition assertions inside database serializable transactions. | Concurrent approval requests blocked at DB layer. | Optimistic concurrency locking (`version` column). |
| **Webhook SSRF** | URL validation disallowing loopback/private IPs (`127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`) in production mode. | Misconfigured DNS pointing to internal service. | Outbound proxy with strict IP egress filter. |
| **Webhook Replay** | HMAC-SHA256 signature containing Unix timestamp (`Atlas-Signature: t=<timestamp>,v1=<hmac>`). | Receiver must enforce timestamp age window. | Enforce receiver SDK clock tolerance check. |
| **Malicious Recipient Substitution** | Recipients must be explicitly registered and marked `VERIFIED`; policy engine checks status and risk level before execution. | Compromised admin verifying rogue address. | Dual-control recipient verification workflow. |
| **Compromised RPC Provider** | Program ID allowlist validation (`SystemProgram`, `TokenProgram`, `AssociatedToken`, `ComputeBudget`, `Memo`). | Fake RPC returning fabricated simulation results. | Multi-RPC quorum verification. |
| **Simulation/Submission Mismatch** | Worker re-evaluates policy using RPC simulation logs immediately before submission. | On-chain state changes between simulation and submission slot. | Compute budget limit & max blockheight bounds. |
| **Private Key Leakage** | v1 does not custody, log, store, or transmit private keys. Uses `MockDevnetSignerAdapter` for devnet only. | Mock key used for devnet testing. | Integrate customer-controlled HSM/KMS adapter. |
| **Cross-Tenant Authorization Failure** | All Prisma queries explicitly filter on `organizationId` from authenticated JWT/API key context. | Logic error in raw query missing tenant ID. | Automated tenant isolation lint rules. |
| **Ambiguous Network Submission** | Worker checks RPC transaction signature status before retrying submission. | RPC connection timeout during broadcast. | Automated blockhash expiration polling. |
| **Denial of Service / Supply Chain** | Rate limiting per minute on login, API, and payout creation endpoints; pnpm frozen lockfile in CI. | Resource exhaustion on unthrottled read endpoints. | Cloudflare WAF & dependency vulnerability scanning. |
