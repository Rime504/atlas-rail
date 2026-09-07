# Atlas Rail

> **Programmable treasury controls and safe USDC payouts for global businesses on Solana devnet.**

[![CI](https://github.com/Rime504/atlas-rail/actions/workflows/ci.yml/badge.svg)](https://github.com/Rime504/atlas-rail/actions)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Solana](https://img.shields.io/badge/Solana-Devnet_Only-14F195?logo=solana)](https://solana.com)

---

## ⚠️ Important Safety Boundary

> **DEVNET ONLY — NOT FOR REAL FUNDS**
> Atlas Rail v1 is strictly a Solana **DEVNET** policy-control plane and stablecoin payout sandbox.
>
> - **Mainnet Beta Prohibited**: Mainnet execution is explicitly rejected across API validation, server startup, RPC URL parsing, and UI headers.
> - **No Key Custody**: Atlas Rail does not hold, request, log, transmit, or custody private keys.
> - **Mock Signer**: Non-production local and devnet flows rely on `MockDevnetSignerAdapter`, enabled only when `ATLAS_ALLOW_MOCK_SIGNER=true`.
> - **Legal Disclaimer**: Atlas Rail does not claim banking, custody, legal, regulatory, money transmitter, FX, or payment provider status. Deploying with real funds requires an external security audit, formal legal review, qualified KMS/custody integration, and operational threat modeling.

---

## Product Overview

Solana makes token transfers fast and inexpensive, but businesses require enterprise controls:
- **Recipient allowlists** and verification workflows
- **Programmable spend policies** and daily/monthly rolling limits
- **Multi-user authorization queues** requiring independent approval counts
- **Transaction simulation** before execution to catch failures and unallowed program IDs
- **Idempotency keys** guaranteeing non-duplication
- **Append-only financial ledgers** and reconciliation CSV exports
- **HMAC-signed webhooks** for ERP and accounting integration

---

## Architecture Diagram

```mermaid
graph TD
    Client[Next.js 15 Web Dashboard / API Client] -->|REST / OpenAPI| API[NestJS Fastify REST API]
    API -->|Auth & Tenancy| DB[(PostgreSQL 16 - Prisma)]
    API -->|Queue Jobs| Redis[(Redis 7 / BullMQ)]
    API -->|Policy Evaluation| Domain[@atlas-rail/domain]
    Worker[BullMQ Execution Worker] -->|Locks & Queue Jobs| Redis
    Worker -->|Read State| DB
    Worker -->|Build & Simulate| Solana[@atlas-rail/solana]
    Solana -->|RPC Simulation| Devnet[Solana Devnet RPC]
    Solana -->|Mock Devnet Signer| MockSigner[MockDevnetSignerAdapter]
    Worker -->|Signed Webhook Delivery| ExternalERP[Webhook Receiver]
```

---

## Repository Monorepo Layout

```
atlas-rail/
├── apps/
│   ├── web/           # Next.js 15 App Router B2B Treasury Console
│   ├── api/           # NestJS Fastify REST API & OpenAPI Swagger docs
│   └── worker/        # BullMQ queue worker for payout execution & webhooks
├── packages/
│   ├── config/        # Environment validation & safety constants
│   ├── database/      # Prisma ORM schema, migrations, ULIDs & seeds
│   ├── domain/        # Money math, Policy Engine, State Machine & RBAC
│   ├── solana/        # Devnet RPC client, SPL builders, simulator & mock signer
│   ├── api-client/    # TypeScript SDK for Atlas Rail API
│   └── ui/            # Shared UI primitives & Devnet Safety Banner
├── docs/              # System architecture, security threat model, ADRs & runbooks
├── examples/          # Node API client & Webhook receiver examples
├── docker-compose.yml
├── Makefile
└── README.md
```

---

## Quick Start (Local Docker Stack)

### Prerequisites
- Node.js 22 LTS
- pnpm 9+
- Docker Desktop & Docker Compose

### 1. Clone & Setup Environment
```bash
git clone https://github.com/Rime504/atlas-rail.git
cd atlas-rail

cp .env.example .env
```

### 2. Install & Start Stack
```bash
make install
make up
make db-migrate
make db-seed
make demo
```

### 3. Service URLs
- **Web Dashboard**: [http://localhost:3000](http://localhost:3000)
- **API Server**: [http://localhost:3001](http://localhost:3001)
- **Swagger API Docs**: [http://localhost:3001/docs](http://localhost:3001/docs)
- **Mailpit Email Preview**: [http://localhost:8025](http://localhost:8025)

---

## Demo Accounts

All seeded demo accounts share the development-only password: `ChangeMe_AtlasRail_DevOnly`

| Role | Email | Purpose |
|---|---|---|
| **Owner** | `owner@atlasrail.local` | Full organization governance & policy management |
| **Operator** | `operator@atlasrail.local` | Draft payouts & register recipients |
| **Approver 1** | `approver1@atlasrail.local` | Grant 1st payout approval |
| **Approver 2** | `approver2@atlasrail.local` | Grant 2nd payout approval & trigger execution |
| **Auditor** | `auditor@atlasrail.local` | Read-only ledger inspection & CSV export |

---

## Quality & Test Commands

```bash
# Run all quality checks (typecheck, lint, unit & integration tests)
make check

# Run unit tests across packages
make test-unit

# Run full monorepo build
make build
```

---

## Security & Disclosure

For security policies and threat modeling details, review [SECURITY.md](SECURITY.md) and [docs/security/threat-model.md](docs/security/threat-model.md).

Report security concerns to `security@atlasrail.local`.

---

## License

[Apache License 2.0](LICENSE).
