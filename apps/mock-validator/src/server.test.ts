import { Keypair } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DevnetKeypairSigner,
  FundableChain,
  Web3ChainClient,
  analyzeExactPaymentTransaction,
  buildExactPaymentTransaction,
  checkMemoAnchor,
  checkSettlement,
  buildAnchorTransaction,
  ensureAta,
  ensureMint,
  ensureSol,
  mintTokens,
} from '@atlas-rail/solana';
import { createMockValidator } from './server';

/**
 * Runs the real `@solana/web3.js` client stack (the same code that talks to devnet) against the mock
 * JSON-RPC server: demo asset setup with real instructions, an x402 payment, and the settlement and
 * anchor checks that receipt verification depends on.
 */

const originalEnv = { ...process.env };
let close: () => Promise<unknown>;

beforeEach(() => {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  process.env.NODE_ENV = 'test';
});
afterEach(async () => {
  process.env = { ...originalEnv };
  await close?.();
});

async function boot() {
  const { app, chain } = createMockValidator();
  await app.listen({ port: 0, host: '127.0.0.1' });
  close = () => app.close();
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const client = Web3ChainClient.fromUrl(`http://127.0.0.1:${port}`);
  return { chain, client: client as unknown as FundableChain, url: `http://127.0.0.1:${port}` };
}

describe('mock validator over JSON-RPC', () => {
  it('runs demo asset setup with real instructions, then an x402 payment, and both checks pass', async () => {
    const { client, chain } = await boot();
    const funder = Keypair.generate();
    const mint = Keypair.generate();
    const merchant = Keypair.generate();
    const facilitator = Keypair.generate();
    const agent = Keypair.generate();

    await ensureSol(client, funder.publicKey.toBase58(), 2_000_000_000n);
    await ensureSol(client, facilitator.publicKey.toBase58(), 500_000_000n);
    expect(await client.getBalanceLamports(funder.publicKey.toBase58())).toBeGreaterThanOrEqual(2_000_000_000n);

    expect(await ensureMint(client, funder, mint, 6)).toBe(true);
    expect(await ensureMint(client, funder, mint, 6)).toBe(false); // idempotent
    expect(await client.getMintInfo(mint.publicKey.toBase58())).toEqual({ decimals: 6, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' });

    await mintTokens(client, funder, funder, mint.publicKey.toBase58(), agent.publicKey.toBase58(), 100_000_000n);
    await ensureAta(client, funder, merchant.publicKey.toBase58(), mint.publicKey.toBase58());
    expect(chain.tokenBalance(agent.publicKey.toBase58(), mint.publicKey.toBase58())).toBe(100_000_000n);

    // Payment: exactly what the x402 client and the official facilitator produce.
    const { blockhash } = await client.getLatestBlockhash();
    const tx = buildExactPaymentTransaction({
      payer: agent.publicKey.toBase58(),
      feePayer: facilitator.publicKey.toBase58(),
      mint: mint.publicKey.toBase58(),
      decimals: 6,
      payTo: merchant.publicKey.toBase58(),
      amountBaseUnits: '10000',
      recentBlockhash: blockhash,
    });
    const unsigned = Buffer.from(tx.serialize()).toString('base64');
    const analysis = analyzeExactPaymentTransaction(unsigned, {
      payer: agent.publicKey.toBase58(),
      payTo: merchant.publicKey.toBase58(),
      mint: mint.publicKey.toBase58(),
      amountBaseUnits: '10000',
      feePayer: facilitator.publicKey.toBase58(),
    });
    expect(analysis.matchesOffer).toBe(true);

    const simulation = await client.simulate(unsigned);
    expect(simulation).toMatchObject({ success: true, error: null });

    const agentSigned = await new DevnetKeypairSigner(agent.secretKey).signTransaction(unsigned);
    const bothSigned = await new DevnetKeypairSigner(facilitator.secretKey).signTransaction(agentSigned.signedBase64);
    const signature = await client.sendAndConfirm(bothSigned.signedBase64);

    const summary = await client.getTransactionSummary(signature);
    expect(summary?.tokenTransfers).toHaveLength(1);
    const settled = checkSettlement(summary, { payTo: merchant.publicKey.toBase58(), mint: mint.publicKey.toBase58(), amountBaseUnits: '10000' });
    expect(settled).toMatchObject({ ok: true, payer: agent.publicKey.toBase58() });
    expect(chain.tokenBalance(merchant.publicKey.toBase58(), mint.publicKey.toBase58())).toBe(10_000n);

    // Anchor memo signed by the instance key.
    const instance = Keypair.generate();
    await ensureSol(client, instance.publicKey.toBase58(), 100_000_000n);
    const anchorTx = buildAnchorTransaction({ signer: instance.publicKey.toBase58(), memo: 'atlasrail:anchor:v1:test', recentBlockhash: (await client.getLatestBlockhash()).blockhash });
    const signedAnchor = await new DevnetKeypairSigner(instance.secretKey).signTransaction(anchorTx);
    const anchorSig = await client.sendAndConfirm(signedAnchor.signedBase64);
    const anchorCheck = checkMemoAnchor(await client.getTransactionSummary(anchorSig), { memo: 'atlasrail:anchor:v1:test', signer: instance.publicKey.toBase58() });
    expect(anchorCheck.ok).toBe(true);
  });

  it('rejects a replayed transaction, an unsigned fee payer, and a payment from an empty account', async () => {
    const { client } = await boot();
    const funder = Keypair.generate();
    const mint = Keypair.generate();
    const merchant = Keypair.generate();
    const facilitator = Keypair.generate();
    const agent = Keypair.generate();
    await ensureSol(client, funder.publicKey.toBase58(), 2_000_000_000n);
    await ensureSol(client, facilitator.publicKey.toBase58(), 500_000_000n);
    await ensureMint(client, funder, mint, 6);
    await ensureAta(client, funder, agent.publicKey.toBase58(), mint.publicKey.toBase58());
    await ensureAta(client, funder, merchant.publicKey.toBase58(), mint.publicKey.toBase58());

    const { blockhash } = await client.getLatestBlockhash();
    const build = () =>
      Buffer.from(
        buildExactPaymentTransaction({
          payer: agent.publicKey.toBase58(),
          feePayer: facilitator.publicKey.toBase58(),
          mint: mint.publicKey.toBase58(),
          decimals: 6,
          payTo: merchant.publicKey.toBase58(),
          amountBaseUnits: '10000',
          recentBlockhash: blockhash,
        }).serialize(),
      ).toString('base64');

    const agentSigner = new DevnetKeypairSigner(agent.secretKey);
    const facilitatorSigner = new DevnetKeypairSigner(facilitator.secretKey);

    // The agent holds no tokens: simulation and submission both fail.
    const empty = build();
    expect((await client.simulate(empty)).success).toBe(false);
    const both = (await facilitatorSigner.signTransaction((await agentSigner.signTransaction(empty)).signedBase64)).signedBase64;
    await expect(client.sendAndConfirm(both)).rejects.toThrow(/InsufficientFunds|failed/);

    // Fund it, pay once, then replay the exact same bytes.
    await mintTokens(client, funder, funder, mint.publicKey.toBase58(), agent.publicKey.toBase58(), 1_000_000n);
    const good = build();
    const signed = (await facilitatorSigner.signTransaction((await agentSigner.signTransaction(good)).signedBase64)).signedBase64;
    await client.sendAndConfirm(signed);
    await expect(client.sendAndConfirm(signed)).rejects.toThrow();

    // Missing fee-payer signature is refused.
    const agentOnly = (await agentSigner.signTransaction(build())).signedBase64;
    await expect(client.sendAndConfirm(agentOnly)).rejects.toThrow(/Signature|failed/i);
  });

  it('refuses to be used as a mainnet endpoint stand-in by name', async () => {
    expect(() => Web3ChainClient.fromUrl('https://api.mainnet-beta.solana.com')).toThrow(/Mainnet/i);
  });
});
