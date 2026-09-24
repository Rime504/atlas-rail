# Running the Agent Mandates Demo

This is the runbook for the six-scene Agent Mandates demo: **Grant → Pay → Attack → Escalate → Prove → Revoke**. It exercises the real API, Postgres, the Policy Gate, an x402 seller, and — unless you use the offline mode — Solana devnet, end to end. Nothing here uses a float for money and nothing here touches mainnet; see [`docs/security/threat-model.md`](security/threat-model.md) and [`spec/agent-mandate-v0.1.md`](../spec/agent-mandate-v0.1.md) for what is and isn't guaranteed.

## Which command to run

| Command | Needs | What it does |
|---|---|---|
| `pnpm demo` | Docker Desktop (for Postgres + Redis) | The full stack, including the web console at `http://localhost:3000`. |
| `pnpm demo:offline` | Nothing but Node — no Docker, no devnet | Embedded Postgres + an in-memory Solana JSON-RPC cluster. Slower to start (builds an embedded Postgres binary on first run) but works with no external dependencies and no faucet rate limits. |
| `pnpm demo:rehearse` | Nothing but Node | `demo:offline` with `--skip-web --exit --auto-approve` — a fast, unattended pass for CI or "did I break anything". |

Either top-level command is safe to re-run: it seeds the same demo mandates and accounts idempotently rather than duplicating them.

### What you'll see

The orchestrator (`scripts/demo.mjs`) starts, in order: the database, the mock Solana cluster (offline mode only), the API, the worker, the x402 facilitator, the demo seller API, and — unless `--skip-web` — the console. Once everything reports healthy it prints login credentials and runs the scripted agent through all six scenes with narration in your terminal. Scene 4 (Escalate) pauses for a real human decision: open **`http://localhost:3000/approvals`** (it works on a phone) and tap Approve, or pass `--auto-approve` to have the orchestrator approve it for you automatically after a couple of seconds.

When the scenes finish, the services **stay running** so you can click around the console — Mandates, Live Decisions (a real SSE feed), Approvals, Receipts (with an in-console Verify button) — until you press Ctrl+C.

**Seeded login** (all roles, password `ChangeMe_AtlasRail_DevOnly`): `owner@atlasrail.local`, `approver1@atlasrail.local` / `approver2@atlasrail.local`, `operator@atlasrail.local`, `auditor@atlasrail.local`.

## Useful flags

Both `pnpm demo` and `pnpm demo:offline` accept:

| Flag | Effect |
|---|---|
| `--auto-approve` | Auto-approves the scene-4 escalation instead of waiting for you; implies `--exit`. |
| `--exit` | Exit with the scenes' pass/fail status instead of staying up afterward. |
| `--skip-web` | Don't build or start the console (faster iteration on the backend/agent). |
| `--skip-build` | Skip the Turbo build step (use when `dist/` is already current). |
| `--no-docker` | Use an embedded Postgres instead of `docker compose` for the database (this is what `demo:offline` sets). |
| `--rpc <url>` | Point at a different Solana RPC endpoint (devnet mode only). |
| `--asset <demo-mint\|circle-usdc>` | Which token the demo pays with — see below. |

## Funding devnet (only matters for `pnpm demo`, not `:offline`)

The public devnet faucet is aggressively rate limited. `ensureSol` retries with backoff automatically, but if it's still failing:

1. **Fund it yourself once:** send a small amount of devnet SOL from **https://faucet.solana.com** to the funder address the demo prints on first run (`.demo/keyring.json`, key `funder`), or set `DEMO_FUNDER_SECRET_KEY` to a base58 secret key for a wallet you've already funded — the demo will draw SOL from it before hitting the public faucet at all.
2. **Or skip devnet entirely:** `pnpm demo:offline` never touches the public faucet — it uses an in-memory Solana JSON-RPC cluster that mints SOL and tokens for free and behaves like devnet for every instruction the demo builds (SPL transfers, ATA creation, Memo).

### `DEMO_ASSET`: which token gets paid

- **`demo-mint` (default)** — the demo creates and mints its own USDC-like SPL token. Reliable, no external dependency, what you want for a rehearsal or a live pitch.
- **`circle-usdc`** — pays with Circle's real devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). Get at least 50 devnet USDC from **https://faucet.circle.com** (network: Solana Devnet) into the agent's wallet first — the demo prints that address and refuses to proceed with a clear message if the balance is short, rather than a confusing on-chain failure. Only meaningful with real devnet (`pnpm demo`, not `:offline`).

## Verifying a receipt offline, without any of this running

```bash
node apps/cli/dist/main.js verify .demo/receipts/receipt-<id>.json --trusted-key <instance public key>
```

This re-checks everything the console's Verify button does — receipt hash, instance signature, delegation chain, decision signature and scope replay, Merkle inclusion, and (if you pass `--check-settlement` with a reachable RPC) the on-chain settlement and anchor — with no network access required beyond that optional RPC check. Exit code `0` means every check passed, `1` means at least one failed, `2` means the input itself was unusable.

## Using a real LLM instead of the scripted agent

The demo agent's "model" is a small interface (`apps/demo-agent/src/model.ts`):

```ts
export interface AgentModel {
  readonly name: string;
  next(history: readonly AgentMessage[]): Promise<AgentAction>;
}
```

The default `ScriptedModel` is deterministic and calls no external API, which is why the demo can't fail because a model provider is down or rate-limited mid-pitch. To wire in a real model, implement `AgentModel.next` to map the message history to a `{ type: 'tool_call', tool: 'fetch_page' | 'fetch_paid', url, thought }` or a final answer, and pass your model into `runAgent` in place of `researchModel(...)` / `injectedModel(...)` / `heavyInferenceModel(...)` in `apps/demo-agent/src/scenes.ts`. Nothing about the mandate, the gate, or the receipt changes — the model only decides *what to ask for*; the gate still decides *whether it's allowed to pay*.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Port <n> (<service>) is already in use` | A previous demo run (or something else) is already listening on that port. Stop it, or note that `demo:offline`'s Postgres runs on `54329`, not `5432`, specifically so it doesn't collide with a Docker-based Postgres you also have running. |
| Stuck at "Starting embedded PostgreSQL" | First run downloads and initializes the embedded Postgres binary — this can take a minute. Subsequent runs are fast. Check `.demo/pg.log` (path printed in the error) if it times out. |
| `airdrop attempt` retries and eventually fails | The public devnet faucet is rate limited — see **Funding devnet** above. Use `demo:offline`, fund the printed funder address yourself, or set `DEMO_FUNDER_SECRET_KEY`. |
| Scene 4 seems to hang forever | It's waiting for a human. Open `http://localhost:3000/approvals` and approve or deny, or re-run with `--auto-approve`. Default timeout is 900s (`--approval-timeout <s>` to change it). |
| `atlas verify` reports `SETTLEMENT_ONCHAIN: SKIP` | You ran it without `--check-settlement`, or without RPC access — this is a skip, not a failure; the other 9 checks are unaffected. |
| Web console shows "API Offline" | The API didn't finish starting, or `NEXT_PUBLIC_API_BASE_URL` doesn't match where it's actually listening. Check the terminal for the API's own startup errors first — a failed env validation or a missing migration shows up there before the console ever loads. |
| `pnpm demo` (Docker mode) never gets past "Starting PostgreSQL and Redis with Docker" | Docker Desktop isn't running, or `docker compose` isn't on `PATH`. Either start Docker, or use `pnpm demo:offline` instead, which needs neither. |
| Approving on your phone doesn't work | Confirm your phone is on the same network and can reach the machine running the demo at its LAN IP (the console defaults to `localhost`, which only resolves on the host itself) — start the orchestrator with `ATLAS_WEB_URL`/`NEXT_PUBLIC_API_BASE_URL` pointed at that LAN IP, or just approve from the host's own browser. |

## What this demo does *not* prove

It runs entirely on Solana **devnet** (or an in-memory stand-in for it), with generated demo keys that are never committed and are worthless outside this sandbox. It proves the mandate, gate, receipt and console logic work end to end against real transaction construction, simulation and (in devnet mode) real confirmation — it does not constitute a security audit, and `spec/agent-mandate-v0.1.md` is an unadopted proposal, not a standard. See the README's Safety Boundary section before considering anything here for production use.
