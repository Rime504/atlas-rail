import { AtlasRailClient } from '@atlas-rail/api-client';

async function runExample() {
  console.info('🚀 Initializing Atlas Rail Node.js API Client Example...');

  const client = new AtlasRailClient({
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
    apiKey: process.env.ATLAS_API_KEY || 'atk_demo_example_key',
  });

  try {
    console.info('1. Fetching registered devnet treasuries...');
    const treasuries = await client.getTreasuries();
    console.info('   Treasuries:', treasuries);

    console.info('2. Drafting a new USDC payout request with idempotency key...');
    const idempotencyKey = `idem-example-${Date.now()}`;
    const payout = await client.createPayout(
      {
        treasuryId: treasuries[0]?.id || 'trs_demo',
        recipientId: 'rec_demo',
        amountBaseUnits: '250000000', // 250 USDC
        invoiceReference: 'INV-NODE-001',
        memo: 'Node Client Example Payment',
      },
      idempotencyKey,
    );
    console.info('   Payout Created:', payout);
  } catch (err: any) {
    console.info('   Note: Run API server before executing client script:', err.message);
  }
}

runExample();
