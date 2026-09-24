import { formatBaseUnitsToDisplay } from '@atlas-rail/domain';

/** Formats an integer base-unit amount (e.g. "1500000000") into a fixed-decimal display string
 * (e.g. "1,500.000000") with thousands separators, using the same base-unit math the API and
 * worker use — never a float. */
export function formatUsdc(baseUnits: string | null | undefined, decimals = 6): string {
  if (baseUnits === null || baseUnits === undefined) return '0.00';
  const display = formatBaseUnitsToDisplay(baseUnits, decimals);
  const [whole, fraction] = display.split('.');
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${withCommas}.${fraction}`;
}

/** Compact display for cards/headlines (2 decimal places, still comma-grouped). */
export function formatUsdcCompact(baseUnits: string | null | undefined, decimals = 6): string {
  const full = formatUsdc(baseUnits, decimals);
  const [whole, fraction] = full.split('.');
  return `${whole}.${fraction.slice(0, 2)}`;
}

export function truncateAddress(address: string | null | undefined, lead = 6, trail = 6): string {
  if (!address) return '—';
  if (address.length <= lead + trail + 3) return address;
  return `${address.slice(0, lead)}…${address.slice(-trail)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 5) return 'just now';
  const units: [number, string][] = [
    [60, 's'],
    [60, 'm'],
    [24, 'h'],
    [7, 'd'],
    [4.345, 'w'],
    [12, 'mo'],
    [Infinity, 'y'],
  ];
  let value = seconds;
  for (const [size, label] of units) {
    if (value < size) return `${Math.max(1, Math.floor(value))}${label} ago`;
    value /= size;
  }
  return formatDate(iso);
}

export function explorerTxUrl(signature: string, cluster = 'devnet'): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export function explorerAddressUrl(address: string, cluster = 'devnet'): string {
  return `https://explorer.solana.com/address/${address}?cluster=${cluster}`;
}
