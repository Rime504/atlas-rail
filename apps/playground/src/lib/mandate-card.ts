import { EXPECTED_PRICE, MAX_PER_PAYMENT, MAX_PER_WINDOW, MAX_TOTAL } from './amounts';
import { formatUsd } from './format';

/** The limits on step 2's mandate card, in the order shown. Safe to import from a client component. */
export function mandateCardTiles(): Array<{ label: string; value: string; wide?: boolean }> {
  return [
    { label: 'Max per payment', value: formatUsd(MAX_PER_PAYMENT) },
    { label: 'Max per hour', value: formatUsd(MAX_PER_WINDOW) },
    { label: 'Lifetime total', value: formatUsd(MAX_TOTAL) },
    { label: 'Allowed sellers', value: '2 research sellers' },
    { label: 'Research call price', value: `about ${formatUsd(EXPECTED_PRICE)}`, wide: true },
  ];
}
