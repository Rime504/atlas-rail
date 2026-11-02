# Atlas Rail as the pay.sh spending authority

pay.sh lets a software agent pay for an API with one `curl`. Atlas Rail answers pay's question "may this agent make this payment?" before pay signs anything. The answer comes from the agent's signed mandate, the spending already done, and the owner when a payment is over the limit. Every gate decision gets a receipt that anyone can check against Solana.

Atlas Rail is devnet-only until its external audit. A request for any other network is denied.

This uses the external spending-authority hook in [solana-foundation/pay PR #514](https://github.com/solana-foundation/pay/pull/514) (tested on `898135e`). That PR is not merged yet.

## Try it

```bash
pnpm install
pnpm demo:pay
```

It needs Rust and the Solana CLI. The first run builds Atlas Rail and `integrations/pay-sh-host` (a few minutes). It then starts a local validator with the same programs as Devnet, a small x402 seller, and Atlas Rail, and runs seven scenes through the real pay `curl` tool. `--runs 10`, `--bench 500` and `--report` are what produced `reports/pay-authority-local-2026-10-27.json`. `--cluster devnet` runs the same scenes on Devnet; it needs SOL in `~/.atlas-pay-demo/funder.json`.

| Scene | What pay does | Paid |
|---|---|---|
| A. Normal payment | Allowed, pays | Once |
| B. Over the limit | `REJECTED_BEFORE_EXECUTION`, the owner is asked | No |
| C. Recipient not on the mandate | `DENIED` | No |
| D. Owner signs, agent retries | First refused, then allowed on the same connection; a second retry is stopped by pay; a new pay process is `DENIED` by Atlas | Once |
| E. Atlas Rail is down | `UNAVAILABLE` | No |
| F. Answer slower than pay's deadline | `TIMEOUT` | No |
| G. Same operation twice at once | One allowed, the other stopped (one connection and two processes) | Once |

The last step anchors every decision receipt in one transaction, verifies one (PASS) and checks that one changed byte fails.

## How pay reaches Atlas Rail

pay has no command-line flag for the hook. A trusted host builds an `AuthorityBinding` with the caller id and the authority. `integrations/pay-sh-host` is that host, about 190 lines: it posts each `SpendRequest` to Atlas Rail and maps the answer, failing closed on anything it does not understand.

```
agent ──curl──▶ pay (MCP) ──SpendRequest──▶ Atlas Rail ──▶ gate + spend memory + owner
                    ◀── allow / deny / reject_before_execution ──┘
          pay signs and pays only on allow
```

## The endpoint

`POST /v1/pay-authority/authorize` on the API (`apps/api`). The body is pay's `SpendRequest` as JSON. The answer is always HTTP 200:

| `decision` | `unavailable` | pay does |
|---|---|---|
| `allow` | `false` | Signs and pays |
| `deny` | `false` | Stops (`DENIED`) |
| `reject_before_execution` | `false` | Stops; the same operation may be retried (`REJECTED_BEFORE_EXECUTION`) |
| `deny` | `true` | Stops (`UNAVAILABLE`). Atlas Rail itself failed: database, RPC or signer |

Atlas Rail answers `reject_before_execution` only while it waits for the owner, and it reserves nothing during that wait, so the retry is safe. pay's HTTP provider in PR #525 does not know this answer yet and reads it as unavailable, which still stops the payment.

The answer also carries `reason` in plain words, `receipt_id`, `approval_id`, `request_sha256`, `offer_hash`, and `atlas`: an Ed25519 signature by the Atlas Rail key over every other field (domain `atlasrail/v0.1/authority-answer`). pay ignores these fields.

`GET /v1/pay-authority/receipts/:id` returns a decision receipt. `atlas verify` checks it.

## Setup

| Setting | What it does |
|---|---|
| `ATLAS_PAY_CALLERS_FILE` | JSON file: `{ "callers": [ { "caller_id": "research-agent", "mandate_file": "mandates/research.json" } ] }`. Each mandate file is the signed mandate. Unknown callers are denied. |
| `ATLAS_PAY_AUTHORITY_TOKEN` | Optional bearer token. pay's PR #525 provider sends no credentials, so without it the endpoint must only be reachable by the pay host. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID` | Over-limit payments notify the owner on Telegram. The owner's wallet signs; a tap does not approve. Without them, over the limit is a plain deny. |

The worker's periodic anchor job anchors pay decision receipts after payment receipts, one after the other, because both move the same mandate's root counter. The mandate's gate authority must be the API's instance key.

## Rules for retries and duplicates

- pay sends `(caller_id, operation_id)`. Atlas Rail binds it for good to the exact request bytes, the offer, the amount, the token, the recipient and the network.
- The same id with different bytes is denied.
- The same attempt gets the same answer again.
- After an allow, a new attempt is denied. An operation is paid at most once, even after a pay restart, because Atlas Rail keeps this in Postgres.
- After `reject_before_execution`, a new attempt is decided again. If the owner's wallet signed that exact operation, it is allowed once.
- One decision at a time per mandate, across API processes (a Postgres advisory lock shared with the voucher path).
- An allowed payment counts as spent. pay does not tell Atlas Rail whether the payment landed.

## Which answers have a receipt

Every answer is signed. A receipt is issued when the mandate's rules ran: allow, deny by a rule, and over the limit. These are anchored. Answers given without running the rules have no receipt: an unknown caller, a non-Devnet network, a malformed request, an offer that does not match the request, a reused operation id, a refused retry, a mandate that is not on Solana, and an owner who rejected or did not answer in time.

```bash
pnpm --filter @atlas-rail/cli build
node apps/cli/dist/main.js verify decision.json --trusted-key <Atlas Rail instance key>
```

## Speed

500 answers over HTTP on one machine, each the real request pay sent, including the read of the mandate account from the RPC: median 41.9 ms, p95 68.2 ms, slowest 150.5 ms (27 Oct 2026, local validator). pay's default deadline is 5 seconds.

## Limits

- Devnet only. No external audit yet.
- PR #514 is not merged. `reject_before_execution` over HTTP needs a provider that knows it, like `integrations/pay-sh-host`.
- pay's x402 client reads its RPC from `PAY_RPC_URL`, not from the host's RPC setting. The demo sets it.
- No result callback from pay, so a payment that failed after an allow still counts against the budget.
- Devnet still runs the mandate program without `anchor_root_v2`. The Devnet demo anchors with the deprecated `anchor_root` (`legacyAnchorInstruction`), which `atlas verify` accepts. After the program upgrade this switch goes away.
