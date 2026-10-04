import { expect, test } from '@playwright/test';

test('landing page has one clear call to action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /start the demo/i })).toBeVisible();
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
