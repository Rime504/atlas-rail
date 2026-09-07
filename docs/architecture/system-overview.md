# System Overview & Architecture

Atlas Rail is structured as a policy-controlled governance plane for business stablecoin payouts on Solana devnet.

```mermaid
graph TD
    Client[Next.js 15 Web Dashboard / API SDK] -->|REST / OpenAPI| API[NestJS Fastify API]
    API -->|Auth & Tenancy| DB[(PostgreSQL 16 - Prisma)]
    API -->|Job Dispatch| Redis[(Redis 7 / BullMQ)]
    API -->|Policy Engine| Domain[@atlas-rail/domain]
    Worker[BullMQ Queue Worker] -->|Claim Job & Lock| Redis
    Worker -->|Read State| DB
    Worker -->|Build & Simulate| SolanaAdapter[@atlas-rail/solana]
    SolanaAdapter -->|RPC Simulation| Devnet[Solana Devnet RPC]
    SolanaAdapter -->|Mock Signer| MockSigner[MockDevnetSignerAdapter]
    Worker -->|Deliver Signed Webhook| WebhookReceiver[External ERP / Receiver]
```

## Core Components

1. **Web Dashboard (`apps/web`)**: Next.js 15 App Router B2B console for drafting payouts, collecting approvals, monitoring devnet simulations, and exporting reconciliation CSVs.
2. **REST API Server (`apps/api`)**: NestJS Fastify backend handling authentication, RBAC, tenancy isolation, idempotency, and OpenAPI schema generation.
3. **Queue Worker (`apps/worker`)**: BullMQ durable background worker managing transaction simulation, policy re-evaluation, mock signing, confirmation polling, and webhook delivery retries.
4. **Domain Engine (`packages/domain`)**: Deterministic policy evaluator, precision base-unit money arithmetic, and payout state machine.
5. **Solana Integration Layer (`packages/solana`)**: Checked SPL Token instruction builder, RPC simulator, program ID allowlist checker, and signer adapter interface.
