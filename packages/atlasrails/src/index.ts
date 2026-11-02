import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Connection, Keypair } from '@solana/web3.js';

export {
  attachFundedChannel,
  beginPayment,
  buildSignedMandate,
  createDemoMint,
  createMandateAndTransfer,
  createVoucher,
  createVoucherKey,
  depositUpfront,
  fundChannel,
  importFunder,
  keypairWallet,
  loadEnv,
  mandatePayment,
  payPayee,
  settleChannel,
  withdrawRemainder,
  type MandatePayment,
  type PaymentSession,
  type WalletSigner,
} from './funder';

export { createAtlasRail } from './sdk-client';
export { signerAgent, type SignerAgent, type SignerAgentOptions } from './signer-agent';
export { AtlasRailError } from './sdk-types';
export type {
  AtlasRailClient,
  AtlasRailConfig,
  AtlasErrorCode,
  AtlasErrorInfo,
  ExecutionPolicy,
  PayRequest,
  PaymentResult,
  PaymentLifecycleStatus,
  TransactionReview,
  DeniedPaymentResult,
  VoucherReadyResult,
  SimulatedStageResult,
  ConfirmedSettleResult,
  PaidResult,
  FailedPaymentResult,
  OpenChannelCall,
  OpenChannelResult,
  RefundCall,
  RefundResult,
  NeedsTopUpResult,
  TopUpCall,
  TopUpResult,
} from './sdk-types';
export {
  verifySavedE2eEvidence,
  loadSavedE2eEvidence,
  RECOVERY_CHANNEL,
  EVIDENCE_CHANNEL,
  DEVNET_GENESIS,
} from './sdk-evidence';
export {
  loadMandate,
  assertMandateActiveForPayment,
  assertPaymentAgainstOnChainMandate,
  DEFAULT_MANDATE_PROGRAM_ID,
  buildAnchorRootTransaction,
  buildCreateMandateTransaction,
  buildRevokeMandateTransaction,
  exportMandateAccountJson,
  findMandatePda,
  isMandateAccountActive,
  loadMandateAccount,
  type LoadMandateResult,
  type MandateAccountOnChain,
  type OnChainMandateExport,
} from './mandate-onchain';
export {
  prepareCreateMandateInstruction,
  prepareRevokeMandateInstruction,
  prepareAnchorRootInstruction,
  runCreateMandate,
  runRevokeMandate,
  runAnchorRoot,
  type CreateMandateCall,
  type MandateAgentSigner,
  type RevokeMandateCall,
  type AnchorRootCall,
  type MandateInstructionResult,
} from './mandate-program';


export interface StoredAccount {
  publicKey: string;
}

export interface InitResult extends StoredAccount {
  created: boolean;
}

function readKeypair(path: string): Keypair {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('Account file is not a Solana secret key');
  }
  if (!Array.isArray(parsed) || parsed.length !== 64 || parsed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error('Account file is not a Solana secret key');
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

/** Writes a new keypair at `path` when the file is missing. A later call returns the same public key. */
export function init(options: { path: string }): InitResult {
  if (existsSync(options.path)) return { publicKey: load(options).publicKey, created: false };
  const keypair = Keypair.generate();
  mkdirSync(dirname(options.path), { recursive: true });
  try {
    writeFileSync(options.path, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600, flag: 'wx' });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return { publicKey: load(options).publicKey, created: false };
    throw error;
  }
  return { publicKey: keypair.publicKey.toBase58(), created: true };
}

/** Reads the public key stored at `path`. */
export function load(options: { path: string }): StoredAccount {
  return { publicKey: readKeypair(options.path).publicKey.toBase58() };
}

/** The stored keypair. Callers sign with it; do not log `secretKey`. */
export function keypair(options: { path: string }): Keypair {
  return readKeypair(options.path);
}

/** A devnet connection bound to the account stored at `path`. */
export function connect(options: { path: string; rpcUrl?: string }): { connection: Connection; publicKey: string } {
  const rpcUrl = options.rpcUrl ?? process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL is required');
  const { publicKey } = load(options);
  return { connection: new Connection(rpcUrl, 'confirmed'), publicKey };
}
