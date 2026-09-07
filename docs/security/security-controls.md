# Security Controls & Limitations

## Security Controls Summary

1. **Authentication & Password Security**: Argon2id password hashing with custom salt parameters.
2. **Access Control (RBAC)**: Role-based permissions mapped across 6 defined roles (`OWNER`, `ADMIN`, `OPERATOR`, `APPROVER`, `AUDITOR`, `DEVELOPER`).
3. **Idempotency Controls**: Mandatory `Idempotency-Key` header for payment endpoints with SHA-256 payload hash verification.
4. **Transaction Safety**: Strict program ID allowlists (`11111111111111111111111111111111`, `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, etc.) and mandatory RPC simulation prior to mock signing.
5. **SSRF Mitigation**: Webhook URL validation enforcing protocol restrictions and private network blocking in production.
6. **Append-Only Audit Trails**: Immutable financial ledger and audit event records.

## Known Limitations & Production Requirements

- **Devnet Only**: v1 strictly rejects `mainnet-beta`.
- **No Real Custody**: v1 uses a devnet mock signer adapter. Production deployment requires integrating a customer-controlled HSM or qualified custody provider.
- **No Legal/Regulatory Claim**: Atlas Rail is an open-source policy-control plane and does not provide legal, banking, custody, or payment provider services.
