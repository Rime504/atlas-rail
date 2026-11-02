import { expect, test, type Page } from '@playwright/test';

async function openDemo(page: Page) {
  await page.addInitScript(() => {
    const key = { toBase58: () => 'GTN6eKeP1111111111111111111111111111111111' };
    (window as unknown as { solana: { connect: () => Promise<{ publicKey: { toBase58: () => string } }> } }).solana = {
      connect: async () => ({ publicKey: key }),
    };
  });
  await page.goto('/demo');
}

test('landing page has one clear call to action', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /start the demo/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /verify a real payment/i })).toHaveAttribute('href', '/verify');
  await expect(page.getByRole('link', { name: /watch an attack get blocked/i })).toHaveAttribute('href', '/break');
});

test('progress bar announces the step count, with the percentage kept separate for screen readers', async ({ page }) => {
  await page.goto('/demo');
  const progressbar = page.getByRole('progressbar');
  // The accessible name/value must read "Step 1 of 9" with no percentage mixed in — the percentage
  // is sighted-only, decorative, and excluded from the accessibility tree (aria-hidden on its row).
  await expect(progressbar).toHaveAccessibleName('Walkthrough progress');
  await expect(progressbar).toHaveAttribute('aria-valuetext', 'Step 1 of 4');
  await expect(progressbar).toHaveAttribute('aria-valuenow', '1');
  await expect(progressbar).toHaveAttribute('aria-valuemin', '1');
  await expect(progressbar).toHaveAttribute('aria-valuemax', '4');
  await expect(page.locator('[aria-hidden="true"]').filter({ hasText: 'Step 1 of 4' })).toBeVisible();
});

test('walks the voucher path and shows the settle and root links', async ({ page }) => {
  const payer = 'GTN6eKeP1111111111111111111111111111111111';
  const posts: { url: string; body: string }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') posts.push({ url: request.url(), body: request.postData() ?? '' });
  });
  await page.route('**/api/voucher-demo', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        payer: 'GTN6eKeP1111111111111111111111111111111111',
        channel: '7rQzEFbeUHR4SDCbUj6qyaF7obQXKR52LwGsiFqvJ1iM',
        channelExplorer: 'https://explorer.solana.com/address/7rQzEFbeUHR4SDCbUj6qyaF7obQXKR52LwGsiFqvJ1iM?cluster=devnet',
        denial: { signed: false, message: 'MandateDeniedError' },
        settleSignature: '5A6PE6BD33tWXhw4BPcaT1WBXoLMQBdvXAb6PRMgSwAcpxQD4ZCzbsGxpf16XAJm6vzp5h4v7rXz6g8ADCVdXcuW',
        settleExplorer: 'https://explorer.solana.com/tx/5A6PE6BD33tWXhw4BPcaT1WBXoLMQBdvXAb6PRMgSwAcpxQD4ZCzbsGxpf16XAJm6vzp5h4v7rXz6g8ADCVdXcuW?cluster=devnet',
        anchorSignature: 'BL6Ubi3oJt4mP4VpY9X8uasVYmJCYEm3M6SkeY341Y4tXrWyxZGNKF7VYjZMx41AbSEk6AbAt991NwM2gTRtQyW',
        anchorExplorer: 'https://explorer.solana.com/tx/BL6Ubi3oJt4mP4VpY9X8uasVYmJCYEm3M6SkeY341Y4tXrWyxZGNKF7VYjZMx41AbSEk6AbAt991NwM2gTRtQyW?cluster=devnet',
        rootPda: 'Fu9zto1sWKMTRdsVrn5nHtcJFb9rbMLw5QjJoBZmGsz5',
        rootExplorer: 'https://explorer.solana.com/address/Fu9zto1sWKMTRdsVrn5nHtcJFb9rbMLw5QjJoBZmGsz5?cluster=devnet',
        merkleRoot: 'c0c1c6e5165f4e1e1345a512d6c562165cb4727819e3610a1a11a808d33677c7',
        receiptId: 'rcp_e91f2e5fe1f8396b',
        deposit: '10000',
        settled: '10000',
      }),
    });
  });
  await page.addInitScript((address) => {
    const key = { toBase58: () => address };
    (window as unknown as { solana: { connect: () => Promise<{ publicKey: { toBase58: () => string } }> } }).solana = {
      connect: async () => ({ publicKey: key }),
    };
  }, payer);
  await page.goto('/');
  await page.getByRole('link', { name: /start the demo/i }).click();
  await expect(page).toHaveURL(/\/demo$/);

  await expect(page.getByRole('heading', { name: 'Connect your wallet' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^next$/i })).toBeDisabled();
  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click();

  await expect(page.getByRole('heading', { name: 'Create the mandate' })).toBeVisible();
  await expect(page.getByRole('button', { name: /pay on devnet/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^next$/i })).toBeDisabled();
  await page.getByRole('button', { name: /use these rules/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click();

  await expect(page.getByRole('heading', { name: 'Pay on devnet' })).toBeVisible();
  await page.getByRole('button', { name: /pay on devnet/i }).click();

  await expect(page.getByRole('heading', { name: 'Settled and anchored' })).toBeVisible();
  const demo = posts.filter((post) => post.url.includes('/api/voucher-demo'));
  expect(demo).toHaveLength(1);
  expect(JSON.parse(demo[0].body)).toEqual({ payer });
  expect(posts.some((post) => post.url.includes('/api/step'))).toBe(false);
  await expect(page.getByText('Refused (MandateDeniedError)')).toBeVisible();
  await expect(page.getByText('Attack was signed')).toHaveCount(0);
  await expect(page.getByText('MandateDeniedError')).toBeVisible();
  await expect(page.getByRole('link', { name: /view on solana explorer/i }).nth(1)).toHaveAttribute('href', /5A6PE6BD33tW/);
  await expect(page.getByRole('link', { name: /view on solana explorer/i }).nth(3)).toHaveAttribute('href', /Fu9zto1sWKMT/);
});

test('back button returns to the previous step without losing state', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click();
  await expect(page.getByRole('heading', { name: 'Create the mandate' })).toBeVisible();
  await page.getByRole('button', { name: /use these rules/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click();
  await expect(page.getByRole('heading', { name: 'Pay on devnet' })).toBeVisible();
  await page.getByRole('button', { name: /^back$/i }).click();
  await expect(page.getByRole('heading', { name: 'Create the mandate' })).toBeVisible();
});

test('no step causes horizontal page overflow at a 360px viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const assertNoOverflow = async () => {
    const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflowing).toBe(false);
  };

  await page.addInitScript(() => {
    const key = { toBase58: () => 'GTN6eKeP1111111111111111111111111111111111' };
    (window as unknown as { solana: { connect: () => Promise<{ publicKey: { toBase58: () => string } }> } }).solana = {
      connect: async () => ({ publicKey: key }),
    };
  });
  await page.goto('/');
  await assertNoOverflow();
  await page.getByRole('link', { name: /start the demo/i }).click();

  await assertNoOverflow();
  await page.getByRole('button', { name: /connect wallet/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow();
  await page.getByRole('button', { name: /use these rules/i }).click();
  await page.getByRole('button', { name: /^next$/i }).click();
  await assertNoOverflow();
});

test('share previews point at the real playground, and the landing page links to the website', async ({ page }) => {
  await page.goto('/');
  for (const property of ['og:image', 'og:url']) {
    const content = await page.locator(`meta[property="${property}"]`).first().getAttribute('content');
    expect(new URL(content!).origin, property).toBe('https://atlas-rail-playground.vercel.app');
  }
  await expect(page.getByRole('link', { name: 'Website' })).toHaveAttribute('href', 'https://atlas-rail-site.vercel.app');
});
