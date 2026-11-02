# Atlas Rail: proof of permission for every AI agent payment.

Atlas Rail checks that AI is allowed to spend your money, and proves it.

**[Become a user →](https://atlas-rail-site.vercel.app/start)**

[Website](https://atlas-rail-site.vercel.app) · [Playground](https://atlas-rail-playground.vercel.app) · [Verify a payment](https://atlas-rail-playground.vercel.app/verify)

## Why it exists

AI agents now pay for things on their own.
Solana shows that money moved.
Atlas Rail proves the payment was allowed.

## How it works

**Mandate.** The owner writes the agent's rules: how much it may spend, to whom, for what, and until when. The owner signs them.

**Gate.** Every payment is checked against the mandate before anything is signed. A payment that breaks a rule is refused. A payment over the agent's limit waits for the owner.

**Proof.** Every decision gets a receipt. Receipts are anchored on Solana, so anyone can check that a payment was allowed, without trusting us.

## What it does for your agent

**Paying for APIs and data (x402).** Works today. When an API asks your agent to pay, the gate checks the offer first: the seller, the resource, the amount. Only an allowed payment is signed.

**Pay per call with payment channels.** Works today. The owner puts a deposit in a Solana payment channel. Each allowed call settles from it, and the leftover goes back to the owner.

**Spending authority for Solana's `pay` tool.** Works today. `pay` asks Atlas Rail before it pays, and pays only if the answer is yes. The hook that lets `pay` ask is still in review in the `pay` project.

**Over-limit or unusual payments.** The payment waits. The owner approves that one payment, once. If nobody approves, nothing is paid.

**Even if the agent's app is hacked.** The agent's key lives in a separate signer, not in the agent's app. It only signs what the rules allow.

**Trading agents.** Coming next. Not built yet. The plan: rules for trades, such as a maximum trade size, a list of allowed tokens and a list of allowed exchanges.

## Try it in 2 minutes

You need Node 22, pnpm 9 and the Solana CLI. `pnpm demo:pay` also needs Rust.

```bash
git clone https://github.com/Rime504/atlas-rail.git
cd atlas-rail
pnpm install
pnpm demo
pnpm demo:pay
```

Both run on a local Solana validator on your machine. Nothing touches real money.

`pnpm demo` tells the whole story in 7 steps, in about 30 seconds:

1. The owner creates a mandate: $0.05 per call, $1 per day.
2. The agent pays an API 5 times. Each payment is checked first and gets a receipt.
3. The agent tries to pay $5. It is blocked before anything is signed, and the owner is asked.
4. An unusual payment, inside the limits, is flagged. The owner approves it, and it is paid once.
5. All receipts are anchored on Solana in one transaction.
6. One receipt is checked: PASS. The same receipt with one byte changed: FAIL.
7. A channel runs low. The agent pauses until the owner tops it up.

`pnpm demo:pay` runs the same rules inside Solana's `pay` tool, with its real code:

- A normal payment: allowed and paid.
- Over the limit: refused, and the owner is asked.
- An unknown recipient: refused.
- The owner approves, the agent tries again: paid once.
- Atlas Rail is down, or answers too slowly: nothing is paid.
- The same payment sent twice at once: paid once.

The first run builds Solana's pay tool from source. It needs Rust, a few GB of free disk space, and takes several minutes.

## Use it in your agent

The npm package is coming soon. Today, build it from this repo:

```bash
pnpm install
pnpm --filter atlasrails build
node scripts/launch-voucher-services.mjs both   # starts the gate and the signer; leave it running
```

Then, in your agent:

```ts
import { Connection } from '@solana/web3.js';
import { createAtlasRail, keypairWallet } from 'atlasrails';

const atlas = createAtlasRail({
  apiUrl: process.env.ATLAS_API_URL!,          // the gate you started
  apiToken: process.env.ATLAS_VOUCHER_TOKEN!,
  connection: new Connection('https://api.devnet.solana.com', 'confirmed'),
  wallet: keypairWallet({ path: './payer.json' }),
  gate,                                         // the key that signs receipts
  execution: 'autoExecute',
});

const result = await atlas.pay({ mandate, channel, recipient, mint, amount: 1000n, resourceUrl, network, expiresAt, mandateAddress });

if (result.status === 'paid') console.log('paid, receipt', result.receipt.id);
else console.log('not allowed:', result.reason);
```

Creating the mandate and opening the channel are covered step by step in [`packages/atlasrails/MANUAL.md`](packages/atlasrails/MANUAL.md). A full example is in [`examples/atlasrails-pay`](examples/atlasrails-pay). The `pay` integration is in [`docs/pay-sh-authority.md`](docs/pay-sh-authority.md).

## Status

- Devnet only. The client refuses a mainnet connection.
- No external audit yet.
- Not for real money.

Measured on a laptop with a local validator:

- `pnpm demo`: all 7 steps in about 30 seconds.
- Answers to `pay`: median 41.9 ms, 95th percentile 68.2 ms, over 500 requests, including reading the mandate from Solana ([report](reports/pay-authority-local-2026-10-27.json)).

The mandate format is in [`spec/agent-mandate-v0.1.md`](spec/agent-mandate-v0.1.md).

## Team

Built by Rime Khatib and Divyesh Shan. Contact us through the [website](https://atlas-rail-site.vercel.app).

## Reporting a problem

Please report anything sensitive privately: email `atlasrails@gmail.com`, or open a private report on [GitHub security advisories](https://github.com/Rime504/atlas-rail/security/advisories/new). See [`SECURITY.md`](SECURITY.md).

## License

[Apache 2.0](LICENSE).
