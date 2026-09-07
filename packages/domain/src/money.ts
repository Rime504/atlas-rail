/**
 * Converts a decimal string representation (e.g. "125.50") to base units (e.g. "125500000" for 6 decimals).
 * Never uses floating point arithmetic.
 */
export function parseDisplayToBaseUnits(amountStr: string, decimals = 6): string {
  const trimmed = amountStr.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal amount format: "${amountStr}"`);
  }

  const [integerPart, fractionalPart = ''] = trimmed.split('.');

  if (fractionalPart.length > decimals) {
    throw new Error(`Amount exceeds maximum supported precision of ${decimals} decimals`);
  }

  const paddedFraction = fractionalPart.padEnd(decimals, '0');
  const combined = `${integerPart}${paddedFraction}`.replace(/^0+/, '');

  return combined === '' ? '0' : combined;
}

/**
 * Formats integer base units (e.g. "125500000") to display string ("125.500000").
 */
export function formatBaseUnitsToDisplay(baseUnits: string, decimals = 6): string {
  const clean = baseUnits.trim().replace(/^0+/, '') || '0';
  const padded = clean.padStart(decimals + 1, '0');
  const integerPart = padded.slice(0, padded.length - decimals);
  const fractionalPart = padded.slice(padded.length - decimals);

  return `${integerPart}.${fractionalPart}`;
}

export function compareBaseUnits(a: string, b: string): number {
  const bigintA = BigInt(a);
  const bigintB = BigInt(b);

  if (bigintA < bigintB) return -1;
  if (bigintA > bigintB) return 1;
  return 0;
}

export function addBaseUnits(a: string, b: string): string {
  return (BigInt(a) + BigInt(b)).toString();
}

export function subtractBaseUnits(a: string, b: string): string {
  const result = BigInt(a) - BigInt(b);
  if (result < 0n) {
    throw new Error('Base unit subtraction resulted in negative balance');
  }
  return result.toString();
}
