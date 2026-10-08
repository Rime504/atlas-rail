/** Human-facing formatting shared across the playground's steps and rule details — amounts are
 * always shown in dollars, never as raw base units, and addresses are always shortened. */

/** The demo's mint (Circle devnet USDC) uses 6 decimals, same as real USDC. */
export const DEMO_MINT_DECIMALS = 6;

export function formatUsd(baseUnits: string | number | bigint, decimals = DEMO_MINT_DECIMALS): string {
  const units = typeof baseUnits === 'bigint' ? baseUnits : BigInt(baseUnits);
  const value = Number(units) / 10 ** decimals;
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortAddress(value: string, chars = 6): string {
  return value.length > chars * 2 + 1 ? `${value.slice(0, chars)}…${value.slice(-chars)}` : value;
}
