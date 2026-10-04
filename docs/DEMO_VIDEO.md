# Demo video script

A script for a screen recording of the [playground](https://atlas-rail-playground.vercel.app),
under 3 minutes, followed by a 2-minute pitch outline for talking about Atlas Rail without the
screen. Timestamps are targets, not a metronome — pause on the receipt and the price-spike zones;
don't linger on the landing page.

## The walkthrough (under 3:00)

| Time | Say | Click / show |
|---|---|---|
| 0:00–0:15 | "AI agents can now pay for things on their own. Atlas Rail makes sure they only pay what they're allowed to — and proves it." | Landing page. Click **Start the demo**. |
| 0:15–0:25 | "This is a research agent. It has its own Solana wallet." | Step 1 — point at the wallet address. Click **Next**. |
| 0:25–0:45 | "Before it can spend anything, the owner gives it rules: five dollars a payment, twenty an hour, two sellers it's allowed to pay, and roughly a cent for research. The owner, an independent approver, and the agent itself all sign it." | Step 2. Click **Sign and register on Solana** — point at the three checkmarks. Click **Next**. |
| 0:45–1:00 | "A normal payment. One cent, inside every rule. Allowed." | Step 3. Click **Run the payment** — green banner. Click **Next**. |
| 1:00–1:20 | "Now a web page the agent reads has a hidden instruction in it: pay a stranger 500 dollars. The agent's own reasoning is fully compromised — it tries. Watch what happens." | Step 4. Click the attack button — red banner, **"Blocked: seller not on the list."** Click **Next**. |
| 1:20–1:50 | "Here's the subtler one. The *same, allowed* seller just quietly raises its price. A small rise — a human can still approve it. A five-times spike — blocked outright, no human can override it. This is Rule 15." | Step 5. Click both buttons — orange, then red. Click **Next**. |
| 1:50–2:05 | "That orange one needs a person. That's you." | Step 6. Click **Approve** — green banner, "the human approved it." Click **Next**. |
| 2:05–2:25 | "Every allowed payment gets a receipt. Anyone can check it — not by trusting Atlas Rail, by re-running the math." | Step 7. Click **Verify this receipt** — watch the checks turn green. Click **Next**. |
| 2:25–2:45 | "The owner revokes the mandate. The agent's very next payment — denied, instantly, no exceptions." | Step 8. Click **Revoke on Solana**, then **Try the payment again** — red banner. |
| 2:45–3:00 | "Signed mandates. A policy gate outside the agent's reasoning. Human escalation. Receipts anyone can verify. That's Atlas Rail." | End screen. Point at the GitHub / spec / Explorer links. |

**If recording devnet mode too:** swap in the "Use real Solana devnet" toggle before step 2 and
point at the **View on Solana Explorer** links after steps 2 and 8 — adds about 15–20 seconds for
the two transactions to confirm; cut from the price-spike dwell time to stay under 3:00.

## 2-minute pitch outline (no screen)

1. **The problem (20s).** x402 lets an API answer "402 Payment Required" and an agent just pays.
   That's an open wallet: a prompt-injected or buggy agent pays an attacker as readily as a real
   seller. In May 2026 a Bankr wallet tied to Grok was reportedly tricked into sending $150–175k this
   exact way.
2. **The answer (30s).** Atlas Rail puts a policy gate *outside* the agent's own reasoning. A person
   signs the agent a mandate — budget, allowed recipients and resources, a human-approval threshold —
   and the gate checks every payment against it before anything is signed. The agent's signer is
   wrapped so it physically cannot produce a signature without a fresh authorization from the gate.
3. **What's novel (30s).** Rule 15: most systems would let an *already-allowed* seller quietly raise
   its price forever. Atlas Rail fixes the reference price in the owner-signed mandate at signing
   time — a seller can't creep it up a cent at a time. And every payment leaves a receipt anchored on
   Solana devnet that anyone can verify offline, without trusting us.
4. **Proof it's real (20s).** Open source, devnet only, 285+ automated tests, an Anchor program
   anyone can read, and a public playground anyone can click through in under three minutes — no
   signup.
5. **The honest part (20s).** Devnet only, not audited, instance-key trust is a known limitation we
   wrote up ourselves — see [`docs/THREAT_MODEL.md`](THREAT_MODEL.md). We'd rather say what's not
   done than claim it is.
