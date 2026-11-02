import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { encodeVoucherMessage } from '@atlas-rail/x402';
import { buildReceipt, hashResponseBody, verifyReceipt } from '@atlas-rail/receipt';
import { findRootPda } from '@atlas-rail/solana';
import { LocalEd25519Signer } from '@atlas-rail/mandate';
import { verifyEd25519 } from './sdk-crypto';
import { RECOVERY_CHANNEL, DEVNET_GENESIS } from './sdk-evidence';
import {
  assertPaymentAgainstOnChainMandate,
  loadMandate,
  type LoadMandateResult,
} from './mandate-onchain';
import { runAnchorRoot, runCreateMandate, runRevokeMandate } from './mandate-program';
import {
  assertGraceSeconds,
  buildRequestCloseInstruction,
  buildTopUpInstruction,
  buildSealInstruction,
  buildSettleAndSealInstruction,
  citeMandateOnSignatureCheck,
  buildCloseEscrowInstruction,
  buildReclaimInstruction,
  buildWithdrawPayerInstruction,
  readCloseState,
  refundPlan,
  revokeChannelStep,
} from './channel-flow';
import { combineVoucherReceipts, distributedReceiptsForAnchor, payAnchorAttachment, stampVoucherAnchor } from './anchor-batch';
import { askWithAgent, messageSigner } from './local-voucher';
import type {
  AtlasRailClient,
  AtlasRailConfig,
  AtlasErrorInfo,
  ConfirmedSettleResult,
  DeniedPaymentResult,
  FailedPaymentResult,
  PaidResult,
  PayRequest,
  PaymentResult,
  SimulatedStageResult,
  TransactionReview,
  OpenChannelCall,
  OpenChannelResult,
  RefundCall,
  RefundResult,
  NeedsTopUpResult,
  TopUpCall,
  TopUpResult,
  VoucherReadyResult,
} from './sdk-types';
import { AtlasRailError } from './sdk-types';

const PROGRAM_ID = new PublicKey('CHNLxYvVA28MJP9PrFuDXccuoGXAx7jBacfLEkahyGsX');
const INSTRUCTIONS_SYSVAR = new PublicKey('Sysvar1nstructions1111111111111111111111111');
const TREASURY_OWNER = new PublicKey('4zTeC5mVqWLruDexgU2mV66p9t5vCA9JyiZqdGDUspap');

interface PaymentHelpers {
  readChannel: (data: Buffer | Uint8Array) => {
    status: number;
    deposit: bigint;
    settled: bigint;
    payoutWatermark: bigint;
    authorizedSigner: string;
    mint: string;
    payer: string;
    payee: string;
  };
  ed25519Instruction: (pubkey: Uint8Array, signature: Uint8Array, message: Uint8Array) => TransactionInstruction;
  distributeData: () => Buffer;
  askAtlasRail: (body: Record<string, unknown>) => Promise<{
    signed: boolean;
    message?: string;
    messageBase64?: string;
    signatureBase64?: string;
    messageHash?: string;
    deltaAmount?: string;
    decision?: import('@atlas-rail/mandate').SignedDecision;
  }>;
  DEVNET_GENESIS: string;
}

interface FundHelpers {
  submitSigned: (
    connection: import('@solana/web3.js').Connection,
    transaction: Transaction,
    options: { feePayer: unknown; localSigners?: unknown[]; wallet?: unknown },
  ) => Promise<string>;
  PROGRAM_ID: PublicKey;
  INSTRUCTIONS_SYSVAR: PublicKey;
}

interface StoredPayment {
  id: string;
  request: PayRequest;
  channel: {
    authorizedSigner: string;
    mint: string;
    payer: string;
    payee: string;
    deposit: bigint;
    settled: bigint;
  };
  message: Uint8Array;
  signature: Uint8Array;
  messageHash: string;
  deltaAmount: string;
  decision: import('@atlas-rail/mandate').SignedDecision;
  settleSignature?: string;
  distributeSignature?: string;
  receipt?: import('@atlas-rail/receipt').BoundReceipt;
  settleReviewId?: string;
  distributeReviewId?: string;
}

async function loadPayment(): Promise<PaymentHelpers> {
  const href = pathToFileURL(join(__dirname, '..', 'payment.mjs')).href;
  const load = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<PaymentHelpers>;
  return load(href);
}

async function loadFund(): Promise<FundHelpers> {
  const href = pathToFileURL(join(__dirname, '..', 'channel-fund.mjs')).href;
  const load = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<FundHelpers>;
  return load(href);
}

function fail(info: AtlasErrorInfo): FailedPaymentResult {
  return { status: info.outcomeKnown === false && info.broadcast ? 'unknown' : 'failed', error: info };
}

export function createAtlasRail(config: AtlasRailConfig): AtlasRailClient {
  if (!config.apiUrl) throw new AtlasRailError({
    code: 'CONFIG_INVALID', stage: 'config', message: 'apiUrl is required', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Set apiUrl',
  });
  if (!config.connection) throw new AtlasRailError({
    code: 'CONFIG_INVALID', stage: 'config', message: 'connection is required', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass a Connection',
  });
  if (!config.wallet?.publicKey || typeof config.wallet.signTransaction !== 'function') {
    throw new AtlasRailError({
      code: 'CONFIG_INVALID', stage: 'config', message: 'wallet signer is required', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass a WalletSigner',
    });
  }
  if (!['prepareOnly', 'requireApproval', 'autoExecute'].includes(config.execution)) {
    throw new AtlasRailError({
      code: 'CONFIG_INVALID', stage: 'config', message: 'execution policy is invalid', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Use prepareOnly, requireApproval, or autoExecute',
    });
  }
  if (config.execution === 'requireApproval' && typeof config.onApprove !== 'function') {
    throw new AtlasRailError({
      code: 'CONFIG_INVALID', stage: 'config', message: 'requireApproval needs an onApprove callback', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Provide onApprove that returns true only after a real user review',
    });
  }
  if (config.agent && !config.gate) {
    throw new AtlasRailError({
      code: 'CONFIG_INVALID', stage: 'config', message: 'agent needs gate', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass gate alone to use the voucher API and the signer, or both keys for in-process tests',
    });
  }

  const requireOnChainMandate = config.requireOnChainMandate !== false;

  const payments = new Map<string, StoredPayment>();
  const expectedGenesis = config.expectedGenesis ?? DEVNET_GENESIS;
  if (config.fetch) {
    // shortcut: payment.mjs askAtlasRail uses global fetch; inject by assigning when provided
    (globalThis as { fetch: typeof fetch }).fetch = config.fetch;
  }

  async function assertDevnet(): Promise<void> {
    const genesis = await config.connection.getGenesisHash();
    if (genesis !== expectedGenesis) {
      throw new AtlasRailError({
        code: 'NETWORK_MISMATCH', stage: 'config', message: 'RPC cluster does not match the expected genesis', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Point connection at Solana Devnet',
      });
    }
  }

  async function readChannel(channel: string) {
    if (channel === RECOVERY_CHANNEL) {
      throw new AtlasRailError({
        code: 'CHANNEL_FORBIDDEN', stage: 'channel', message: 'Recovery channel is forbidden for SDK payments', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Use a different channel',
      });
    }
    const payment = await loadPayment();
    const info = await config.connection.getAccountInfo(new PublicKey(channel), 'confirmed');
    if (!info || !info.owner.equals(PROGRAM_ID)) {
      throw new AtlasRailError({
        code: 'CHANNEL_INVALID', stage: 'channel', message: 'Channel account is missing or not owned by the payment program', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass an open Atlas Rail channel',
      });
    }
    return { decoded: payment.readChannel(info.data), helpers: payment };
  }

  async function requestPayment(request: PayRequest): Promise<DeniedPaymentResult | NeedsTopUpResult | VoucherReadyResult | FailedPaymentResult> {
    try {
      await assertDevnet();
      if (!request.mandate?.id || !request.mandate.agent?.publicKey) {
        return fail({ code: 'MANDATE_INVALID', stage: 'mandate', message: 'mandate id and agent public key are required', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass a signed mandate' });
      }
      if (request.amount <= 0n) {
        return fail({ code: 'VOUCHER_INVALID', stage: 'request', message: 'amount must be positive', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass a positive cumulative amount' });
      }
      const { decoded, helpers } = await readChannel(request.channel);
      if (decoded.mint !== request.mint) {
        return fail({ code: 'CHANNEL_INVALID', stage: 'channel', message: 'Mint does not match the channel', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Use the channel mint' });
      }
      if (decoded.payee !== request.recipient) {
        // The gate checks the recipient, and settlement pays the channel payee, so the two must match.
        return fail({ code: 'CHANNEL_INVALID', stage: 'channel', message: 'Recipient is not the channel payee', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pay the payee the channel was opened for' });
      }
      if (decoded.authorizedSigner !== request.mandate.agent.publicKey) {
        return fail({ code: 'SIGNER_MISMATCH', stage: 'signer', message: 'Mandate agent is not the channel authorized signer', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Use the mandate whose agent matches the on-chain authorized signer' });
      }
      const remaining = decoded.deposit - decoded.settled;
      if (request.amount <= decoded.settled) {
        return fail({ code: 'VOUCHER_INVALID', stage: 'channel', message: 'Cumulative amount is not strictly above the settled watermark', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Use a higher cumulative amount' });
      }
      if (request.amount > decoded.deposit) {
        // Pause, never top up here: only the owner adds funds, with topUp.
        return {
          status: 'needs_top_up',
          stage: 'channel',
          channel: request.channel,
          remaining: remaining.toString(),
          needed: (request.amount - decoded.deposit).toString(),
          deposit: decoded.deposit.toString(),
          settled: decoded.settled.toString(),
          message: `Channel has ${remaining} left; this payment needs ${request.amount - decoded.deposit} more. The owner must top up.`,
          broadcast: false,
        };
      }

      const mandateAddress = request.mandateAddress;
      if (requireOnChainMandate && !mandateAddress) {
        return fail({
          code: 'MANDATE_INVALID',
          stage: 'mandate',
          message: 'requireOnChainMandate is set but mandateAddress is missing',
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: 'Pass the Atlas Mandate PDA address',
        });
      }
      if (mandateAddress) {
        try {
          const onChain = await loadMandate(config.connection, mandateAddress, {
            programId: config.mandateProgramId,
          });
          assertPaymentAgainstOnChainMandate(onChain, {
            agentPublicKey: request.mandate.agent.publicKey,
            mint: request.mint,
            deltaAmount: request.amount - decoded.settled,
          });
        } catch (error) {
          return fail({
            code: 'MANDATE_INVALID',
            stage: 'mandate',
            message: error instanceof Error ? error.message : 'On-chain mandate validation failed',
            broadcast: false,
            outcomeKnown: true,
            fundsMayHaveMoved: false,
            nextAction: 'Load a live, active mandate PDA owned by the Atlas Mandate program',
          });
        }
      }

      process.env.ATLAS_API_URL = config.apiUrl.replace(/\/$/, '');
      if (config.apiToken) process.env.ATLAS_VOUCHER_TOKEN = config.apiToken;
      const voucherFields = {
        mandate: request.mandate,
        channelId: request.channel,
        cumulativeAmount: request.amount.toString(),
        expiresAt: request.expiresAt,
        recipient: request.recipient,
        resourceUrl: request.resourceUrl,
        asset: request.mint,
        network: request.network,
        feePayer: request.feePayer ?? config.wallet.publicKey,
        chainSettled: (request.chainSettled ?? decoded.settled).toString(),
        ...(request.approvalId ? { approvalId: request.approvalId } : {}),
      };
      const body = config.agent && config.gate
        ? await askWithAgent({
            mandate: request.mandate,
            agent: config.agent,
            gate: config.gate,
            channelId: voucherFields.channelId,
            cumulativeAmount: voucherFields.cumulativeAmount,
            expiresAt: voucherFields.expiresAt,
            recipient: voucherFields.recipient,
            resourceUrl: voucherFields.resourceUrl,
            asset: voucherFields.asset,
            network: voucherFields.network,
            feePayer: voucherFields.feePayer,
            settled: request.chainSettled ?? decoded.settled,
          })
        : await helpers.askAtlasRail(voucherFields);

      if (!body.signed) {
        if (body.signatureBase64) {
          return fail({ code: 'GATE_DENIED', stage: 'gate', message: 'Denied voucher included a signature', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Treat as a security failure; do not settle' });
        }
        const asked = body as { reason?: string; approvalId?: string; expiresAt?: number };
        return {
          status: 'denied',
          stage: 'gate',
          message: body.message ?? 'MandateDeniedError',
          ...(asked.reason ? { reason: asked.reason } : {}),
          ...(asked.approvalId ? { approvalId: asked.approvalId, approvalExpiresAt: asked.expiresAt } : {}),
          channel: request.channel,
          broadcast: false,
          hasSignature: false,
        };
      }

      const message = Uint8Array.from(Buffer.from(body.messageBase64!, 'base64'));
      const signature = Uint8Array.from(Buffer.from(body.signatureBase64!, 'base64'));
      if (message.length !== 50) {
        return fail({ code: 'VOUCHER_INVALID', stage: 'voucher', message: 'Voucher message is not 50 bytes', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Reject the API response' });
      }
      const expected = encodeVoucherMessage({
        channelId: request.channel,
        cumulativeAmount: request.amount,
        expiresAt: BigInt(request.expiresAt),
      });
      if (Buffer.compare(Buffer.from(message), Buffer.from(expected)) !== 0) {
        return fail({ code: 'VOUCHER_INVALID', stage: 'voucher', message: 'Voucher bytes do not match the canonical encoding', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Reject the API response' });
      }
      const ok = verifyEd25519(new PublicKey(decoded.authorizedSigner).toBytes(), message, signature);
      if (!ok) {
        return fail({ code: 'VOUCHER_INVALID', stage: 'voucher', message: 'Voucher signature does not verify against the authorized signer', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Reject the API response' });
      }

      const paymentId = `pay_${randomBytes(8).toString('hex')}`;
      payments.set(paymentId, {
        id: paymentId,
        request,
        channel: {
          authorizedSigner: decoded.authorizedSigner,
          mint: decoded.mint,
          payer: decoded.payer,
          payee: decoded.payee,
          deposit: decoded.deposit,
          settled: decoded.settled,
        },
        message,
        signature,
        messageHash: body.messageHash!,
        deltaAmount: body.deltaAmount!,
        decision: body.decision!,
      });

      return {
        status: 'voucher_ready',
        stage: 'voucher',
        channel: request.channel,
        amount: request.amount.toString(),
        messageHash: body.messageHash!,
        deltaAmount: body.deltaAmount!,
        authorizedSigner: decoded.authorizedSigner,
        voucherBytes: 50,
        signatureVerified: true,
        decision: body.decision!,
        broadcast: false,
        paymentId,
      };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: 'SUBMIT_FAILED',
        stage: 'voucher',
        message: error instanceof Error ? error.message : 'Payment request failed',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Inspect the error and retry requestPayment only',
      });
    }
  }

  async function buildSettleTx(stored: StoredPayment): Promise<Transaction> {
    const helpers = await loadPayment();
    if (!stored.request.mandateAddress) {
      throw new Error('Settlement needs the mandate address as a read-only account');
    }
    const settleIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: new PublicKey(stored.request.channel), isSigner: false, isWritable: true },
        { pubkey: INSTRUCTIONS_SYSVAR, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([2]),
    });
    const tx = new Transaction().add(
      citeMandateOnSignatureCheck(
        helpers.ed25519Instruction(new PublicKey(stored.channel.authorizedSigner).toBytes(), stored.signature, stored.message),
        new PublicKey(stored.request.mandateAddress),
      ),
      settleIx,
    );
    tx.feePayer = new PublicKey(config.wallet.publicKey);
    return tx;
  }

  async function prepareSettlement(paymentId: string): Promise<SimulatedStageResult | FailedPaymentResult> {
    try {
      await assertDevnet();
      const stored = payments.get(paymentId);
      if (!stored) return fail({ code: 'CONFIG_INVALID', stage: 'settle', message: 'Unknown paymentId', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Call requestPayment first' });
      const { decoded } = await readChannel(stored.request.channel);
      if (decoded.settled !== stored.channel.settled) {
        return fail({ code: 'STALE_STATE', stage: 'settle', message: 'Channel settled watermark changed since the voucher was issued', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Request a new voucher' });
      }
      const tx = await buildSettleTx(stored);
      const latest = await config.connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = latest.blockhash;
      const fee = await config.connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
      // Sign for simulation only with a throwaway path: use VersionedTransaction-style via wallet would mutate.
      // Simulate with sigVerify false via replaceRecentBlockhash by compiling unsigned — web3 legacy needs signers.
      // Use a one-shot clone signed by asking wallet only for sim when auto/require — for prepareOnly, simulate without full wallet if possible.
      const simTx = Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
      simTx.recentBlockhash = latest.blockhash;
      // partial: fee payer must sign for simulateTransaction(legacy) with signers array — call wallet
      const signedForSim = await config.wallet.signTransaction(simTx);
      const simulated = await config.connection.simulateTransaction(signedForSim);
      if (simulated.value.err) {
        return fail({
          code: 'SIMULATION_FAILED',
          stage: 'settle',
          message: `Settlement simulation failed: ${JSON.stringify(simulated.value.err)}`,
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: 'Do not broadcast; inspect logs',
        });
      }
      const reviewId = `rev_settle_${randomBytes(6).toString('hex')}`;
      stored.settleReviewId = reviewId;
      const review: TransactionReview = {
        stage: 'settle',
        reviewId,
        channel: stored.request.channel,
        feeLamports: fee.value,
        requiredSigners: [config.wallet.publicKey],
        instructionSummary: signedForSim.instructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          dataHex: Buffer.from(ix.data).toString('hex'),
        })),
        simulation: {
          err: null,
          logs: simulated.value.logs ?? [],
          unitsConsumed: simulated.value.unitsConsumed ?? null,
        },
        effect: 'Updates the settled watermark. Does not move tokens.',
        approvalToken: 'settle',
      };
      return {
        status: config.execution === 'prepareOnly' ? 'simulated' : 'awaiting_approval',
        stage: 'settle',
        review,
        broadcast: false,
        paymentId,
      };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: 'SIMULATION_FAILED',
        stage: 'settle',
        message: error instanceof Error ? error.message : 'Settlement prepare failed',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Fix the error and call prepareSettlement again',
      });
    }
  }

  async function assertMayBroadcast(stage: 'settle' | 'distribute', approval: string | undefined, review: TransactionReview | null): Promise<FailedPaymentResult | null> {
    if (config.execution === 'prepareOnly') {
      return fail({
        code: 'APPROVAL_REQUIRED',
        stage,
        message: 'execution is prepareOnly; broadcasting is disabled',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Switch policy or stop after simulation',
      });
    }
    if (config.execution === 'requireApproval') {
      if (approval !== stage) {
        return fail({
          code: 'APPROVAL_REQUIRED',
          stage,
          message: `Pass { approval: '${stage}' } after reviewing the simulation`,
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: 'Call execute with the matching approval token',
        });
      }
      if (!review) {
        return fail({
          code: 'APPROVAL_REQUIRED',
          stage,
          message: 'Prepare the stage before executing',
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: `Call prepare${stage === 'settle' ? 'Settlement' : 'Distribution'} first`,
        });
      }
      const ok = await config.onApprove!(review);
      if (!ok) {
        return fail({
          code: 'APPROVAL_REJECTED',
          stage,
          message: 'onApprove returned false',
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: 'Do not broadcast',
        });
      }
    }
    return null;
  }

  async function executeSettlement(paymentId: string, options?: { approval?: 'settle' }): Promise<ConfirmedSettleResult | FailedPaymentResult> {
    let broadcast = false;
    let signature: string | null = null;
    try {
      await assertDevnet();
      const stored = payments.get(paymentId);
      if (!stored) return fail({ code: 'CONFIG_INVALID', stage: 'settle', message: 'Unknown paymentId', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Call requestPayment first' });
      const prepared = await prepareSettlement(paymentId);
      if (prepared.status !== 'simulated' && prepared.status !== 'awaiting_approval') {
        return prepared as FailedPaymentResult;
      }
      const blocked = await assertMayBroadcast('settle', options?.approval, prepared.review);
      if (blocked) return blocked;

      const { decoded } = await readChannel(stored.request.channel);
      if (decoded.status !== 0) {
        return fail({
          code: 'CHANNEL_INVALID',
          stage: 'settle',
          message: 'Channel is not open, so this voucher can no longer be settled',
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: 'A revoke that closed the channel blocks settlement of an already-signed voucher',
        });
      }
      if (decoded.settled !== stored.channel.settled) {
        return fail({ code: 'STALE_STATE', stage: 'settle', message: 'Channel settled watermark changed before broadcast', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Request a new voucher' });
      }
      if (decoded.authorizedSigner !== stored.channel.authorizedSigner) {
        return fail({ code: 'SIGNER_MISMATCH', stage: 'settle', message: 'Authorized signer changed on-chain', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Stop' });
      }
      const mandateBlock = await recheckMandate(stored);
      if (mandateBlock) return mandateBlock;

      const fund = await loadFund();
      const tx = await buildSettleTx(stored);
      broadcast = true;
      signature = await fund.submitSigned(config.connection, tx, { feePayer: config.wallet, wallet: config.wallet });
      stored.settleSignature = signature;

      const after = (await readChannel(stored.request.channel)).decoded;
      if (after.settled !== stored.request.amount) {
        return fail({
          code: 'OUTCOME_UNKNOWN',
          stage: 'settle',
          message: `Settled watermark is ${after.settled}, expected ${stored.request.amount}`,
          broadcast: true,
          outcomeKnown: true,
          signature,
          fundsMayHaveMoved: true,
          nextAction: 'Inspect the channel; do not resubmit settlement blindly',
        });
      }

      const issuedAt = Math.floor(Date.now() / 1000);
      // The gate key signs the receipt, so it can be pinned in `atlas verify` and anchored by
      // anchorVouchers, which only batches receipts signed by that key. Without a gate key the
      // receipt is signed by a disposable key and stays unanchored.
      const instance = config.gate ? messageSigner(config.gate, 'Gate') : new LocalEd25519Signer(randomBytes(32));
      const receipt = await buildReceipt(
        {
          id: `rcp_${stored.messageHash.slice(0, 16)}`,
          mandate: stored.request.mandate,
          decision: stored.decision,
          settlement: {
            txSignature: signature,
            network: stored.request.network,
            payer: stored.channel.authorizedSigner,
            settledAt: issuedAt,
            slot: null,
          },
          response: {
            status: 200,
            bodySha256: hashResponseBody(Buffer.from(stored.message)),
            contentType: 'application/vnd.payment-channels.voucher',
          },
          issuedAt,
        },
        instance,
      );
      const verified = await verifyReceipt(receipt, { trustedInstanceKeys: [instance.publicKey] });
      stored.receipt = receipt;
      stored.channel.settled = after.settled;

      return {
        status: 'partial',
        stage: 'settle',
        settleSignature: signature,
        settledBefore: decoded.settled.toString(),
        settledAfter: after.settled.toString(),
        receipt,
        receiptVerifyPass: verified.pass,
        broadcast: true,
        paymentId,
      };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: broadcast ? 'OUTCOME_UNKNOWN' : 'SUBMIT_FAILED',
        stage: 'settle',
        message: error instanceof Error ? error.message : 'Settlement execute failed',
        broadcast,
        outcomeKnown: !broadcast,
        signature,
        // Once the settle was sent it may have landed, same as the distribute step below.
        fundsMayHaveMoved: broadcast,
        nextAction: broadcast
          ? 'Check getSignatureStatuses before retrying; do not assume failure'
          : 'Fix the error and retry executeSettlement',
      });
    }
  }

  async function buildDistributeTx(stored: StoredPayment): Promise<Transaction> {
    const helpers = await loadPayment();
    const channel = new PublicKey(stored.request.channel);
    const mint = new PublicKey(stored.channel.mint);
    const payer = new PublicKey(stored.channel.payer);
    const payee = new PublicKey(stored.channel.payee);
    const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('event_authority')], PROGRAM_ID);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: channel, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(mint, channel, true), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(mint, payer), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(mint, payee), isSigner: false, isWritable: true },
        { pubkey: getAssociatedTokenAddressSync(mint, TREASURY_OWNER), isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: helpers.distributeData(),
    });
    const tx = new Transaction().add(ix);
    tx.feePayer = new PublicKey(config.wallet.publicKey);
    return tx;
  }

  async function prepareDistribution(paymentId: string): Promise<SimulatedStageResult | FailedPaymentResult> {
    try {
      await assertDevnet();
      const stored = payments.get(paymentId);
      if (!stored?.settleSignature) {
        return fail({ code: 'CONFIG_INVALID', stage: 'distribute', message: 'Settlement must be confirmed before distribution', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'executeSettlement first' });
      }
      const { decoded } = await readChannel(stored.request.channel);
      if (decoded.settled < stored.request.amount) {
        return fail({ code: 'STALE_STATE', stage: 'distribute', message: 'Settled watermark is below the voucher amount', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Inspect settlement' });
      }
      const tx = await buildDistributeTx(stored);
      const latest = await config.connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = latest.blockhash;
      const fee = await config.connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
      const signedForSim = await config.wallet.signTransaction(Transaction.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })));
      const simulated = await config.connection.simulateTransaction(signedForSim);
      if (simulated.value.err) {
        return fail({
          code: 'SIMULATION_FAILED',
          stage: 'distribute',
          message: `Distribution simulation failed: ${JSON.stringify(simulated.value.err)}`,
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: 'Do not broadcast; settlement evidence is preserved',
        });
      }
      const reviewId = `rev_dist_${randomBytes(6).toString('hex')}`;
      stored.distributeReviewId = reviewId;
      const review: TransactionReview = {
        stage: 'distribute',
        reviewId,
        channel: stored.request.channel,
        feeLamports: fee.value,
        requiredSigners: [config.wallet.publicKey],
        instructionSummary: signedForSim.instructions.map((ix) => ({
          programId: ix.programId.toBase58(),
          dataHex: Buffer.from(ix.data).toString('hex'),
        })),
        simulation: { err: null, logs: simulated.value.logs ?? [], unitsConsumed: simulated.value.unitsConsumed ?? null },
        effect: 'Moves settled − payout watermark from escrow to payee (and treasury fee if any).',
        approvalToken: 'distribute',
      };
      return {
        status: config.execution === 'prepareOnly' ? 'simulated' : 'awaiting_approval',
        stage: 'distribute',
        review,
        broadcast: false,
        paymentId,
      };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: 'SIMULATION_FAILED',
        stage: 'distribute',
        message: error instanceof Error ? error.message : 'Distribution prepare failed',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Settlement stands; fix distribute and retry prepareDistribution',
      });
    }
  }
  async function anchorMandateVouchers(mandatePda: string): Promise<
    | { ok: true; rootPda: string; merkleRoot: string; leafCount: number; seq: number; signature: string; settlements: string[] }
    | { ok: false; message: string }
  > {
    if (!config.gate) return { ok: false, message: 'Gate key is required to sign anchor_root' };
    const gateKey = config.gate.publicKey.toBase58();
    const batch = distributedReceiptsForAnchor(payments.values(), mandatePda, gateKey);
    const receipts = batch.map((payment) => payment.receipt!);
    if (receipts.length === 0) return { ok: false, message: 'empty' };
    const settlements = receipts.map((receipt) => receipt.settlement.txSignature);
    try {
      const before = await loadMandate(config.connection, mandatePda, { programId: config.mandateProgramId });
      const seq = before.account.nextRootSeq;
      if (seq > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, message: 'anchor_root sequence does not fit a receipt proof' };
      const combined = combineVoucherReceipts({
        mandate: mandatePda,
        seq: Number(seq),
        receiptHashes: receipts.map((receipt) => receipt.receiptHash),
      });
      if (config.execution === 'requireApproval') {
        const accepted = await config.onApprove!({
          stage: 'anchor',
          reviewId: `rev_anchor_${combined.merkleRoot.slice(0, 12)}`,
          channel: batch[0]!.request.channel,
          feeLamports: null,
          requiredSigners: [gateKey],
          instructionSummary: [],
          simulation: { err: null, logs: [], unitsConsumed: null },
          effect: `anchor_root stores one Merkle root for ${receipts.length} voucher receipt(s) on the mandate account.`,
          approvalToken: 'anchor',
        });
        if (!accepted) return { ok: false, message: 'Approval declined anchor_root. The payments stand.' };
      }
      const anchored = await runAnchorRoot(config.connection, {
        mandatePda,
        gate: config.gate,
        merkleRoot: Buffer.from(combined.merkleRoot, 'hex'),
        leafCount: receipts.length,
        batchHeader: Buffer.from(combined.batchHeader, 'hex'),
        batchFileHash: Buffer.from(combined.batchFileHash, 'hex'),
        submit: true,
      }, config.mandateProgramId);
      if (anchored.status !== 'confirmed') return { ok: false, message: 'anchor_root was not confirmed' };
      stampVoucherAnchor(receipts, {
        merkleRoot: combined.merkleRoot,
        leaves: combined.leaves,
        salts: combined.salts,
        batchHeader: combined.batchHeader,
        batchFileHash: combined.batchFileHash,
        txSignature: anchored.signature,
        network: batch[0]!.request.network,
        signer: gateKey,
        seq: Number(seq),
        anchoredAt: Math.floor(Date.now() / 1000),
        batchId: `anc_${combined.merkleRoot.slice(0, 16)}`,
      });
      const programId = config.mandateProgramId ?? 'CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k';
      return {
        ok: true,
        rootPda: findRootPda(programId, mandatePda, seq).address,
        merkleRoot: combined.merkleRoot,
        leafCount: receipts.length,
        seq: Number(seq),
        signature: anchored.signature,
        settlements,
      };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'anchor_root failed' };
    }
  }


  async function executeDistribution(paymentId: string, options?: { approval?: 'distribute' }): Promise<PaidResult | FailedPaymentResult> {
    let broadcast = false;
    let signature: string | null = null;
    try {
      await assertDevnet();
      const stored = payments.get(paymentId);
      if (!stored?.settleSignature || !stored.receipt) {
        return fail({ code: 'CONFIG_INVALID', stage: 'distribute', message: 'Settlement receipt is required before distribution', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'executeSettlement first' });
      }
      const prepared = await prepareDistribution(paymentId);
      if (prepared.status !== 'simulated' && prepared.status !== 'awaiting_approval') {
        return prepared as FailedPaymentResult;
      }
      const blocked = await assertMayBroadcast('distribute', options?.approval, prepared.review);
      if (blocked) return blocked;

      const mint = new PublicKey(stored.channel.mint);
      const payeeAta = getAssociatedTokenAddressSync(mint, new PublicKey(stored.channel.payee));
      const treasuryAta = getAssociatedTokenAddressSync(mint, TREASURY_OWNER);
      const escrow = getAssociatedTokenAddressSync(mint, new PublicKey(stored.request.channel), true);
      const payeeBefore = BigInt((await config.connection.getTokenAccountBalance(payeeAta, 'confirmed')).value.amount);
      const treasuryBefore = BigInt((await config.connection.getTokenAccountBalance(treasuryAta, 'confirmed')).value.amount);

      const fund = await loadFund();
      const tx = await buildDistributeTx(stored);
      broadcast = true;
      signature = await fund.submitSigned(config.connection, tx, { feePayer: config.wallet, wallet: config.wallet });
      stored.distributeSignature = signature;

      const after = (await readChannel(stored.request.channel)).decoded;
      const payeeAfter = BigInt((await config.connection.getTokenAccountBalance(payeeAta, 'confirmed')).value.amount);
      const treasuryAfter = BigInt((await config.connection.getTokenAccountBalance(treasuryAta, 'confirmed')).value.amount);
      const escrowAmount = (await config.connection.getTokenAccountBalance(escrow, 'confirmed')).value.amount;
      const verified = await verifyReceipt(stored.receipt, { trustedInstanceKeys: [stored.receipt.instance.publicKey] });

      if (after.payoutWatermark < stored.request.amount) {
        return fail({
          code: 'SETTLE_OK_DISTRIBUTE_FAILED',
          stage: 'distribute',
          message: 'Distribution did not advance the payout watermark as expected',
          broadcast: true,
          outcomeKnown: true,
          signature,
          fundsMayHaveMoved: payeeAfter !== payeeBefore,
          nextAction: 'Keep settleSignature; inspect balances before any distribute retry',
        });
      }
      return {
        status: 'paid',
        stage: 'distribute',
        settleSignature: stored.settleSignature,
        distributeSignature: signature,
        settled: after.settled.toString(),
        payoutWatermark: after.payoutWatermark.toString(),
        payeeDelta: (payeeAfter - payeeBefore).toString(),
        treasuryDelta: (treasuryAfter - treasuryBefore).toString(),
        escrowAmount,
        receipt: stored.receipt,
        receiptVerifyPass: verified.pass,
        broadcast: true,
        paymentId,
      };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: broadcast ? 'SETTLE_OK_DISTRIBUTE_FAILED' : 'SUBMIT_FAILED',
        stage: 'distribute',
        message: error instanceof Error ? error.message : 'Distribution execute failed',
        broadcast,
        outcomeKnown: !broadcast,
        signature,
        fundsMayHaveMoved: broadcast,
        nextAction: 'Settlement evidence is preserved; check signature status before retrying distribute only',
      });
    }
  }

  async function pay(request: PayRequest): Promise<PaymentResult> {
    const voucher = await requestPayment(request);
    if (voucher.status !== 'voucher_ready') return voucher;
    const settlePrep = await prepareSettlement(voucher.paymentId);
    if (settlePrep.status !== 'simulated' && settlePrep.status !== 'awaiting_approval') return settlePrep;
    if (config.execution === 'prepareOnly') return settlePrep;
    const settled = await executeSettlement(voucher.paymentId, { approval: 'settle' });
    if (settled.status !== 'partial' && settled.status !== 'confirmed') return settled;
    const distPrep = await prepareDistribution(voucher.paymentId);
    if (distPrep.status !== 'simulated' && distPrep.status !== 'awaiting_approval') {
      return fail({
        code: 'SETTLE_OK_DISTRIBUTE_FAILED',
        stage: 'distribute',
        message: distPrep.status === 'failed' || distPrep.status === 'unknown' ? distPrep.error.message : 'Distribution prepare failed after settlement',
        broadcast: false,
        outcomeKnown: true,
        signature: settled.settleSignature,
        fundsMayHaveMoved: false,
        nextAction: 'Settlement is confirmed; retry prepareDistribution later',
      });
    }
    const distributed = await executeDistribution(voucher.paymentId, { approval: 'distribute' });
    if (distributed.status !== 'paid' || !request.mandateAddress) return distributed;
    return { ...distributed, ...payAnchorAttachment(await anchorMandateVouchers(request.mandateAddress)) };
  }

  async function loadMandateForClient(address: string): Promise<LoadMandateResult> {
    await assertDevnet();
    return loadMandate(config.connection, address, { programId: config.mandateProgramId });
  }

  async function recheckMandate(stored: StoredPayment): Promise<FailedPaymentResult | null> {
    const address = stored.request.mandateAddress;
    if (requireOnChainMandate && !address) {
      return fail({
        code: 'MANDATE_INVALID',
        stage: 'settle',
        message: 'requireOnChainMandate is set but mandateAddress is missing',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Pass the Atlas Mandate PDA address',
      });
    }
    if (!address) return null;
    try {
      const onChain = await loadMandate(config.connection, address, { programId: config.mandateProgramId });
      assertPaymentAgainstOnChainMandate(onChain, {
        agentPublicKey: stored.request.mandate.agent.publicKey,
        mint: stored.request.mint,
        deltaAmount: stored.request.amount - stored.channel.settled,
      });
      return null;
    } catch (error) {
      return fail({
        code: 'MANDATE_INVALID',
        stage: 'settle',
        message: error instanceof Error ? error.message : 'On-chain mandate rejected settlement',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'A revoked or over-cap mandate is not settled by this client',
      });
    }
  }

  async function openChannel(input: OpenChannelCall): Promise<OpenChannelResult> {
    try {
      assertGraceSeconds(input.graceSeconds);
    } catch (error) {
      return fail({
        code: 'CONFIG_INVALID',
        stage: 'open',
        message: error instanceof Error ? error.message : 'Grace period is invalid',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Pass graceSeconds of 1 or more. The payment program rejects 0',
      });
    }
    try {
      await assertDevnet();
      if (input.deposit <= 0n) {
        return fail({ code: 'CONFIG_INVALID', stage: 'open', message: 'deposit must be positive', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass the upfront amount' });
      }
      const fund = await loadFund() as FundHelpers & {
        fundChannel: (session: Record<string, unknown>, mint: string, wallet: unknown) => Promise<{ channel: string; deposit: string; openSignature: string }>;
        prepareChannelOpen: (session: Record<string, unknown>) => Promise<{ transaction: Transaction; channel: string; channelAta: string }>;
      };
      const mint = new PublicKey(input.mint);
      const payer = new PublicKey(config.wallet.publicKey);
      const session = {
        connection: config.connection,
        payer: config.wallet,
        wallet: config.wallet,
        recipient: { publicKey: new PublicKey(input.payee) },
        mint,
        agent: { publicKey: input.agent },
        depositAmount: input.deposit,
        payerAta: { address: getAssociatedTokenAddressSync(mint, payer) },
        payment: { salt: input.salt ?? BigInt(Date.now()), graceSeconds: input.graceSeconds },
      };
      if (!input.submit) {
        const prepared = await fund.prepareChannelOpen(session);
        return {
          status: 'prepared',
          channel: prepared.channel,
          escrow: prepared.channelAta,
          transactionBase64: Buffer.from(prepared.transaction.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64'),
          graceSeconds: input.graceSeconds,
          broadcast: false,
        };
      }
      const opened = await fund.fundChannel(session, input.mint, config.wallet);
      return {
        status: 'confirmed',
        channel: opened.channel,
        escrow: getAssociatedTokenAddressSync(mint, new PublicKey(opened.channel), true).toBase58(),
        deposit: opened.deposit,
        openSignature: opened.openSignature,
        graceSeconds: input.graceSeconds,
        broadcast: true,
      };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: 'SUBMIT_FAILED',
        stage: 'open',
        message: error instanceof Error ? error.message : 'Channel open failed',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Inspect the payer token balance and retry openChannel',
      });
    }
  }

  async function topUp(input: TopUpCall): Promise<TopUpResult> {
    try {
      await assertDevnet();
      if (input.amount <= 0n) {
        return fail({ code: 'CONFIG_INVALID', stage: 'top_up', message: 'amount must be positive', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass the base units to add' });
      }
      const { decoded } = await readChannel(input.channel);
      if (decoded.payer !== config.wallet.publicKey) {
        return fail({ code: 'CHANNEL_INVALID', stage: 'top_up', message: 'Only the channel payer (the owner) can top up', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Connect the owner wallet that opened the channel' });
      }
      const mint = new PublicKey(decoded.mint);
      const payer = new PublicKey(config.wallet.publicKey);
      const channel = new PublicKey(input.channel);
      const tx = new Transaction().add(buildTopUpInstruction({
        payer,
        channel,
        payerAta: getAssociatedTokenAddressSync(mint, payer),
        escrow: getAssociatedTokenAddressSync(mint, channel, true),
        mint,
        amount: input.amount,
      }));
      tx.feePayer = payer;
      if (!input.submit) {
        tx.recentBlockhash = (await config.connection.getLatestBlockhash('confirmed')).blockhash;
        return {
          status: 'prepared',
          channel: input.channel,
          transactionBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64'),
          broadcast: false,
        };
      }
      const fund = await loadFund();
      const signature = await fund.submitSigned(config.connection, tx, { feePayer: config.wallet, wallet: config.wallet });
      const after = (await readChannel(input.channel)).decoded;
      return { status: 'confirmed', channel: input.channel, signature, depositBefore: decoded.deposit.toString(), depositAfter: after.deposit.toString(), broadcast: true };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: 'SUBMIT_FAILED',
        stage: 'top_up',
        message: error instanceof Error ? error.message : 'Top-up failed',
        broadcast: false,
        outcomeKnown: false,
        fundsMayHaveMoved: true,
        nextAction: 'Read the channel deposit before trying again',
      });
    }
  }

  async function refundRemainder(input: RefundCall): Promise<RefundResult> {
    try {
      await assertDevnet();
      if (input.channel === RECOVERY_CHANNEL) {
        return fail({ code: 'CHANNEL_FORBIDDEN', stage: 'refund', message: 'Recovery channel is forbidden for SDK payments', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Use a different channel' });
      }
      const info = await config.connection.getAccountInfo(new PublicKey(input.channel), 'confirmed');
      if (!info || !info.owner.equals(PROGRAM_ID)) {
        return fail({ code: 'CHANNEL_INVALID', stage: 'refund', message: 'Channel account is missing or not owned by the payment program', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass an open Atlas Rail channel' });
      }
      const state = readCloseState(info.data);
      if (state.payer !== config.wallet.publicKey) {
        return fail({ code: 'CHANNEL_INVALID', stage: 'refund', message: 'Wallet is not the channel payer', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Connect the payer wallet' });
      }
      if (input.payee && input.payee.publicKey.toBase58() !== state.payee) {
        return fail({ code: 'CHANNEL_INVALID', stage: 'refund', message: 'Payee key does not match the channel', broadcast: false, outcomeKnown: true, fundsMayHaveMoved: false, nextAction: 'Pass the channel payee key for an immediate refund' });
      }
      const slot = BigInt(await config.connection.getSlot('confirmed'));
      const plan = refundPlan(state, BigInt(Math.floor(Date.now() / 1000)), Boolean(input.payee), slot);
      if (!plan.ready) {
        if (plan.reclaimAfterSlot != null) {
          return { status: 'rent_pending', channel: input.channel, reclaimAfterSlot: plan.reclaimAfterSlot.toString(), broadcast: false };
        }
        return { status: 'waiting', channel: input.channel, graceEndsAt: plan.graceEndsAt!.toString(), broadcast: false };
      }
      if (plan.steps.length === 0) return { status: 'closed', channel: input.channel, broadcast: false };
      if (!input.submit) return { status: 'prepared', channel: input.channel, steps: plan.steps, broadcast: false };

      const fund = await loadFund();
      const payer = new PublicKey(config.wallet.publicKey);
      const channel = new PublicKey(input.channel);
      const mint = new PublicKey(state.mint);
      const escrow = getAssociatedTokenAddressSync(mint, channel, true);
      const payerAta = getAssociatedTokenAddressSync(mint, payer);
      const signatures: string[] = [];
      let payerBeforeBalance: bigint | null = null;
      const rentPayer = new PublicKey(state.rentPayer);
      let rentBefore: bigint | null = null;
      const payee = new PublicKey(state.payee);
      const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('event_authority')], PROGRAM_ID);
      for (const step of plan.steps) {
        if (step === 'withdraw') {
          payerBeforeBalance = BigInt((await config.connection.getTokenAccountBalance(payerAta, 'confirmed')).value.amount);
        }
        if (step === 'close_escrow' || step === 'reclaim') {
          rentBefore = BigInt(await config.connection.getBalance(rentPayer, 'confirmed'));
        }
        const ix = step === 'settle_and_seal'
          ? buildSettleAndSealInstruction(input.payee!.publicKey, channel)
          : step === 'request_close'
            ? buildRequestCloseInstruction(payer, channel)
            : step === 'seal'
              ? buildSealInstruction(channel)
              : step === 'withdraw'
                ? buildWithdrawPayerInstruction({ payer, channel, escrow, payerAta, mint })
                : step === 'close_escrow'
                  ? buildCloseEscrowInstruction({
                    channel,
                    payer,
                    rentPayer,
                    escrow,
                    payerAta,
                    payeeAta: getAssociatedTokenAddressSync(mint, payee),
                    treasuryAta: getAssociatedTokenAddressSync(mint, TREASURY_OWNER),
                    mint,
                    eventAuthority,
                  })
                  : buildReclaimInstruction(channel, rentPayer);
        const localSigners = step === 'settle_and_seal' ? [input.payee!] : [];
        signatures.push(await fund.submitSigned(config.connection, new Transaction().add(ix), {
          feePayer: config.wallet,
          wallet: config.wallet,
          localSigners,
        }));
      }
      if (plan.steps.length === 1 && plan.steps[0] === 'request_close') {
        const after = readCloseState((await config.connection.getAccountInfo(channel, 'confirmed'))!.data);
        const graceEndsAt = after.closureStartedAt + BigInt(after.gracePeriod);
        return { status: 'closing', channel: input.channel, requestCloseSignature: signatures[0]!, graceEndsAt: graceEndsAt.toString(), broadcast: true };
      }
      const afterInfo = await config.connection.getAccountInfo(channel, 'confirmed');
      if (!afterInfo) {
        const rentAfter = BigInt(await config.connection.getBalance(rentPayer, 'confirmed'));
        return {
          status: 'reclaimed',
          channel: input.channel,
          signatures,
          rentLamports: (rentBefore == null ? 0n : rentAfter - rentBefore).toString(),
          broadcast: true,
        };
      }
      const afterState = readCloseState(afterInfo.data);
      if (afterState.status === 3) {
        return {
          status: 'rent_pending',
          channel: input.channel,
          reclaimAfterSlot: (afterState.openSlot + 1500n).toString(),
          signatures,
          broadcast: true,
        };
      }
      let escrowAmount = '0';
      const escrowInfo = await config.connection.getAccountInfo(escrow, 'confirmed');
      if (escrowInfo) escrowAmount = (await config.connection.getTokenAccountBalance(escrow, 'confirmed')).value.amount;
      const payerAfter = BigInt((await config.connection.getTokenAccountBalance(payerAta, 'confirmed')).value.amount);
      const payerDelta = payerBeforeBalance == null ? 0n : payerAfter - payerBeforeBalance;
      const mandatePda = [...payments.values()].find((payment) => payment.request.channel === input.channel)?.request.mandateAddress;
      const batched = mandatePda ? await anchorMandateVouchers(mandatePda) : null;
      return {
        status: 'refunded',
        channel: input.channel,
        signatures,
        payerDelta: payerDelta.toString(),
        escrowAmount,
        ...(batched?.ok ? { anchor: batched } : {}),
        ...(batched && !batched.ok && batched.message !== 'empty' ? { anchorError: batched.message } : {}),
        broadcast: true,
      };
    } catch (error) {
      if (error instanceof AtlasRailError) return fail(error.info);
      return fail({
        code: 'SUBMIT_FAILED',
        stage: 'refund',
        message: error instanceof Error ? error.message : 'Refund failed',
        broadcast: false,
        outcomeKnown: true,
        fundsMayHaveMoved: false,
        nextAction: 'Read the channel status before retrying refundRemainder',
      });
    }
  }

  return {
    execution: config.execution,
    requestPayment,
    loadMandate: loadMandateForClient,
    createMandate(input) {
      return assertDevnet().then(() => runCreateMandate(config.connection, input, config.mandateProgramId));
    },
    async revokeMandate(input) {
      await assertDevnet();
      const revoked = await runRevokeMandate(config.connection, input, config.mandateProgramId);
      if (revoked.status !== 'confirmed' || !input.channel || input.channel === RECOVERY_CHANNEL) return revoked;
      try {
        const info = await config.connection.getAccountInfo(new PublicKey(input.channel), 'confirmed');
        if (!info || !info.owner.equals(PROGRAM_ID)) {
          return { ...revoked, settleBlocked: false, closeError: 'Channel account is missing or not owned by the payment program' };
        }
        const state = readCloseState(info.data);
        const block = revokeChannelStep(state, config.wallet.publicKey, input.payee?.publicKey.toBase58() ?? null);
        if (block === 'blocked') return { ...revoked, settleBlocked: true };
        if (block === 'payee-mismatch') {
          return { ...revoked, settleBlocked: false, closeError: 'Payee key does not match the channel' };
        }
        if (block === 'payer-mismatch') {
          return { ...revoked, settleBlocked: false, closeError: 'Wallet is not the channel payer, so the signed voucher can still be settled' };
        }
        const fund = await loadFund();
        const channelKey = new PublicKey(input.channel);
        const ix = block === 'seal_now'
          ? buildSettleAndSealInstruction(input.payee!.publicKey, channelKey)
          : buildRequestCloseInstruction(new PublicKey(config.wallet.publicKey), channelKey);
        const requestCloseSignature = await fund.submitSigned(
          config.connection,
          new Transaction().add(ix),
          { feePayer: config.wallet, wallet: config.wallet, localSigners: block === 'seal_now' ? [input.payee!] : [] },
        );
        return { ...revoked, requestCloseSignature, settleBlocked: true };
      } catch (error) {
        return {
          ...revoked,
          settleBlocked: false,
          closeError: error instanceof Error ? error.message : 'Channel close failed after revoke',
        };
      }
    },
    anchorRoot(input) {
      return assertDevnet().then(() => runAnchorRoot(config.connection, input, config.mandateProgramId));
    },
    async anchorVouchers(mandatePda: string) {
      await assertDevnet();
      const batched = await anchorMandateVouchers(mandatePda);
      if (!batched.ok && batched.message === 'empty') return { status: 'empty' as const, mandatePda };
      if (!batched.ok) {
        return fail({
          code: 'SUBMIT_FAILED',
          stage: 'anchor',
          message: batched.message,
          broadcast: false,
          outcomeKnown: true,
          fundsMayHaveMoved: false,
          nextAction: 'The payments stand. Retry anchorVouchers for this mandate',
        });
      }
      return { status: 'anchored' as const, mandatePda, ...batched };
    },
    prepareSettlement,
    executeSettlement,
    prepareDistribution,
    executeDistribution,
    pay,
    openChannel,
    refundRemainder,
    topUp,
  };
}
