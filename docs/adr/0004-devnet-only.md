# ADR 0004: Devnet-Only v1 Safety Restriction

## Context
V1 serves as a self-hostable policy-control plane and enterprise governance evaluation sandbox.

## Decision
Enforce strict Devnet-only operation across all layers (API, config, guards, UI, SDK). Prohibit `mainnet-beta` explicitly.

## Consequences
- Protects users from accidental mainnet value loss during evaluation.
- Mainnet readiness stays behind explicit future security audit gates.
