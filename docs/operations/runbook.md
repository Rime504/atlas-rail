# Operations & Incident Runbook

## Service Management

### Local Stack Startup
```bash
make install
make up
make db-migrate
make db-seed
make demo
```

### Health Checks
- API Liveness: `GET http://localhost:3001/health/live`
- API Readiness: `GET http://localhost:3001/health/ready`
- Swagger UI: `http://localhost:3001/docs`

## Triage & Emergency Procedures

### Freezing a Treasury
In the event of suspicious activity or emergency maintenance:
1. Log in as `OWNER` or `ADMIN`.
2. Navigate to Treasuries -> Freeze Treasury (or call `POST /v1/treasuries/:id/freeze`).
3. Active payout executions for that treasury will immediately block.

### Queue Failure Diagnosis
- Inspect BullMQ failed jobs via Redis or Pino logs (`LOG_LEVEL=debug`).
- Retry failed payouts only after confirming on-chain transaction status via signature lookup.
