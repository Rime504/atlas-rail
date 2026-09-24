import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DevnetKeypairSigner } from './keypair-signer';
import {
  analyzeExactPaymentTransaction,
  buildExactPaymentTransaction,
  decodeTransaction,
  transactionMessageHash,
} from './x402-payment';

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ATLAS_ALLOW_MOCK_SIGNER = 'true';
  process.env.NODE_ENV = 'test';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const payer = Keypair.generate();
const feePayer = Keypair.generate();
const merchant = Keypair.generate();
const attacker = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();

const expected = {
  payer: payer.publicKey.toBase58(),
  payTo: merchant.publicKey.toBase58(),
  mint: MINT,
  amountBaseUnits: '10000',
  feePayer: feePayer.publicKey.toBase58(),
};

function build(overrides: Partial<Parameters<typeof buildExactPaymentTransaction>[0]> = {}): string {
  const tx = buildExactPaymentTransaction({
    payer: expected.payer,
    feePayer: expected.feePayer,
    mint: MINT,
    decimals: 6,
    payTo: expected.payTo,
    amountBaseUnits: '10000',
    recentBlockhash: blockhash,
    ...overrides,
  });
  return Buffer.from(tx.serialize()).toString('base64');
}

function compile(instructions: TransactionInstruction[], payerKey = feePayer.publicKey): string {
  const message = new TransactionMessage({ payerKey, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
}

function transfer(overrides: { destinationOwner?: PublicKey; amount?: bigint; mint?: PublicKey; authority?: PublicKey } = {}) {
  const mint = overrides.mint ?? new PublicKey(MINT);
  return createTransferCheckedInstruction(
    getAssociatedTokenAddressSync(mint, payer.publicKey),
    mint,
    getAssociatedTokenAddressSync(mint, overrides.destinationOwner ?? merchant.publicKey),
    overrides.authority ?? payer.publicKey,
    overrides.amount ?? 10000n,
    6,
    [],
    TOKEN_PROGRAM_ID,
  );
}

const budget = () => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
];
const memo = () => new TransactionInstruction({ keys: [], programId: new PublicKey(MEMO), data: Buffer.from('nonce') });

describe('exact payment transaction builder + analyzer', () => {
  it('builds the reference layout and the analyzer accepts it', () => {
    const raw = build();
    const tx = decodeTransaction(raw);
    const programs = tx.message.compiledInstructions.map((ix) => tx.message.staticAccountKeys[ix.programIdIndex].toBase58());
    expect(programs).toEqual([
      'ComputeBudget111111111111111111111111111111',
      'ComputeBudget111111111111111111111111111111',
      TOKEN_PROGRAM_ID.toBase58(),
      MEMO,
    ]);
    expect(tx.message.staticAccountKeys[0].toBase58()).toBe(expected.feePayer);
    const analysis = analyzeExactPaymentTransaction(raw, expected);
    expect(analysis).toMatchObject({ matchesOffer: true, mismatch: null, transferCount: 1, unknownProgramIds: [] });
    expect(analysis.txMessageHash).toBe(transactionMessageHash(tx));
  });

  it('uses the seller memo when given and a random nonce otherwise', () => {
    const fixed = decodeTransaction(build({ memo: 'pi_3abc123def456' }));
    const memoIx = fixed.message.compiledInstructions.find(
      (ix) => fixed.message.staticAccountKeys[ix.programIdIndex].toBase58() === MEMO,
    );
    expect(Buffer.from(memoIx!.data).toString('utf8')).toBe('pi_3abc123def456');
    const a = analyzeExactPaymentTransaction(build(), expected).txMessageHash;
    const b = analyzeExactPaymentTransaction(build(), expected).txMessageHash;
    expect(a).not.toBe(b); // different nonce memo => different message
  });

  it('is unaffected by signing: the message hash is stable across signatures', async () => {
    const unsigned = build();
    const signer = new DevnetKeypairSigner(payer.secretKey);
    const signed = await signer.signTransaction(unsigned);
    expect(analyzeExactPaymentTransaction(signed.signedBase64, expected).txMessageHash).toBe(
      analyzeExactPaymentTransaction(unsigned, expected).txMessageHash,
    );
  });

  describe('rejects transactions that do not pay exactly the offer', () => {
    const cases: Array<[string, () => string, RegExp]> = [
      ['different recipient', () => compile([...budget(), transfer({ destinationOwner: attacker.publicKey }), memo()]), /destination/],
      ['different amount (one base unit more)', () => compile([...budget(), transfer({ amount: 10001n }), memo()]), /amount/],
      ['different amount (one base unit less)', () => compile([...budget(), transfer({ amount: 9999n }), memo()]), /amount/],
      ['different mint', () => compile([...budget(), transfer({ mint: new PublicKey(attacker.publicKey) }), memo()]), /mint/],
      ['different authority', () => compile([...budget(), transfer({ authority: attacker.publicKey }), memo()]), /authority/],
      ['two transfers (double payment)', () => compile([...budget(), transfer(), transfer(), memo()]), /./],
      ['no transfer at all', () => compile([...budget(), memo()]), /./],
      [
        'hidden SOL drain via the System program',
        () =>
          compile([
            ...budget(),
            transfer(),
            SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: attacker.publicKey, lamports: 1_000_000 }),
            memo(),
          ]),
        /unexpected instruction/,
      ],
      ['fee payer used as an account', () => compile([...budget(), transfer({ authority: feePayer.publicKey }), memo()]), /fee payer/],
      ['excessive compute unit price', () => compile([ComputeBudgetProgram.setComputeUnitLimit({ units: 20000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000_000 }), transfer(), memo()]), /price/],
      ['excessive compute unit limit', () => compile([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }), transfer(), memo()]), /limit/],
      ['two memos', () => compile([...budget(), transfer(), memo(), memo()]), /memo/],
    ];
    for (const [name, make, pattern] of cases) {
      it(name, () => {
        const analysis = analyzeExactPaymentTransaction(make(), expected);
        expect(analysis.matchesOffer).toBe(false);
        expect(analysis.mismatch).toMatch(pattern);
      });
    }

    it('unexpected fee payer', () => {
      const analysis = analyzeExactPaymentTransaction(build({ feePayer: attacker.publicKey.toBase58() }), expected);
      expect(analysis.matchesOffer).toBe(false);
      expect(analysis.mismatch).toMatch(/fee payer/);
    });

    it('flags programs outside the allowlist', () => {
      const evil = new TransactionInstruction({ keys: [], programId: attacker.publicKey, data: Buffer.from([1]) });
      const analysis = analyzeExactPaymentTransaction(compile([...budget(), transfer(), evil, memo()]), expected);
      expect(analysis.unknownProgramIds).toContain(attacker.publicKey.toBase58());
      expect(analysis.matchesOffer).toBe(false);
    });
  });
});

describe('DevnetKeypairSigner', () => {
  it('refuses to construct in production or without the explicit devnet flag', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new DevnetKeypairSigner(payer.secretKey)).toThrow(/production/);
    process.env.NODE_ENV = 'test';
    process.env.ATLAS_ALLOW_MOCK_SIGNER = 'false';
    expect(() => new DevnetKeypairSigner(payer.secretKey)).toThrow(/disabled/);
  });

  it('signs only its own slot and leaves the fee payer slot empty', async () => {
    const signer = new DevnetKeypairSigner(payer.secretKey);
    const signed = await signer.signTransaction(build());
    const tx = decodeTransaction(signed.signedBase64);
    expect(tx.signatures).toHaveLength(2);
    expect(tx.signatures[0].every((b) => b === 0)).toBe(true); // fee payer (facilitator) has not signed
    expect(tx.signatures[1].some((b) => b !== 0)).toBe(true);
  });

  it('refuses to sign a transaction it is not a required signer of', async () => {
    const signer = new DevnetKeypairSigner(attacker.secretKey);
    await expect(signer.signTransaction(build())).rejects.toThrow(/not a required signer/);
  });

  it('signs arbitrary messages that verify under the same public key', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519');
    const signer = new DevnetKeypairSigner(payer.secretKey);
    const message = new TextEncoder().encode('hello');
    const signature = await signer.signMessage(message);
    expect(ed25519.verify(signature, message, payer.publicKey.toBytes())).toBe(true);
    expect(signer.publicKey).toBe(payer.publicKey.toBase58());
  });
});
