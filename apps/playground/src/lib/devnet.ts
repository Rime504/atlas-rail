/**
 * Devnet mode: the part of the playground that can touch the real, deployed mandate registry
 * (programs/atlas-mandate) and move real (tiny, devnet-only) amounts of devnet USDC on Solana devnet.
 * The gate decision itself is always computed with the real code regardless of mode (see scenario.ts)
 * — devnet mode changes whether mandate registration/revocation, the two payments that actually
 * ALLOW (steps 3 and 6), and the step 7 receipt anchor also happen for real on-chain, each falling
 * back to a synthetic result with a visible reason if it fails.
 *
 * Keys: `PLAYGROUND_DEVNET_OWNER_SECRET_KEY` must be a funded devnet keypair (base58, 32- or
 * 64-byte secret key) — it pays the rent and fees for `create_mandate`/`revoke_mandate`, for creating
 * the agent's and each session's seller's token accounts, and for topping up the instance key's SOL
 * before it pays for `anchor_root`. `PLAYGROUND_DEVNET_AGENT_SECRET_KEY` must ALSO be set and funded
 * with a small amount of real devnet USDC (https://faucet.circle.com) for settlement to succeed —
 * without it, payments fall back to a synthetic settlement with a visible reason, same as any other
 * devnet failure. Approver and instance keys default to freshly generated ones (cached for this
 * server instance's lifetime) if their own env vars aren't set, since they only need to sign, never
 * to pay (the instance key's SOL is minted on demand from the owner key, see `anchorRootOnchain`).
 * Devnet mode is simply unavailable (silently falls back to instant mode) if the owner key isn't
 * configured.
 */
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { AgentMandate, X402Offer, fromBase58, fromHex, hashMandate, LocalEd25519Signer } from '@atlas-rail/mandate';
import {
  Web3ChainClient,
  buildAnchorRootTransaction,
  buildCreateMandateTransaction,
  buildExactPaymentTransaction,
  buildRevokeMandateTransaction,
  ensureAta,
  ensureSol,
  fetchMandateAccount,
  findMandatePda,
} from '@atlas-rail/solana';
import { DevnetCoreKeys, OnchainAnchor, randomKeyInfo } from './scenario';
import { KeyInfo, OnchainAction } from './types';

const PROGRAM_ID = process.env.MANDATE_PROGRAM_ID ?? 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
const RPC_URL = process.env.PLAYGROUND_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const DEVNET_TIMEOUT_MS = 20_000;
const RATE_LIMIT_PER_HOUR = 5;

function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function keyFromSecretEnv(label: string, envVar: string): KeyInfo | null {
  const secret = process.env[envVar];
  if (!secret) return null;
  const bytes = fromBase58(secret);
  const seed = bytes.length === 64 ? bytes.slice(0, 32) : bytes;
  if (seed.length !== 32) throw new Error(`${envVar} is not a valid Ed25519 secret key`);
  const signer = new LocalEd25519Signer(seed);
  return { label, publicKey: signer.publicKey, seedHex: Buffer.from(seed).toString('hex') };
}

// Approver/agent/instance don't need funding, so they can be generated once and cached for the
// life of this server instance rather than requiring three more env vars.
let cachedGenerated: { approver: KeyInfo; agent: KeyInfo; instance: KeyInfo } | null = null;
function generatedCoreKeys(): { approver: KeyInfo; agent: KeyInfo; instance: KeyInfo } {
  if (!cachedGenerated) {
    cachedGenerated = { approver: randomKeyInfo('approver'), agent: randomKeyInfo('agent'), instance: randomKeyInfo('instance') };
  }
  return cachedGenerated;
}

/** Null if devnet mode isn't configured on this deployment (no funded owner key) — callers should
 * fall back to instant mode and say so. */
export function resolveDevnetCoreKeys(): DevnetCoreKeys | null {
  const owner = keyFromSecretEnv('owner', 'PLAYGROUND_DEVNET_OWNER_SECRET_KEY');
  if (!owner) return null;
  const approver = keyFromSecretEnv('approver', 'PLAYGROUND_DEVNET_APPROVER_SECRET_KEY') ?? generatedCoreKeys().approver;
  const agent = keyFromSecretEnv('agent', 'PLAYGROUND_DEVNET_AGENT_SECRET_KEY') ?? generatedCoreKeys().agent;
  const instance = keyFromSecretEnv('instance', 'PLAYGROUND_DEVNET_INSTANCE_SECRET_KEY') ?? generatedCoreKeys().instance;
  return { owner, approver, agent, instance };
}

/* ---- best-effort per-IP rate limit (in-memory; resets on cold start) ---------------------------- */

const hits = new Map<string, number[]>();

export function rateLimited(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const recent = (hits.get(ip) ?? []).filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT_PER_HOUR) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

/* ---- timeout wrapper -------------------------------------------------------------------------- */

export async function withTimeout<T>(promise: Promise<T>, ms = DEVNET_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Devnet request timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

/* ---- on-chain actions -------------------------------------------------------------------------- */

function keypairFromInfo(key: KeyInfo): Keypair {
  if (!key.seedHex) throw new Error(`No key material for ${key.label}`);
  return Keypair.fromSeed(fromHex(key.seedHex));
}

export async function registerMandateOnchain(mandate: AgentMandate, keys: DevnetCoreKeys): Promise<OnchainAction> {
  const chain = Web3ChainClient.fromUrl(RPC_URL);
  const { blockhash } = await chain.getLatestBlockhash();
  const mandateHash = Buffer.from(hashMandate(mandate), 'hex');
  const unsigned = buildCreateMandateTransaction({
    programId: PROGRAM_ID,
    owner: keys.owner.publicKey,
    approver: keys.approver.publicKey,
    agent: keys.agent.publicKey,
    recentBlockhash: blockhash,
    mandateHash,
    gateAuthority: keys.instance.publicKey,
    mint: mandate.scope.limits.mint,
    maxPerPayment: BigInt(mandate.scope.limits.maxPerPayment),
    maxPerWindow: BigInt(mandate.scope.limits.maxPerWindow),
    windowSeconds: BigInt(mandate.scope.limits.windowSeconds),
    maxTotal: BigInt(mandate.scope.limits.maxTotal),
    escalationThreshold: BigInt(mandate.escalation.thresholdBaseUnits),
    notBefore: BigInt(mandate.notBefore),
    expiresAt: BigInt(mandate.expiresAt),
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(unsigned, 'base64'));
  tx.sign([keypairFromInfo(keys.owner), keypairFromInfo(keys.approver), keypairFromInfo(keys.agent)]);
  const signature = await chain.sendAndConfirm(Buffer.from(tx.serialize()).toString('base64'));
  return { txSignature: signature, explorerUrl: explorerTx(signature) };
}

export async function revokeMandateOnchain(mandate: AgentMandate, keys: DevnetCoreKeys): Promise<OnchainAction> {
  const chain = Web3ChainClient.fromUrl(RPC_URL);
  const { blockhash } = await chain.getLatestBlockhash();
  const mandateHash = Buffer.from(hashMandate(mandate), 'hex');
  const { address: mandatePda } = findMandatePda(PROGRAM_ID, mandateHash);
  const unsigned = buildRevokeMandateTransaction({
    programId: PROGRAM_ID,
    mandatePda,
    authority: keys.owner.publicKey,
    recentBlockhash: blockhash,
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(unsigned, 'base64'));
  tx.sign([keypairFromInfo(keys.owner)]);
  const signature = await chain.sendAndConfirm(Buffer.from(tx.serialize()).toString('base64'));
  return { txSignature: signature, explorerUrl: explorerTx(signature) };
}

/**
 * Settles a step 3/6 payment for real: a genuine SPL `TransferChecked` from the agent's own token
 * account to the seller's, on Solana devnet, real (tiny) devnet USDC amounts. The owner key — the
 * only key this deployment keeps funded with SOL — pays rent and fees as `feePayer`; the agent signs
 * as the transfer's source authority, same as every other x402 "exact" payment in this project
 * (`@atlas-rail/solana`'s `buildExactPaymentTransaction`, the same builder the main demo uses).
 *
 * Each playground session gets a fresh random seller key (never funded, never needs to be — it only
 * ever receives), so its associated token account is created here, idempotently, before every
 * payment. The agent's own token account needs an actual devnet USDC balance to pay anything with —
 * see `PLAYGROUND_DEVNET_AGENT_SECRET_KEY` in README/ops notes for how that key is funded.
 */
export async function settlePaymentOnchain(offer: Pick<X402Offer, 'payTo' | 'asset' | 'amount'>, keys: DevnetCoreKeys): Promise<OnchainAction> {
  const chain = Web3ChainClient.fromUrl(RPC_URL);
  const ownerKeypair = keypairFromInfo(keys.owner);
  const agentKeypair = keypairFromInfo(keys.agent);
  const mintInfo = await chain.getMintInfo(offer.asset);
  if (!mintInfo) throw new Error(`Mint ${offer.asset} was not found on devnet`);
  await ensureAta(chain, ownerKeypair, keys.agent.publicKey, offer.asset);
  await ensureAta(chain, ownerKeypair, offer.payTo, offer.asset);
  const { blockhash } = await chain.getLatestBlockhash();
  const tx = buildExactPaymentTransaction({
    payer: keys.agent.publicKey,
    feePayer: keys.owner.publicKey,
    mint: offer.asset,
    decimals: mintInfo.decimals,
    payTo: offer.payTo,
    amountBaseUnits: offer.amount,
    recentBlockhash: blockhash,
  });
  tx.sign([ownerKeypair, agentKeypair]);
  const signature = await chain.sendAndConfirm(Buffer.from(tx.serialize()).toString('base64'));
  return { txSignature: signature, explorerUrl: explorerTx(signature) };
}

/**
 * Anchors a step 7 receipt for real: reads the mandate's next `anchor_root` sequence number straight
 * from its on-chain account (the same source of truth `AnchorService` uses for the main demo) and
 * submits a real `anchor_root` transaction for this one-receipt batch. The gate authority (instance
 * key) must sign and pay for it; since that key is never meant to hold funds, it's topped up here
 * from the owner key's existing SOL balance first (a few thousand lamports — negligible, and this
 * is plain devnet SOL, which the public faucet already gives out for free).
 */
export async function anchorRootOnchain(mandate: AgentMandate, merkleRoot: string, leafCount: number, keys: DevnetCoreKeys): Promise<OnchainAnchor> {
  const chain = Web3ChainClient.fromUrl(RPC_URL);
  const ownerKeypair = keypairFromInfo(keys.owner);
  const instanceKeypair = keypairFromInfo(keys.instance);
  await ensureSol(chain, keys.instance.publicKey, 5_000_000n, { funder: ownerKeypair, preferFunder: true });
  const mandateHash = Buffer.from(hashMandate(mandate), 'hex');
  const { address: mandatePda } = findMandatePda(PROGRAM_ID, mandateHash);
  const account = await fetchMandateAccount(RPC_URL, mandatePda);
  if (!account) throw new Error('Mandate is not registered on-chain — nothing to anchor against');
  const { blockhash } = await chain.getLatestBlockhash();
  const unsigned = buildAnchorRootTransaction({
    programId: PROGRAM_ID,
    mandatePda,
    gateAuthority: keys.instance.publicKey,
    recentBlockhash: blockhash,
    seq: account.nextRootSeq,
    merkleRoot: fromHex(merkleRoot),
    leafCount,
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(unsigned, 'base64'));
  tx.sign([instanceKeypair]);
  const signature = await chain.sendAndConfirm(Buffer.from(tx.serialize()).toString('base64'));
  return { action: { txSignature: signature, explorerUrl: explorerTx(signature) }, seq: Number(account.nextRootSeq), chain, programId: PROGRAM_ID };
}
