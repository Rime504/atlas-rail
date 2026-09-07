# Changelog

All notable changes to Atlas Rail will be documented in this file.

## [0.1.0] - 2026-09-01

### Added
- Initial release of Atlas Rail devnet-only monorepo.
- `@atlas-rail/domain`: Money arithmetic, policy engine, payout state machine, RBAC role permissions.
- `@atlas-rail/solana`: Devnet RPC client, SPL Token transfer builder, transaction simulator, mock signer adapter.
- `@atlas-rail/database`: Prisma schema, PostgreSQL 16 migrations, ULID generators, seed script.
- `@atlas-rail/api`: NestJS REST API with Fastify adapter, OpenAPI Swagger UI, JWT & API Key auth, idempotency interceptor, webhook HMAC signer.
- `@atlas-rail/web`: Next.js 15 App Router B2B treasury control dashboard with persistent Devnet Warning Header.
- `@atlas-rail/worker`: BullMQ background job queues for payout simulation, execution, and signed webhook retries.
- Docker Compose, Makefile targets, GitHub Actions CI/CD workflows.
