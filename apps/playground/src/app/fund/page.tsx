'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { fundAccounts, fundingPreview, prepareChannelOpen, quoteAtaFunding, submitPreparedOpen, type ChannelOpenPlan } from 'atlasrails/fund';
import {
  DEVNET_RPC,
  DEPOSIT_TOKENS,
  FUND_AGENT,
  FUND_MINT,
  FUND_PAYEE,
  browserFundingSession,
  injectedWallet,
  phantomSigner,
  reviewChannelOpen,
  reviewFunding,
  type FundingReview,
} from '@/lib/phantom-fund';

const SOL_FLOOR = 20_000_000n;

export default function FundPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [genesis, setGenesis] = useState<string | null>(null);
  const [review, setReview] = useState<FundingReview | null>(null);
  const [openPlan, setOpenPlan] = useState<ChannelOpenPlan | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof fundingPreview>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ channel: string; openSignature: string; ataSignature?: string } | null>(null);
  const [submitHold, setSubmitHold] = useState(false);
  const [retrySameChannel, setRetrySameChannel] = useState(false);

  async function connect() {
    setError(null);
    setResult(null);
    setOpenPlan(null);
    setSubmitHold(false);
    setRetrySameChannel(false);
    const provider = injectedWallet();
    if (!provider) {
      setError('No wallet found. Install Phantom, then refresh this page.');
      return;
    }
    setBusy(true);
    try {
      const connected = await provider.connect();
      const key = connected.publicKey as PublicKey;
      const payer = key.toBase58();
      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const [genesis, lamports, accounts] = await Promise.all([
        connection.getGenesisHash(),
        connection.getBalance(key),
        fundingPreview(connection, { mint: FUND_MINT, payer, recipient: FUND_PAYEE }),
      ]);
      const quote = await quoteAtaFunding(connection, {
        payer,
        mint: FUND_MINT,
        payee: FUND_PAYEE,
        payeeAta: accounts.payeeAta,
        treasuryOwner: accounts.treasury,
        treasuryAta: accounts.treasuryAta,
        createPayee: !accounts.payeeAtaExists,
        createTreasury: !accounts.treasuryAtaExists,
      });
      const next = reviewFunding({
        rpc: DEVNET_RPC,
        genesis,
        mint: FUND_MINT,
        mintOwner: accounts.mintOwner,
        decimals: accounts.mintDecimals,
        payer,
        tokenMint: accounts.tokenMint,
        tokenOwner: accounts.tokenOwner,
        tokenBalance: accounts.tokenBalance === null ? null : BigInt(accounts.tokenBalance),
        solLamports: BigInt(lamports),
        solFloor: SOL_FLOOR,
        payerAta: accounts.payerAta,
        payee: FUND_PAYEE,
        treasury: accounts.treasury,
        payeeAta: accounts.payeeAta,
        treasuryAta: accounts.treasuryAta,
        payeeAtaExists: accounts.payeeAtaExists,
        treasuryAtaExists: accounts.treasuryAtaExists,
        ataTransactionRequired: quote.required,
        computeUnitLimit: quote.computeUnitLimit ?? null,
        priorityPriceMicroLamports: quote.priorityPriceMicroLamports ?? null,
        maxPriorityFeeLamports: quote.maxPriorityFeeLamports ?? null,
        baseFeeLamports: quote.baseFeeLamports ?? null,
        ataRentLamports: quote.ataRentLamports ?? null,
        feeCapLamports: quote.feeCapLamports ?? null,
        feeLamports: quote.feeLamports ?? null,
      });
      setAddress(payer);
      setGenesis(genesis);
      setPreview(accounts);
      setReview(next);
      if (next.errors.length === 0 && !quote.required && next.depositBase !== null) {
        setOpenPlan(await prepareOpen(connection, payer, accounts.payerAta, next.depositBase));
      }
    } catch (cause) {
      setAddress(null);
      setGenesis(null);
      setPreview(null);
      setReview(null);
      setOpenPlan(null);
      setError(cause instanceof Error ? cause.message : 'The wallet rejected the connection.');
    } finally {
      setBusy(false);
    }
  }

  function prepareOpen(connection: Connection, payer: string, payerAta: string, depositBase: bigint) {
    const provider = injectedWallet();
    if (!provider) throw new Error('No wallet found. Install Phantom, then refresh this page.');
    const wallet = phantomSigner(provider);
    if (wallet.publicKey !== payer) throw new Error('Wallet public key does not match the review');
    return prepareChannelOpen({
      ...browserFundingSession({ connection, depositBase }),
      mint: new PublicKey(FUND_MINT),
      wallet,
      payerAta: { address: new PublicKey(payerAta) },
    });
  }

  async function disconnect() {
    setError(null);
    await injectedWallet()?.disconnect().catch(() => undefined);
    setAddress(null);
    setGenesis(null);
    setPreview(null);
    setReview(null);
    setOpenPlan(null);
    setResult(null);
  }

  async function fund() {
    if (!address || !preview || !review || review.errors.length > 0 || review.depositBase === null) return;
    const provider = injectedWallet();
    if (!provider) {
      setError('No wallet found. Install Phantom, then refresh this page.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wallet = phantomSigner(provider);
      if (wallet.publicKey !== address) throw new Error('Wallet public key does not match the review');
      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const session = {
        ...browserFundingSession({ connection, depositBase: review.depositBase }),
        mint: new PublicKey(FUND_MINT),
        wallet,
        payerAta: { address: new PublicKey(preview.payerAta) },
      };
      if (review.ataTransactionRequired) {
        await fundAccounts(session, FUND_MINT, wallet);
        const prepared = await prepareChannelOpen(session);
        setReview({ ...review, ataTransactionRequired: false });
        setOpenPlan(prepared);
        return;
      }
      if (submitHold && !retrySameChannel) return;
      if (!openPlan || reviewChannelOpen(openPlan, { payer: address, payee: FUND_PAYEE, agent: FUND_AGENT, deposit: review.depositBase.toString() }).length > 0) return;
      const opened = await submitPreparedOpen(session, openPlan);
      setSubmitHold(false);
      setRetrySameChannel(false);
      setResult(opened);
    } catch (cause) {
      const retrySafe = Boolean(cause && typeof cause === 'object' && 'retrySafe' in cause && cause.retrySafe);
      setSubmitHold(true);
      setRetrySameChannel(retrySafe);
      setError(cause instanceof Error ? cause.message : 'Funding failed');
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(review && review.errors.length === 0 && review.depositBase !== null);
  const openErrors = review && address && openPlan
    ? reviewChannelOpen(openPlan, { payer: address, payee: FUND_PAYEE, agent: FUND_AGENT, deposit: review.depositBase?.toString() ?? '' })
    : [];
  const openReady = Boolean(openPlan && openErrors.length === 0 && !review?.ataTransactionRequired);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="text-sm text-mutedText hover:text-white">
        Atlas Rail
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold">Fund a devnet channel</h1>
      <p className="mt-3 text-sm text-mutedText">
        Development only. Phantom pays the fee and signs the open. This page does not read a local payer secret, does not mint tokens, and does not send a transaction until you confirm the review.
      </p>
      <button
        type="button"
        onClick={address ? disconnect : connect}
        disabled={busy}
        className="mt-8 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
      >
        {busy && !review ? 'Connecting…' : address ? 'Disconnect' : 'Connect Phantom'}
      </button>
      {error ? <p className="mt-4 text-sm text-deny">{error}</p> : null}
      {address && review && preview ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-left text-sm">
          <p>RPC {DEVNET_RPC}</p>
          <p className="mt-2 break-all">Cluster {genesis}</p>
          <p className="mt-2 break-all">Fee payer {address}</p>
          <p className="mt-2 break-all">Payer token account {preview.payerAta}</p>
          <p className="mt-2">Token balance {preview.tokenBalance ?? 'none'}. Deposit {DEPOSIT_TOKENS} tokens, {review.depositBase?.toString() ?? 'unavailable'} base units.</p>
          <p className="mt-2 break-all">Mint {FUND_MINT}</p>
          <p className="mt-2">Decimals {preview.mintDecimals ?? 'missing'}.</p>
          <p className="mt-2 break-all">Payee {FUND_PAYEE}</p>
          <p className="mt-2 break-all">Treasury {preview.treasury}</p>
          <p className="mt-2 break-all">Channel agent {FUND_AGENT}</p>
          {review.ataTransactionRequired ? (
            <div className="mt-4 space-y-2">
              <p>Compute unit limit {review.computeUnitLimit ?? 'unavailable'}</p>
              <p>Priority fee price {review.priorityPriceMicroLamports ?? 'unavailable'} micro-lamports per unit</p>
              <p>Maximum priority fee {review.maxPriorityFeeLamports ?? 'unavailable'} lamports</p>
              <p>Base fee estimate {review.baseFeeLamports ?? 'unavailable'} lamports</p>
              <p>ATA rent {review.ataRentLamports ?? 'unavailable'} lamports</p>
              <p>Maximum SOL debit {review.baseFeeLamports !== null && review.maxPriorityFeeLamports !== null && review.ataRentLamports !== null ? review.baseFeeLamports + review.maxPriorityFeeLamports + review.ataRentLamports : 'unavailable'} lamports</p>
              <p>Fee cap {review.feeCapLamports ?? 'unavailable'} lamports</p>
            </div>
          ) : null}
          {openPlan ? (
            <div className="mt-4 space-y-2">
              <p className="break-all">Channel {openPlan.channel}</p>
              <p>Deposit {openPlan.deposit} base units</p>
              <p className="break-all">Payer {openPlan.payer}</p>
              <p className="break-all">Payee {openPlan.payee}</p>
              <p className="break-all">Agent {openPlan.agent}</p>
              <p className="break-all">Program {openPlan.programId}</p>
              <p>Compute unit limit {openPlan.computeUnitLimit}</p>
              <p>Priority fee price {openPlan.priorityPriceMicroLamports} micro-lamports per unit</p>
              <p>Channel rent {openPlan.channelRentLamports} lamports</p>
              <p>Channel token account rent {openPlan.tokenRentLamports} lamports</p>
              <p>Base fee {openPlan.baseFeeLamports} lamports</p>
              <p>Maximum SOL debit {openPlan.baseFeeLamports + openPlan.maxPriorityFeeLamports + openPlan.channelRentLamports + openPlan.tokenRentLamports} lamports</p>
              <p>The client built this instruction. The deployed program source and an IDL are not in this repo, so the token movement is not verified from the program.</p>
            </div>
          ) : null}
          {openErrors.length > 0 ? (
            <ul className="mt-4 space-y-1 text-deny">
              {openErrors.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
          <ol className="mt-4 list-decimal space-y-2 pl-5">
            {review.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {review.errors.length > 0 ? (
            <ul className="mt-4 space-y-1 text-deny">
              {review.errors.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : (
            <p className="mt-4 text-mutedText">SOL checked against a {Number(SOL_FLOOR) / LAMPORTS_PER_SOL} SOL floor for fees and rent.</p>
          )}
          {review.errors.some((item) => item.includes('does not exist')) ? (
            <p className="mt-4 text-mutedText">This mint is Circle devnet USDC. The demo documents getting it from faucet.circle.com on Solana Devnet. This page does not mint or transfer it.</p>
          ) : null}
          <button
            type="button"
            onClick={fund}
            disabled={busy || !ready || (review?.ataTransactionRequired ? false : !openReady) || (submitHold && !retrySameChannel)}
            className="mt-6 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
          >
            {busy ? 'Waiting for Phantom…' : review?.ataTransactionRequired ? 'Create token accounts' : submitHold && retrySameChannel ? 'Submit this channel again' : 'Open the channel'}
          </button>
        </div>
      ) : null}
      {result ? (
        <div className="mt-6 rounded-2xl border border-allow/40 bg-allow/10 p-4 text-left text-sm">
          <p className="break-all">Channel {result.channel}</p>
          {result.ataSignature ? <p className="mt-2 break-all">Token accounts {result.ataSignature}</p> : null}
          <p className="mt-2 break-all">Open {result.openSignature}</p>
        </div>
      ) : null}
    </main>
  );
}
