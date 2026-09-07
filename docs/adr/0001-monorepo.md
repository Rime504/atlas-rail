# ADR 0001: Monorepo Architecture with pnpm & Turborepo

## Context
Atlas Rail requires shared TypeScript domain models, Solana adapters, database clients, and UI component libraries across web, API, and worker applications.

## Decision
Use a monorepo structured with `pnpm` workspaces and `Turborepo`.

## Consequences
- Fast incremental builds and shared caching.
- Enforced strict TypeScript type safety across apps and packages.
