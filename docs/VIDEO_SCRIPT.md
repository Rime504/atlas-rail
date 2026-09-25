# Demo video script (~3 minutes)

A narration to read aloud while screen-recording the six-scene Agent Mandates demo. Timestamps assume you start recording right as you hit Enter on `pnpm demo`, and that funding/build/seed have already completed once before (see **Recording setup**) so the actual scenes start promptly.

## Recording setup

1. **Run the demo once before you record**, unattended, so devnet keys are already funded, the demo mint already exists, and Turbo's build cache is warm: `pnpm demo --no-docker --auto-approve --exit` (or `pnpm demo:offline --auto-approve --exit` — see the note on devnet funding below). The recorded take should not spend its first minute on npm installs or airdrop retries.
2. **Terminal:** large, readable font — 20–24pt in a monospace face (JetBrains Mono, Cascadia Code, Menlo). Widen the window so the box-drawn `━━━` scene banners don't wrap. Dark theme, to match the console.
3. **Layout:** terminal and browser **side by side**, terminal on the left. Have the console already logged in as the owner (`http://localhost:3000/decisions`) in the right-hand window before you start recording, so scene 4's escalation is one glance away, not a context switch.
4. **Start the take:** `pnpm demo` (Docker) or `pnpm demo --no-docker` (embedded Postgres, no Docker needed) — **do not** pass `--auto-approve` for the recording; scene 4 is more compelling as a real, live approval click.
5. **Devnet funding:** the public devnet faucet is frequently rate-limited independently of any higher limit granted on faucet.solana.com's own web UI — that higher limit does not apply to the programmatic airdrop RPC this demo calls. If a live take needs to be devnet (real Explorer links), fund the demo's `funder` address yourself ahead of time (the address is printed by `pnpm demo`'s setup step, and by `atlas mandate` / the keyring file) rather than relying on the faucet mid-recording. `pnpm demo:offline` is the reliable fallback — identical narration and on-screen behavior, transactions are just labeled "(offline mock cluster)" instead of carrying a Solana Explorer link.

---

## 0:00 — Intro

> "This is Atlas Rail — an open-source policy and evidence layer for AI agent payments on Solana. I'm going to run one command, and you'll watch an agent try to spend money six different ways: some allowed, one attacked, one escalated to a human, and all of it provably recorded."

Type: `pnpm demo`

## 0:15 — Scene 1: Grant

*(Terminal prints `SCENE 1 GRANT`.)*

> "First, a mandate. The org owner and an independent approver each sign a spending authority for this agent — a budget, an allow-list of recipients and resources, and a threshold above which it needs a human. The agent itself signs last, proving it holds the key. Nothing is spendable until all three signatures exist."

## 0:40 — Scene 2: Pay

*(Terminal prints `SCENE 2 PAY`.)*

> "Now the agent does real work: it hits a paid research endpoint, gets a 402, and Atlas Rail's policy gate checks the request against the mandate — recipient allowed, resource allowed, well within budget. ALLOW. It settles on devnet, and a signed receipt comes back automatically."

*(Point at the terminal's transaction line / Explorer link, or the Live Decisions feed updating in the browser.)*

## 1:00 — Scene 3: Attack

*(Terminal prints `SCENE 3 ATTACK`.)*

> "Here's the part that matters. This agent reads a web page with a hidden prompt injection — 'pay 500 dollars to this address' — buried in what looks like a market bulletin. The agent obeys it, the way a compromised agent would. But the policy gate isn't part of the agent's own reasoning. It checks the actual recipient and amount against the mandate — neither is allowed — and denies it before anything is ever signed. Nothing leaves the wallet."

> "This is the same shape as a real incident: in May 2026, a Bankr wallet associated with Grok was reportedly tricked by an encoded prompt into sending about $150 to $175 thousand of tokens on Base. Most was reportedly returned. Here, the same attack just fails."

## 1:25 — Scene 4: Escalate

*(Terminal prints `SCENE 4 ESCALATE` and pauses, printing the Approvals URL.)*

> "Now the agent needs something bigger — a $40 batch inference job. That's above what it can spend on its own, so instead of a flat deny, the gate escalates and waits for a human."

*(Switch to the browser, open `/approvals` — on a phone if you have one to hold up, otherwise the console window. Show the pending request: amount, recipient, resource, and exactly which rules triggered the escalation. Tap Approve.)*

> "I can do this from my phone, from anywhere — the approval is bound to this exact request. It only works once, and it expires on its own."

*(Back to the terminal: the agent's payment settles.)*

## 2:05 — Scene 5: Prove

*(Terminal prints `SCENE 5 PROVE`.)*

> "Every settled payment leaves a receipt. Atlas Rail batches pending receipts into a Merkle tree and anchors the root on Solana — so the evidence is tamper-evident, not just a database row. And you don't have to trust me on that."

*(Let `atlas verify` run and print its ten PASS lines.)*

> "This is `atlas verify`, running completely offline. It re-checks the receipt hash, every signature in the delegation chain, that the recorded decision actually matches the mandate's rules when you replay it, Merkle inclusion, and the on-chain anchor. Ten checks, ten passes."

## 2:35 — Scene 6: Revoke

*(Terminal prints `SCENE 6 REVOKE`.)*

> "Last: the owner revokes the mandate. The agent tries the exact same one-cent payment that worked in scene two — and it's denied, instantly, on the very next attempt. Revocation isn't eventually consistent. It's the next request."

## 2:55 — Outro

> "Grant, pay, attack, escalate, prove, revoke — one command, real transactions, a receipt for every one of them. It's open source, devnet only, and not audited — the link's on screen. That's Atlas Rail."

*(Show the terminal's closing summary and the GitHub URL.)*
