# Security Policy & Controls

## Important Safety Boundary

> **DEVNET ONLY — NOT FOR REAL FUNDS**
> Atlas Rail v1 is strictly designed and configured for **Solana Devnet simulation and enterprise governance evaluation**.
>
> - **Mainnet Beta Prohibited**: Mainnet execution is rejected across API validation, server startup, RPC URL parsing, and UI headers.
> - **No Key Custody**: Atlas Rail does not hold, request, log, transmit, or custody private keys.
> - **Mock Signer**: Non-production local and devnet flows rely on `MockDevnetSignerAdapter`, enabled only when `ATLAS_ALLOW_MOCK_SIGNER=true`.
> - **Legal Disclaimer**: Atlas Rail does not claim banking, custody, legal, regulatory, money transmitter, FX, or payment provider status. Deploying with real funds requires an external security audit, formal legal review, qualified KMS/custody integration, and operational threat modeling.

## Disclosure Contact

To report security concerns or vulnerabilities, please contact: `security@atlasrail.local` (or file a confidential security report via GitHub).

## Core Security Architecture

1. **Role-Based Access Control (RBAC)**: Strict permission enforcement across all REST endpoints (`OWNER`, `ADMIN`, `OPERATOR`, `APPROVER`, `AUDITOR`, `DEVELOPER`).
2. **Tenant Isolation**: All database queries enforce `organizationId` scoping.
3. **Idempotency Guarantees**: `Idempotency-Key` headers required on payout creations; request payload hashes validated to prevent double submission.
4. **Transaction Simulation**: Every transaction is simulated via devnet RPC and evaluated against an explicit program ID allowlist before signing.
5. **Signed Webhooks**: Deliveries signed using HMAC-SHA256 with timestamp validation and SSRF protection filters on destination URLs.
6. **Append-Only Auditing**: Ledger entries and audit events are immutable.
