import { formatUsdc } from './format';

/** Formatting helpers for the agent-mandate console. The agent API speaks unix seconds. */

/** Token amount for display: grouped, at least 2 and at most `decimals` places, trailing zeros trimmed. Never a float. */
export function formatToken(baseUnits: string | null | undefined, decimals = 6): string {
  const full = formatUsdc(baseUnits, decimals);
  const [whole, fraction = ''] = full.split('.');
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${trimmed}`;
}

export function formatUnix(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  return new Date(seconds * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function timeAgoUnix(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const delta = Math.floor(Date.now() / 1000) - seconds;
  if (delta < 5) return 'just now';
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86_400)}d ago`;
}

/** "4m 12s left" / "expired" for an absolute unix-seconds deadline. */
export function countdownUnix(deadline: number, nowSeconds: number): string {
  const left = deadline - nowSeconds;
  if (left <= 0) return 'expired';
  if (left < 60) return `${left}s left`;
  if (left < 3600) return `${Math.floor(left / 60)}m ${left % 60}s left`;
  if (left < 86_400) return `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m left`;
  return `${Math.floor(left / 86_400)}d left`;
}

export function formatDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

/** Parses a decimal amount string ("12.5") into integer base units without ever touching a float. */
export function decimalToBaseUnits(input: string, decimals = 6): string | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction.length > decimals) return null;
  return `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
}

export function shortHash(hash: string | null | undefined, lead = 10, trail = 6): string {
  if (!hash) return '—';
  return hash.length <= lead + trail + 1 ? hash : `${hash.slice(0, lead)}…${hash.slice(-trail)}`;
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

export const RULE_TITLES: Record<string, string> = {
  OFFER_WELL_FORMED: 'Offer is well-formed',
  MANDATE_SIGNATURES: 'Delegation chain signatures',
  MANDATE_VALIDITY: 'Mandate is in its validity window',
  MANDATE_NOT_REVOKED: 'Mandate not revoked',
  NETWORK_ALLOWED: 'Network allowed',
  ASSET_ALLOWED: 'Asset allowed',
  RESOURCE_ALLOWED: 'Resource allowed',
  PAYTO_ALLOWED: 'Recipient allowed',
  MAX_PER_PAYMENT: 'Per-payment ceiling',
  WINDOW_BUDGET: 'Rolling window budget',
  MAX_TOTAL: 'Lifetime budget',
  TRANSACTION_SIMULATION: 'Transaction simulation',
  ESCALATION_THRESHOLD: 'Human-approval threshold',
  ESCALATION_APPROVAL: 'Approval binding',
};

export function ruleTitle(id: string): string {
  return RULE_TITLES[id] ?? id.replace(/_/g, ' ').toLowerCase();
}
