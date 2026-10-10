/** Human-facing formatting shared across the playground's steps and rule details — amounts are
 * always shown in dollars, never as raw base units, and addresses are always shortened. */

/** The demo's mint (Circle devnet USDC) uses 6 decimals, same as real USDC. */
export const DEMO_MINT_DECIMALS = 6;

export function formatUsd(baseUnits: string | number | bigint, decimals = DEMO_MINT_DECIMALS): string {
  const units = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits);
  const value = Number(units) / 10 ** decimals;
  // At least cents, and as many more digits as the amount needs: a $0.015 tolerance must not read "$0.02".
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: decimals });
}

/** Rule-detail fields that hold token amounts in base units. */
const MONEY_FIELDS = new Set([
  'amount',
  'maxPerPayment',
  'maxPerWindow',
  'maxTotal',
  'spentInWindow',
  'spentTotal',
  'projected',
  'threshold',
  'expectedPrice',
  'toleratedCeiling',
  'hardMax',
]);

/** A rule's recorded values for display: the same keys, with every amount shown in dollars. */
export function detailsInDollars(details: Record<string, unknown>, decimals = DEMO_MINT_DECIMALS): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      MONEY_FIELDS.has(key) && typeof value === 'string' && /^\d+$/.test(value) ? formatUsd(value, decimals) : value,
    ]),
  );
}

export function shortAddress(value: string, chars = 6): string {
  return value.length > chars * 2 + 1 ? `${value.slice(0, chars)}…${value.slice(-chars)}` : value;
}
