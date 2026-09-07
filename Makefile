.PHONY: install dev up down logs db-generate db-migrate db-seed db-reset test test-unit test-integration test-e2e lint format build check openapi demo

install:
	pnpm install

dev:
	pnpm dev

up:
	docker compose up -d --build

down:
	docker compose down -v

logs:
	docker compose logs -f

db-generate:
	pnpm db:generate

db-migrate:
	pnpm db:migrate

db-seed:
	pnpm db:seed

db-reset:
	pnpm db:push --force-reset && pnpm db:seed

test:
	pnpm test

test-unit:
	pnpm test:unit

test-integration:
	pnpm test:integration

test-e2e:
	pnpm --filter @atlas-rail/web test

lint:
	pnpm lint

format:
	pnpm format

build:
	pnpm build

check:
	pnpm typecheck && pnpm lint && pnpm test

openapi:
	pnpm openapi

demo:
	@echo "============================================================"
	@echo "🚀 Atlas Rail Sandbox Demo Environment Ready"
	@echo "============================================================"
	@echo "Web Dashboard: http://localhost:3000"
	@echo "API Server:    http://localhost:3001"
	@echo "Swagger Docs:  http://localhost:3001/docs"
	@echo "Mailpit:       http://localhost:8025"
	@echo ""
	@echo "📌 Demo Login Credentials:"
	@echo "   Owner:     owner@atlasrail.local / ChangeMe_AtlasRail_DevOnly"
	@echo "   Operator:  operator@atlasrail.local / ChangeMe_AtlasRail_DevOnly"
	@echo "   Approver:  approver1@atlasrail.local / ChangeMe_AtlasRail_DevOnly"
	@echo "============================================================"
