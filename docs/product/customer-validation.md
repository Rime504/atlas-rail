# Customer validation

Status: proposed validation plan, not customer traction. Baseline: repository commit `4a2572d` and the founder's statement in the planning conversation that there are no customers or revenue yet. All interview counts, prices, time limits and conversion thresholds below are experiments or decision targets, not measured results.

Start with [what this is](../../whatthisis.md). Execute implementation tasks through [engineering.md](../../engineering.md). This document owns the commercial evidence required to move between gates; [release gates](../operations/release-gates.md) owns technical readiness.

## The hypothesis

An agent platform already buying external data or tools for business customers will pay Atlas to control purchases by customer and task, resolve ambiguous payment outcomes, and reconcile purchases to customer work.

The initial buyer is the platform founder, CTO or engineering lead who owns purchasing reliability and support cost. Finance benefits from attribution; security can veto adoption. Do not assume the CFO is the first buyer.

Qualify a prospect only when it has:

- A recurring research, enrichment or data-processing workflow with a paying downstream customer or an approved customer launch.
- External purchases that happen today, or a specific launch blocked by missing purchasing controls.
- More than one customer or job sharing purchasing infrastructure.
- A named owner for failed purchases, reconciliation, customer billing or task margin.
- Permission to show a redacted example of the problem.

An agent demo, hackathon entry, wallet address, or interest in x402 alone does not qualify. Do not require a chain migration to create a need for Atlas. If prospects mainly need ordinary API usage billing, compare gateway and FinOps products before expanding the plan.

## Gate definitions

| Gate                   | Proposed evidence                                                                                                                                                                               | Decision                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| G0: scope and evidence | Buyer/workflow hypothesis, known current alternatives, baseline trust boundaries, current CI/commands and owners                                                                                | Begin discovery; substantive pilot implementation waits for G1             |
| G1: paid need          | Two independent qualified companies fund an evaluation, or complete a genuine purchasing process with approved budget, named owner and dated commitment; substantially the same problem in both | Authorize the shared pilot slice, not every requested feature              |
| G2: sandbox readiness  | Technical requirements in release-gates.md met for the selected flow; buyer accepts the devnet/shadow limitation                                                                                | Start the bounded evaluation                                               |
| G3: pilot evidence     | Repeated use, measured value, cost to serve, and at least two recurring conversions or explicit recurring purchase commitments                                                                  | Continue the product or change the scope from evidence                     |
| G4: release assessment | Commercial evidence plus the technical assessment packet                                                                                                                                        | Decide the next release scope; this never authorizes mainnet or real funds |

A free letter of intent, friendly endorsement or grant is evidence of interest, not a paid purchase decision. Keep a funded evaluation, an approved but unpaid commitment, and recurring revenue as separate categories.

## Discovery sequence

The proposed first discovery cycle is 15 qualified conversations. Aim for five redacted workflow examples and two companies identifying substantially the same unresolved problem. These are operating targets, not a deadline that turns missing evidence into approval.

Ask about a recent event before showing the demo:

1. Show the last purchase that timed out, failed, required approval or needed manual investigation.
2. What did the wallet, payment provider, agent runtime and billing system each report?
3. How did you determine whether money moved and whether the tool executed?
4. Could a retry pay twice for the same intended purchase? Which component prevents it?
5. How do customer, task and subagent budgets share a parent limit?
6. What existing provider controls already solve this? What remains manual?
7. Who pays for the engineering or support work, and what purchase process would Atlas face?
8. What would stop you from buying the proposed evaluation at a stated price?

Capture observed events and the buyer's words separately from the team's interpretation. Do not turn a hypothetical security loss into an estimate of money saved.

## The replacement test

For each prospect, implement or review a configuration of its existing product that attempts the same workflow. Ask the prospect to verify the remaining gap. Include its own code as an alternative.

| Alternative                                                                                                                                   | Relevant documented capabilities                             | Question to settle with the buyer                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [Privy](https://docs.privy.io/agent-wallets/overview)                                                                                         | Delegated wallets, signing policies and spending controls    | Is anything needed beyond the wallet's policies and the platform's billing database? |
| [Turnkey](https://docs.turnkey.com/solutions/company-wallets/agentic-wallets)                                                                 | Scoped signing and approval policies                         | Can the buyer implement the whole requirement with this provider at acceptable cost? |
| [Nevermined with LangChain](https://www.langchain.com/blog/agents-that-pay-how-nevermined-empowers-langchain-agents-to-buy-and-sell-services) | Delegated spending and payment traces across agent workflows | Which purchase/reconciliation case still requires Atlas?                             |
| Existing billing/gateway stack                                                                                                                | Customer-specific observed capabilities                      | Is the cost mostly model/API usage accounting rather than payment authority?         |
| Internal implementation                                                                                                                       | Current engineering and support work                         | What ongoing work would Atlas actually replace?                                      |

These links establish vendor-described overlap, not independently tested security or adoption. Recheck current capabilities before a competitive claim. A prospect satisfied by a wallet cap is a failed qualification, not a reason to invent differentiation.

## A paid evaluation offer

Proposed price experiment: $1,000–$3,000 for a scoped evaluation. Proposed recurring price experiment: $1,000–$2,000 per month, with a written usage allowance and overage policy after cost measurement. These are hypotheses to quote and test, not a published price list.

Each evaluation must name:

- Buyer, technical contact, budget owner and decision date.
- One purchase workflow, supported rail/provider and environment.
- Baseline problem and success measure agreed before delivery.
- Inputs the customer may share, access controls and deletion date.
- Deliverables, exclusions, fee and commercial authorization.
- The recurring product the buyer would purchase if the evaluation succeeds.

Initial delivery can replay historical purchase records or evaluate requests in shadow mode alongside the customer's existing system. Devnet can exercise authorization and recovery without real funds. Shadow observations are not evidence that Atlas prevented a production payment, and devnet transactions are not customer payment volume.

Use the existing services where possible. Bespoke integration work must be identified in the contract and revenue reporting. One customer's feature request does not become the product roadmap without a second need or an explicit strategic decision.

## Evidence record

Keep identifiable customer material in an approved private system. Commit only a sanitized summary or aggregate report when the customer permits it. Do not put purchase logs, personal contacts, contracts, credentials or full resource URLs with sensitive query strings in a public issue.

For each evaluation, maintain these fields:

| Field               | Required content                                                                          |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Identity            | Internal customer reference; public name only with permission                             |
| Workflow            | Purchases, customers/jobs, providers, existing controls and excluded paths                |
| Baseline            | Dated examples, actual support work and measurement period                                |
| Alternative         | Product/version tested, configuration, remaining gap and buyer confirmation               |
| Commercial evidence | Quoted price; status: unpaid / approved commitment / paid evaluation / recurring contract |
| Results             | Metric definitions, sample size, environment, period and counterexamples                  |
| Decision            | Continue / revise / stop, reason, owner and next review date                              |

An initial report can use an internal reference such as `pilot-example`; it must not imply a named company is a customer before an agreement exists.

## Metrics and cost worksheet

| Metric                | Definition                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Time to integrate     | Partner engineering time from prerequisites ready to a successful supported sandbox workflow; list founder assistance separately |
| Repeated use          | Distinct customer work days/jobs using the evaluated workflow; exclude scheduled synthetic traffic and demos                     |
| Unresolved purchases  | Purchases with unknown financial or fulfillment outcome at the agreed observation cutoff, divided by evaluated purchases         |
| Reconciliation effort | Observed operator minutes per investigated case before/after; compare like cases                                                 |
| Recurring conversion  | A paid evaluation followed by a recurring agreement; distinguish signed commitments from collected recurring revenue             |
| Payment volume        | Settled value by environment and asset; omit test/devnet value from real payment volume                                          |
| Support burden        | Founder/operator time and unresolved tickets per customer per period                                                             |
| Unit cost             | Signing + RPC + infrastructure + storage/anchoring + provider charges, including failed attempts and retries                     |
| Contribution          | Recurring revenue minus variable infrastructure and delivery/support cost, with cost allocation stated                           |

For each candidate price, record monthly customer jobs, purchase attempts per job, settled purchases, signing calls, RPC calls, stored evidence bytes, anchor batches, provider fees and support hours. Use actual quotes and measured usage. Model quiet and bursty usage separately. Record escrow working capital and network fees even when the customer pays them directly.

Illustrative arithmetic: a 1% fee needs $100 million in annual payment volume to earn $1 million in annual revenue; 100 customers at $1,000 monthly produce $1.2 million ARR. These calculations do not establish that either customer base exists. A platform with little spend and little operational pain may not support a meaningful subscription.

## Continue, change, or stop

Continue only when the same core workflow serves independent buyers, the buyer can name the value, and a recurring price is credible. A proposed integration target is one partner working day once prerequisites are ready. A proposed repeated-use observation period is four weeks. Record misses honestly rather than excluding difficult integrations.

After 15–20 qualified conversations, reconsider the wedge if nobody shares concrete evidence or enters a priced evaluation. Reconsider earlier if:

- Existing wallet policies solve the problem satisfactorily.
- Usage consists mainly of demonstrations or incentives.
- Each prospect needs a different bespoke product.
- Adoption requires replacing the customer's wallet, merchants, billing system and chain at once.
- Costs to serve exceed plausible revenue.
- Buyers want only a library and will not pay for hosting, operations or workflow features.

The product founder owns qualification, pricing, evidence and the decision. The engineering lead owns feasibility and measurement integrity. The security owner can block an unsafe evaluation. Record disagreement and unresolved assumptions; a sales deadline cannot waive a financial correctness requirement.

## Evidence for a funding discussion

Maintain a small packet: buyer problem, alternative tested, paid evidence, actual adoption, cost to serve, current trust boundaries, release plan and use of funds. Present proposed targets separately from historical results. Do not describe an upstream PR as adoption, an evaluation fee as ARR, blocked test attempts as losses prevented, or public chain volume as Atlas's market.

The next financing milestone should fund a repeatable customer workflow. No amount of investment, audit completion or pilot enthusiasm changes the current devnet/localnet restriction without a separate product and release decision.
