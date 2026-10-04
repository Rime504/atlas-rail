/** The playground's fixed scenario amounts (base units of the demo mint, 6 decimals) — the single
 * source of truth for both the server (scenario.ts, building the actual offers) and the client
 * (demo/page.tsx, labelling buttons before the result comes back). No dependencies, safe to import
 * from a 'use client' component. */

export const MAX_PER_PAYMENT = '5000000'; // $5.00
export const MAX_PER_WINDOW = '20000000'; // $20.00
export const MAX_TOTAL = '100000000'; // $100.00
export const EXPECTED_PRICE = '10000'; // $0.01
export const PRICE_TOLERANCE_PCT = 50; // tolerated ceiling: $0.015
export const PRICE_HARD_MAX = '30000'; // $0.03 — anything above this is always denied
export const MODERATE_SPIKE_AMOUNT = '20000'; // $0.02 — above tolerance, within hard max: escalate
export const SEVERE_SPIKE_AMOUNT = '50000'; // $0.05 — above hard max: deny
export const ATTACK_AMOUNT = '500000000'; // $500.00
