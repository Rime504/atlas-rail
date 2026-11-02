import { createPrivateKey, sign } from 'crypto';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DevnetKeypairSigner,
  FundableChain,
  Web3ChainClient,
  checkChannelSettlement,
  summarizeTransaction,
  ensureAta,
  ensureMint,
  ensureSol,
  mintTokens,
} from '@atlas-rail/solana';
import { createMockValidator } from './server';

/**
 * Runs the real `@solana/web3.js` client stack (the same code that talks to devnet) against the mock
 * JSON-RPC server: demo asset setup with real instructions, a payment-channels voucher settle, and
 * the settlement and anchor checks that receipt verification depends on.
 */

const ED25519_PROGRAM = 'Ed25519SigVerify111111111111111111111111111';
const CHANNEL_PROGRAM = 'CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX';
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111';

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

/** Detached Ed25519 signature over the voucher bytes. The fee payer signs the transaction, not this. */
function voucherSignature(message: Uint8Array, secretKey: Uint8Array): Buffer {
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const key = createPrivateKey({
    key: Buffer.concat([pkcs8Prefix, Buffer.from(secretKey.subarray(0, 32))]),
    format: 'der',
    type: 'pkcs8',
  });
  return sign(null, message, key);
}

/**
 * Ed25519 precompile plus payment-channels settle (discriminator 2). No SPL transfer.
 * The voucher public key is inside the precompile; only the fee payer signs the transaction.
 */
function buildVoucherSettleTransaction(params: {
  voucher: Keypair;
  feePayer: string;
  recentBlockhash: string;
  message?: Buffer;
}): VersionedTransaction {
  const message = params.message ?? Buffer.from('voucher');
  const signature = voucherSignature(message, params.voucher.secretKey);
  const pubkeyOffset = 16;
  const signatureOffset = 48;
  const messageOffset = 112;
  const data = Buffer.alloc(messageOffset + message.length);
  data[0] = 1;
  data.writeUInt16LE(signatureOffset, 2);
  data.writeUInt16LE(0xffff, 4);
  data.writeUInt16LE(pubkeyOffset, 6);
  data.writeUInt16LE(0xffff, 8);
  data.writeUInt16LE(messageOffset, 10);
  data.writeUInt16LE(message.length, 12);
  data.writeUInt16LE(0xffff, 14);
  Buffer.from(params.voucher.publicKey.toBytes()).copy(data, pubkeyOffset);
  signature.copy(data, signatureOffset);
  message.copy(data, messageOffset);

  const compiled = new TransactionMessage({
    payerKey: new PublicKey(params.feePayer),
    recentBlockhash: params.recentBlockhash,
    instructions: [
      new TransactionInstruction({ programId: new PublicKey(ED25519_PROGRAM), keys: [], data }),
      new TransactionInstruction({
        programId: new PublicKey(CHANNEL_PROGRAM),
        keys: [
          { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
          { pubkey: new PublicKey(INSTRUCTIONS_SYSVAR), isSigner: false, isWritable: false },
        ],
        data: Buffer.from([2]),
      }),
    ],
  }).compileToV0Message();
  return new VersionedTransaction(compiled);
}

describe('mock validator over JSON-RPC', () => {
  it('runs demo asset setup with real instructions, then a voucher settle, and both checks pass', async () => {
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

    // Payment: Ed25519 precompile plus payment-channels settle. It does not move tokens.
    const { blockhash } = await client.getLatestBlockhash();
    const tx = buildVoucherSettleTransaction({
      voucher: agent,
      feePayer: facilitator.publicKey.toBase58(),
      recentBlockhash: blockhash,
    });
    const unsigned = Buffer.from(tx.serialize()).toString('base64');
    const preview = checkChannelSettlement(summarizeTransaction('preview', tx, { slot: null, blockTime: null, err: null }));
    expect(preview).toMatchObject({ ok: true, payer: agent.publicKey.toBase58() });

    const simulation = await client.simulate(unsigned);
    expect(simulation).toMatchObject({ success: true, error: null });

    const signed = await new DevnetKeypairSigner(facilitator.secretKey).signTransaction(unsigned);
    const signature = await client.sendAndConfirm(signed.signedBase64);

    const summary = await client.getTransactionSummary(signature);
    expect(summary?.tokenTransfers).toHaveLength(0);
    const settled = checkChannelSettlement(summary);
    expect(settled).toMatchObject({ ok: true, payer: agent.publicKey.toBase58() });
    expect(chain.tokenBalance(merchant.publicKey.toBase58(), mint.publicKey.toBase58())).toBe(0n);
    expect(chain.tokenBalance(agent.publicKey.toBase58(), mint.publicKey.toBase58())).toBe(100_000_000n);
  });

  it('rejects a replayed transaction, an unsigned fee payer, and a settle from an empty fee payer', async () => {
    const { client } = await boot();
    const funder = Keypair.generate();
    const mint = Keypair.generate();
    const merchant = Keypair.generate();
    const facilitator = Keypair.generate();
    const agent = Keypair.generate();
    await ensureSol(client, funder.publicKey.toBase58(), 2_000_000_000n);
    await ensureMint(client, funder, mint, 6);
    await ensureAta(client, funder, agent.publicKey.toBase58(), mint.publicKey.toBase58());
    await ensureAta(client, funder, merchant.publicKey.toBase58(), mint.publicKey.toBase58());

    const { blockhash } = await client.getLatestBlockhash();
    const build = () =>
      Buffer.from(
        buildVoucherSettleTransaction({
          voucher: agent,
          feePayer: facilitator.publicKey.toBase58(),
          recentBlockhash: blockhash,
        }).serialize(),
      ).toString('base64');

    const facilitatorSigner = new DevnetKeypairSigner(facilitator.secretKey);

    // The fee payer account does not exist yet: simulation and submission both fail.
    const empty = build();
    expect((await client.simulate(empty)).success).toBe(false);
    const signedEmpty = (await facilitatorSigner.signTransaction(empty)).signedBase64;
    await expect(client.sendAndConfirm(signedEmpty)).rejects.toThrow(/AccountNotFound|InsufficientFunds|failed/);

    // Fund the fee payer, settle once, then replay the exact same bytes.
    await ensureSol(client, facilitator.publicKey.toBase58(), 500_000_000n);
    const good = build();
    const signed = (await facilitatorSigner.signTransaction(good)).signedBase64;
    await client.sendAndConfirm(signed);
    await expect(client.sendAndConfirm(signed)).rejects.toThrow();

    // Missing fee-payer signature is refused.
    await expect(client.sendAndConfirm(build())).rejects.toThrow(/Signature|failed/i);
  });

  it('refuses to be used as a mainnet endpoint stand-in by name', async () => {
    expect(() => Web3ChainClient.fromUrl('https://api.mainnet-beta.solana.com')).toThrow(/Mainnet/i);
  });
});
