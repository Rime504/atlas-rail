// Real screenshots of the live playground (real Solana devnet mode) for the launch video.
// Saves public/shots/*.png plus public/shots/shots.json with each key phrase's box, so the video
// zooms onto real UI. Nothing here is mocked: every frame is the deployed playground.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://atlas-rail-playground.vercel.app';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'shots');
const VIEWPORT = { width: 1440, height: 900 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shots = [];
let publication = null;
page.on('response', async (r) => {
  if (r.url().endsWith('/api/step')) {
    try {
      const body = await r.json();
      if (body.publication) publication = body.publication;
    } catch {}
  }
});

async function shot(p, name, focus) {
  await focus.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -120)); // keep the step header in frame
  await p.waitForTimeout(700); // let entrance animations settle
  const box = await focus.boundingBox();
  await p.screenshot({ path: join(OUT, `${name}.png`) });
  shots.push({ name, file: `shots/${name}.png`, width: VIEWPORT.width, height: VIEWPORT.height, focus: box });
  console.log(`captured ${name}`, box && Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)])));
}

const next = () => page.getByRole('button', { name: /^next$/i }).click();
const banners = (k) => page.waitForFunction((k) => document.querySelectorAll('[data-testid="verdict-banner"]').length >= k, k, { timeout: 120000 });

await page.goto(BASE, { waitUntil: 'networkidle' });
await shot(page, '1-landing', page.locator('h1'));

await page.goto(`${BASE}/demo`);
const toggle = page.getByLabel('Use real Solana devnet');
await toggle.waitFor();
await toggle.click();
await page.waitForFunction(() => !document.body.innerText.includes('Switching mode'), null, { timeout: 120000 });
await next();
await page.getByRole('button', { name: /sign and register on solana/i }).click();
await page.waitForSelector('text=Signed by owner, approver and agent', { timeout: 120000 });
await shot(page, '2-permission', page.getByTestId('verdict-banner'));

await next();
await page.getByRole('button', { name: /run the payment/i }).click();
await banners(1);

await next();
await page.getByRole('button', { name: /let the compromised agent try to pay/i }).click();
await banners(1);
await shot(page, '3-gate', page.getByTestId('verdict-banner'));

await next();
await page.getByRole('button', { name: /charge \$0\.02 instead/i }).click();
await banners(1);
await shot(page, '4-human', page.getByTestId('verdict-banner'));
await page.getByRole('button', { name: /charge \$0\.05 instead/i }).click();
await banners(2);

await next();
await page.getByRole('button', { name: /^approve$/i }).waitFor();
await shot(page, '5-approve', page.getByRole('button', { name: /^approve$/i }));
await page.getByRole('button', { name: /^approve$/i }).click();
await banners(1);

await next();
await page.getByRole('button', { name: /verify this receipt/i }).click();
await page.waitForSelector('text=PASS', { timeout: 180000 });
await page.waitForTimeout(1500);
if (!publication?.stored) throw new Error(`receipt was not published: ${JSON.stringify(publication)}`);

const verify = await ctx.newPage();
await verify.goto(`${BASE}/verify?tx=${publication.txSignature}`);
const result = verify.getByTestId('verify-result');
await result.waitFor({ timeout: 120000 });
if ((await result.getAttribute('data-verdict')) !== 'PROVEN') throw new Error('verify did not say PROVEN');
await shot(verify, '6-proof', verify.getByText('PROVEN: this payment was allowed'));

await next();
await page.getByRole('button', { name: /revoke on solana/i }).click();
await page.waitForSelector('text=Mandate revoked', { timeout: 120000 });
await page.getByRole('button', { name: /try the payment again/i }).click();
await banners(2);
await shot(page, '7-revoke', page.getByTestId('verdict-banner').nth(1));

writeFileSync(join(OUT, 'shots.json'), JSON.stringify({ capturedAt: new Date().toISOString(), txSignature: publication.txSignature, shots }, null, 2));
await browser.close();
console.log('verified payment', publication.txSignature);
