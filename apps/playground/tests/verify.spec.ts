import { expect, test } from '@playwright/test';
import { VERIFY_EXAMPLES } from '../src/lib/verify-examples';

// Live: these hit real Solana devnet and the real public receipt store (needs BLOB_READ_WRITE_TOKEN
// in apps/playground/.env.local). Not run in CI, which has neither.
test.describe.configure({ timeout: 60_000 });

const result = (page: import('@playwright/test').Page) => page.getByTestId('verify-result');

test('a proven payment: PROVEN with signers, limits, decision, anchor and Explorer links', async ({ page }) => {
  await page.goto('/verify');
  await page.getByRole('button', { name: new RegExp(VERIFY_EXAMPLES.proven.label, 'i') }).click();
  await expect(result(page)).toHaveAttribute('data-verdict', 'PROVEN', { timeout: 45_000 });
  await expect(result(page)).toContainText('PROVEN: this payment was allowed');
  await expect(result(page)).toContainText('owner');
  await expect(result(page)).toContainText('approver');
  await expect(result(page)).toContainText('with human approval');
  await expect(result(page)).toContainText('anchor_root');
  await expect(result(page).getByRole('link', { name: /Solana Explorer/ })).toHaveCount(2); // the payment and its anchor
  await expect(result(page).getByText('FAIL')).toHaveCount(0);
});

test('a blocked attempt: BLOCKED, no payment, with the rules that refused it', async ({ page }) => {
  await page.goto('/verify');
  await page.getByRole('button', { name: new RegExp(VERIFY_EXAMPLES.blocked.label, 'i') }).click();
  await expect(result(page)).toHaveAttribute('data-verdict', 'BLOCKED', { timeout: 45_000 });
  await expect(result(page)).toContainText('no payment was ever made');
  await expect(result(page)).toContainText('PAYTO_ALLOWED');
});

test('a random devnet USDC transfer: NO PROOF', async ({ page }) => {
  await page.goto('/verify');
  await page.getByRole('button', { name: new RegExp(VERIFY_EXAMPLES.random.label, 'i') }).click();
  await expect(result(page)).toHaveAttribute('data-verdict', 'NO_PROOF', { timeout: 45_000 });
  await expect(result(page)).toContainText('This payment carries no Atlas Rail proof of permission.');
});

test('a deep link (?tx=) runs the check on load, and nothing overflows at 360px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/verify?tx=${VERIFY_EXAMPLES.proven.tx}`);
  await expect(result(page)).toHaveAttribute('data-verdict', 'PROVEN', { timeout: 45_000 });
  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflowing).toBe(false);
});
