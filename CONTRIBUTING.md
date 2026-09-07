# Contributing to Atlas Rail

Thank you for contributing to Atlas Rail!

## Development Setup

1. Prerequisites: Node.js 22 LTS, pnpm 9+, Docker Desktop.
2. Clone repository:
   ```bash
   git clone https://github.com/Kamelia503/atlas-rail.git
   cd atlas-rail
   ```
3. Copy environment file:
   ```bash
   cp .env.example .env
   ```
4. Install dependencies & launch dev stack:
   ```bash
   make install
   make up
   make db-migrate
   make db-seed
   make demo
   ```

## Workflow & Guidelines

- **Branch Naming**: `feat/description`, `fix/description`, `docs/description`.
- **Commit Conventions**: Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`).
- **Quality Verification**: Run `make check` (`typecheck`, `lint`, `test`) before submitting PRs.
- **Devnet Boundary**: Never attempt to bypass mainnet-beta guards.
