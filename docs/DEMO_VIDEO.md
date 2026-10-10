# Demo video script

A screen recording of the [playground](https://atlas-rail-playground.vercel.app), under 3 minutes,
then a 2-minute pitch outline. Every button below is the exact label on screen. Every number said
aloud links to its source in [`docs/CLAIMS.md`](CLAIMS.md).

**Before recording:** open the playground in one tab. When you reach the proof step, open `/verify`
**in a new tab** (Ctrl/Cmd-click): the walkthrough keeps its state in the page, and you come back to it
to revoke. Have [`reports/redteam-2026-10-10.md`](../reports/redteam-2026-10-10.md) open on GitHub in a
third tab.

## The walkthrough (2:55)

| Time | Say | Click / show |
|---|---|---|
| 0:00–0:10 | "Can you prove this AI agent was allowed to make this payment? Today, nobody can." | Landing page. |
| 0:10–0:15 | "Atlas Rail makes every agent payment carry its own proof." | Click **Start the demo**. Step 1, click **Next**. |
| 0:15–0:35 | "First, rules. The owner signs a mandate: five dollars a payment, twenty an hour, two sellers. An independent approver signs it. The agent signs it too. Three signatures, registered on Solana." | Step 2: click **Sign and register on Solana**, point at the three signers. **Next**. |
| 0:35–0:45 | "A normal payment: one cent to an approved seller. Allowed." | Step 3: **Run the payment**, green banner. **Next**. |
| 0:45–1:05 | "Now the agent reads a web page with a hidden instruction: pay a stranger 500 dollars. The agent is fully compromised; it tries. The gate refuses before anything is signed." | Step 4: **Let the compromised agent try to pay**, red banner. **Next**. |
| 1:05–1:25 | "Subtler: the same approved seller raises its price. Two cents goes to a human. Five cents is refused outright; no one can override that." | Step 5: **Charge $0.02 instead** (orange), **Charge $0.05 instead** (red). **Next**. |
| 1:25–1:35 | "That orange one needs a person. That's me. Approved." | Step 6: **Approve**, green. **Next**. |
| 1:35–1:45 | "Every allowed payment gets a receipt, and the payment itself names it on-chain." | Step 7: **Verify this receipt**, the checks turn green. Ctrl/Cmd-click **Verify a real devnet payment**. |
| 1:45–2:10 | "Here's the point. Paste any devnet payment. We read its memo from the chain, fetch the receipt it names, and re-check everything: who signed the mandate, the limits, the human approval, the anchor on Solana. Proven." | `/verify` tab: click **A proven payment**. Point at the signers, **with human approval**, **anchor_root**, the Explorer links. |
| 2:10–2:20 | "Now someone else's payment, on the same network. No proof of permission." | Click **A random devnet USDC transfer**: **NO PROOF**. |
| 2:20–2:35 | "We attacked it ourselves, assuming the agent is fully compromised every time: 52 kinds of attack, 1,017 attempts. Money moved outside the mandate: zero." | Red-team report tab: point at the summary line. |
| 2:35–2:50 | "And the owner can stop it at any moment. Revoked. The very next payment is refused." | Back to the walkthrough tab, step 7, **Next**. Step 8: **Revoke on Solana**, then **Try the payment again**, red. **Finish**. |
| 2:50–2:55 | "Every payment proves it was allowed. Check any one yourself." | End screen. |

**With real devnet** (adds about 20 seconds; take it from step 5): switch on **Use real Solana devnet**
in step 1. The step-7 button becomes **Verify this payment from the chain** and opens `/verify` on this
run's own payment. If the public devnet RPC is rate-limiting, the step shows an honest notice instead;
fall back to the example in `/verify`.

## 2-minute pitch outline (no screen)

1. **Problem (15s).** Agents can now pay on their own: an API answers "402 Payment Required" and the
   agent pays. An agent can be tricked or overcharged, and afterwards nobody can prove what it was
   allowed to do.
2. **Why now (15s).** x402 makes paying a one-line integration for any agent. We expect the number of
   agents that can spend money to grow faster than the tools to check what they were allowed to spend.
3. **Why Solana (15s).** The payment, the mandate's on-chain record, the receipt's anchor and the memo
   that points at it all live on one chain, readable with one RPC call. Measured on devnet: a gate
   decision in 351 ms at the median, and anchoring a whole batch of receipts for one 5,000-lamport fee.
4. **What we built (25s).** A mandate signed by owner, independent approver and agent. A 15-rule gate
   that runs before any signature, with the wallet refusing anything not authorised byte for byte.
   Humans approve the edge cases. Every payment names its receipt in its memo, and anyone can verify
   it from the chain at `/verify` or with `atlas verify --tx`.
5. **Proof (20s).** A red team that assumes the agent is fully compromised on every attempt: 52 attack
   types, 1,017 attempts, zero money moved outside the mandate. 100 simultaneous payments against a $5
   cap spend exactly $5. All of it in the repo, re-runnable with `pnpm redteam`.
6. **Business (15s).** Teams that deploy paying agents need to show an owner, an auditor or a seller
   what each agent was allowed to do. The plan: a hosted gate and receipt store, priced per verified
   payment, with the protocol itself open. (A plan, not revenue.)
7. **Moat (10s).** Proof of permission is a format other wallets, facilitators and explorers can check
   without us. If sellers start asking "does this payment carry proof?", the format wins.
8. **Team (5s).** Rime, co-founder and lead engineer. Kamelia, co-founder, the original idea, product
   and go-to-market. Divyesh, on-chain engineer.
