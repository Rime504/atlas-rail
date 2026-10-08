import { expect, test } from '@playwright/test';

const result = (page: import('@playwright/test').Page) => page.getByTestId('break-result');

async function send(page: import('@playwright/test').Page, attack: RegExp, amount?: string) {
  await page.goto('/break');
  await page.getByRole('radio', { name: attack }).click();
  if (amount) await page.getByLabel(/amount, in usd|each slice/i).fill(amount);
  await page.getByRole('button', { name: /send the attack/i }).click();
}

test('pay a stranger: blocked by the payee rule, with a signed decision', async ({ page }) => {
  await send(page, /pay a stranger/i);
  await expect(result(page)).toHaveAttribute('data-verdict', 'DENY');
  await expect(result(page)).toContainText('Blocked');
  await page.getByRole('button', { name: /show the signed decision/i }).click();
  await expect(result(page)).toContainText('signature');
});

test('overcharge: blocked by the price limit', async ({ page }) => {
  await send(page, /overcharge/i);
  await expect(result(page)).toHaveAttribute('data-verdict', 'DENY');
  await expect(result(page)).toContainText('price is above the hard maximum');
});

test('split into small payments: only the signed hourly budget gets through, then every slice is stopped', async ({ page }) => {
  await send(page, /split into small payments/i);
  await expect(result(page)).toContainText('4 of 10 slices were inside the mandate ($20.00');
  await expect(result(page)).toHaveAttribute('data-verdict', 'ESCALATE');
});

test('pay after revoke: blocked', async ({ page }) => {
  await send(page, /pay after revoke/i);
  await expect(result(page)).toHaveAttribute('data-verdict', 'DENY');
  await expect(result(page)).toContainText('revoked');
});

test('a bad recipient is refused with a plain message, and nothing overflows at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/break');
  await page.getByPlaceholder('Any Solana address').fill('not-an-address');
  await page.getByRole('button', { name: /send the attack/i }).click();
  await expect(page.getByText('Recipient must be a Solana address')).toBeVisible();
  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowing).toBe(false);
});
