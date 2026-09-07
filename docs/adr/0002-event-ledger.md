# ADR 0002: Append-Only Event Ledger & Reconciliation Design

## Context
Financial compliance and audit requirements demand an immutable history of all treasury actions and payout state changes.

## Decision
All financial events write append-only `LedgerEntry` and `AuditEvent` records. Direct UPDATE or DELETE operations on ledger records are prohibited.

## Consequences
- Complete auditability and financial reconciliation exportability.
- No history tampering or silent state loss.
