/**
 * "Is this normal for this agent?" A small check on top of the mandate, from the agent's own history.
 * It never allows anything the mandate denies. It only sends a payment the mandate would allow to the
 * owner instead of paying it automatically. Every flag says why in one plain sentence.
 */

export interface PastPayment {
  amount: bigint;
  recipient: string;
  /** Epoch seconds. */
  at: number;
}

export interface BehaviourFlag {
  check: 'UNUSUAL_AMOUNT' | 'NEW_RECIPIENT' | 'BURST';
  reason: string;
}

export interface BehaviourOptions {
  /** Flag a payment more than this many times the recent median. Default 5. */
  multiple?: number;
  /** Payments needed before amounts are judged. Default 3. */
  minHistory?: number;
  /** How many recent payments make the median. Default 20. */
  recent?: number;
  /** This many payments inside `burstSeconds` is a burst. Default 10 in 60 seconds. */
  burstCount?: number;
  burstSeconds?: number;
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2n;
}

function times(amount: bigint, base: bigint): string {
  // One decimal place, without floating point on token amounts.
  const tenths = (amount * 10n) / base;
  return `${tenths / 10n}${tenths % 10n === 0n ? '' : `.${tenths % 10n}`}`;
}

export function checkBehaviour(history: PastPayment[], payment: PastPayment, options: BehaviourOptions = {}): BehaviourFlag[] {
  const multiple = BigInt(options.multiple ?? 5);
  const minHistory = options.minHistory ?? 3;
  const recent = [...history].sort((a, b) => a.at - b.at).slice(-(options.recent ?? 20));
  const flags: BehaviourFlag[] = [];

  if (recent.length >= minHistory) {
    const usual = median(recent.map((p) => p.amount));
    if (usual > 0n && payment.amount > usual * multiple) {
      flags.push({ check: 'UNUSUAL_AMOUNT', reason: `${times(payment.amount, usual)}x higher than this agent's usual payment.` });
    }
  }
  // A first-ever payment has no history to compare with; after that, a new recipient is worth a look.
  if (history.length > 0 && !history.some((p) => p.recipient === payment.recipient)) {
    flags.push({ check: 'NEW_RECIPIENT', reason: 'First payment from this agent to this recipient.' });
  }
  const burstSeconds = options.burstSeconds ?? 60;
  const burstCount = options.burstCount ?? 10;
  const inBurst = history.filter((p) => p.at > payment.at - burstSeconds).length + 1;
  if (inBurst >= burstCount) {
    flags.push({ check: 'BURST', reason: `${inBurst} payments in the last ${burstSeconds} seconds, more than usual.` });
  }
  return flags;
}
