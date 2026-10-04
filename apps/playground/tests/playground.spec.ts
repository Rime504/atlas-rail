import { expect, test } from '@playwright/test';

test('landing page has one clear call to action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /start the demo/i })).toBeVisible();
});

test('progress bar announces the step count, with the percentage kept separate for screen readers', async ({ page }) => {
  await page.goto('/demo');
  const progressbar = page.getByRole('progressbar');
  // The accessible name/value must read "Step 1 of 8" with no percentage mixed in — the percentage
  // is sighted-only, decorative, and excluded from the accessibility tree (aria-hidden on its row).
  await expect(progressbar).toHaveAccessibleName('Walkthrough progress');
  await expect(progressbar).toHaveAttribute('aria-valuetext', 'Step 1 of 8');
  await expect(progressbar).toHaveAttribute('aria-valuenow', '1');
  await expect(progressbar).toHaveAttribute('aria-valuemin', '1');
  await expect(progressbar).toHaveAttribute('aria-valuemax', '8');
  // The visible "Step 1 of 8 / 13%" row must not also be exposed to the accessibility tree —
  // otherwise it would be announced a second time, redundantly, right next to the progressbar.
  await expect(page.locator('[aria-hidden="true"]').filter({ hasText: 'Step 1 of 8' })).toBeVisible();
});

test('walks through all 8 steps end to end', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /start the demo/i }).click();
  await expect(page).toHaveURL(/\/demo$/);

  // Step 1: Meet the agent
  await expect(page.getByText('Meet the agent')).toBeVisible();
  await expect(page.getByText('Research Agent', { exact: true })).toBeVisible();
  await expect(page.getByText('Wallet address')).toBeVisible();
  await page.getByRole('button', { name: /^next$/i }).click();

  // Step 2: Give it rules
  await expect(page.getByText('Give it rules')).toBeVisible();
  await expect(page.getByText('$5.00')).toBeVisible();
  await page.getByRole('button', { name: /sign and register on solana/i }).click();
  await expect(page.getByTestId('verdict-banner')).toContainText('Signed by owner, approver and agent');
  await page.getByRole('button', { name: /^next$/i }).click();

  // Step 3: A normal payment
  await expect(page.getByText('A normal payment')).toBeVisible();
  await page.getByRole('button', { name: /run the payment/i }).click();
  await expect(page.getByTestId('verdict-banner')).toHaveAttribute('data-verdict', 'ALLOW');
  await page.getByRole('button', { name: /^next$/i }).click();

  // Step 4: An attack
  await expect(page.getByText('An attack')).toBeVisible();
  await page.getByRole('button', { name: /let the compromised agent try to pay/i }).click();
  const attackVerdict = page.getByTestId('verdict-banner');
  await expect(attackVerdict).toHaveAttribute('data-verdict', 'DENY');
  await expect(attackVerdict).toContainText('seller not on the list');
  await page.getByRole('button', { name: /^next$/i }).click();

  // Step 5: Price spike (both zones)
  await expect(page.getByText('Price spike')).toBeVisible();
  await page.getByRole('button', { name: /charge \$0\.02 instead/i }).click();
  await expect(page.getByTestId('verdict-banner').first()).toHaveAttribute('data-verdict', 'ESCALATE');
  await page.getByRole('button', { name: /charge \$0\.05 instead/i }).click();
  await expect(page.getByTestId('verdict-banner').nth(1)).toHaveAttribute('data-verdict', 'DENY');
  await page.getByRole('button', { name: /^next$/i }).click();

  // Step 6: You are the human
  await expect(page.getByText('You are the human')).toBeVisible();
  await page.getByRole('button', { name: /^approve$/i }).click();
  const humanVerdict = page.getByTestId('verdict-banner');
  await expect(humanVerdict).toHaveAttribute('data-verdict', 'ALLOW');
  await expect(humanVerdict).toContainText('the human approved it');
  await page.getByRole('button', { name: /^next$/i }).click();

  // Step 7: Proof
  await expect(page.getByText('Proof', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /verify this receipt/i }).click();
  await expect(page.getByText('PASS').first()).toBeVisible();
  await expect(page.locator('li', { hasText: 'FAIL' })).toHaveCount(0);
  await page.getByRole('button', { name: /^next$/i }).click();

  // Step 8: Revoke
  await expect(page.getByText('Revoke', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /revoke on solana/i }).click();
  await expect(page.getByTestId('verdict-banner')).toContainText('Mandate revoked');
  await page.getByRole('button', { name: /try the payment again/i }).click();
  const finalVerdict = page.getByTestId('verdict-banner').last();
  await expect(finalVerdict).toHaveAttribute('data-verdict', 'DENY');
  await expect(finalVerdict).toContainText('revoked');

  // End screen
  await page.getByRole('button', { name: /^finish$/i }).click();
  await expect(page.getByRole('heading', { name: /that.s atlas rail/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /view the code/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /run it again/i })).toBeVisible();
});

test('back button returns to the previous step without losing state', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^next$/i }).click(); // step 1 -> 2
  await expect(page.getByText('Give it rules')).toBeVisible();
  await page.getByRole('button', { name: /^back$/i }).click();
  await expect(page.getByText('Meet the agent')).toBeVisible();
});

test('the mode badge is visible and consistent across steps, not just on the toggle step', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.getByText('Instant mode (no chain)')).toBeVisible();
  await page.getByRole('button', { name: /^next$/i }).click(); // step 1 -> 2
  await expect(page.getByText('Instant mode (no chain)')).toBeVisible();
  await page.getByRole('button', { name: /sign and register on solana/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click(); // step 2 -> 3
  await expect(page.getByText('Instant mode (no chain)')).toBeVisible();
});

test('a vacuous price-limit pass (no limit configured for this resource) is shown as not applicable, never a plain pass', async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: /^next$/i }).click(); // step 1 -> 2
  await page.getByRole('button', { name: /sign and register on solana/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click(); // step 2 -> 3
  await page.getByRole('button', { name: /run the payment/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click(); // step 3 -> 4
  await page.getByRole('button', { name: /let the compromised agent try to pay/i }).click();
  await page.getByRole('button', { name: /show the rules it was checked against/i }).click();
  await expect(page.getByText('No price limit applies to this resource')).toBeVisible();
});

test('no step causes horizontal page overflow at a 360px viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const assertNoOverflow = async () => {
    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflowing).toBe(false);
  };

  await page.goto('/');
  await assertNoOverflow();
  await page.getByRole('link', { name: /start the demo/i }).click();

  await assertNoOverflow(); // step 1
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow(); // step 2
  await page.getByRole('button', { name: /sign and register on solana/i }).click();
  await page.getByRole('button', { name: /show the signed mandate/i }).click();
  await assertNoOverflow(); // step 2, mandate expanded (full-length addresses rendered)
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow(); // step 3
  await page.getByRole('button', { name: /run the payment/i }).click();
  await page.getByRole('button', { name: /show the rules it was checked against/i }).click();
  await assertNoOverflow(); // step 3, rules expanded
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow(); // step 4
  await page.getByRole('button', { name: /let the compromised agent try to pay/i }).click();
  await assertNoOverflow();
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow(); // step 5
  await page.getByRole('button', { name: /charge \$0\.02 instead/i }).click();
  await page.getByRole('button', { name: /charge \$0\.05 instead/i }).click();
  await assertNoOverflow();
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow(); // step 6
  await page.getByRole('button', { name: /^approve$/i }).click();
  await assertNoOverflow();
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow(); // step 7
  await page.getByRole('button', { name: /verify this receipt/i }).click();
  await assertNoOverflow();
  await page.getByRole('button', { name: /show the raw receipt/i }).click();
  await assertNoOverflow(); // raw receipt JSON dump, the longest content on the page
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow(); // step 8
  await page.getByRole('button', { name: /revoke on solana/i }).click();
  await assertNoOverflow();
});
