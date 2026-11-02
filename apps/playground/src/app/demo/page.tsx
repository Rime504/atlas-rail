'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, CheckCircle2, Globe, Loader2, Zap } from 'lucide-react';
import { WEBSITE_URL } from '@/lib/links';
import { Connection, LAMPORTS_PER_SOL, type PublicKey } from '@solana/web3.js';
import { ProgressBar } from '@/components/ProgressBar';
import { VerdictBanner } from '@/components/Verdict';
import { ExplorerLink } from '@/components/Details';

const TOTAL_STEPS = 4;
const DEVNET_RPC = 'https://api.devnet.solana.com';
type InjectedWallet = {
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
};

interface PaymentProof {
  payer: string;
  channel: string;
  channelExplorer: string;
  denial: { signed: boolean; message: string | null };
  settleSignature: string;
  settleExplorer: string;
  anchorSignature: string;
  anchorExplorer: string;
  rootPda: string;
  rootExplorer: string;
  merkleRoot: string | null;
  receiptId: string | null;
  deposit: string | number | null;
  settled: string | number | null;
}

function browserWallet(): InjectedWallet | null {
  const scope = window as Window & { solana?: InjectedWallet; solflare?: InjectedWallet };
  return scope.solana ?? scope.solflare ?? null;
}

export default function DemoPage() {
  const [step, setStep] = useState(1);
  const [address, setAddress] = useState<string | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const [mandateReady, setMandateReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<PaymentProof | null>(null);
  const [localOnly, setLocalOnly] = useState<string | null>(null);

  // On a hosted deployment the demo cannot run (it needs this repo's scripts and a local key file): say so up front.
  useEffect(() => {
    fetch('/api/voucher-demo')
      .then((res) => res.json() as Promise<{ localOnly?: boolean; error?: string }>)
      .then((data) => {
        if (data.localOnly) setLocalOnly(data.error ?? 'This demo runs locally. See the video.');
      })
      .catch(() => undefined);
  }, []);

  async function connect() {
    setError(null);
    const injected = browserWallet();
    if (!injected) {
      setError('No wallet found. Install Phantom or Solflare, switch it to Devnet, then refresh.');
      return;
    }
    setBusy(true);
    try {
      const connected = await injected.connect();
      setAddress(connected.publicKey.toBase58());
      try {
        const balance = await Promise.race([
          new Connection(DEVNET_RPC, 'confirmed').getBalance(connected.publicKey),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
        ]);
        setSol((balance / LAMPORTS_PER_SOL).toFixed(4));
      } catch {
        setSol(null);
      }
    } catch (cause) {
      setAddress(null);
      setSol(null);
      setError(cause instanceof Error ? cause.message : 'The wallet rejected the connection.');
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!address || !mandateReady) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/voucher-demo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payer: address }),
      });
      const data = (await res.json()) as PaymentProof & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Payment failed');
      setProof(data);
      setStep(4);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  const canNext = step === 1 ? Boolean(address) : step === 2 ? mandateReady : step === 3 ? Boolean(proof) : false;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-12 sm:py-16">
      <a href={WEBSITE_URL} target="_blank" rel="noreferrer" className="mb-6 inline-flex items-center gap-1.5 text-sm text-mutedText hover:text-white">
        <Globe className="h-4 w-4" aria-hidden="true" /> Website
      </a>
      {localOnly ? (
        <section className="rounded-2xl border border-border bg-surface p-6">
          <h1 className="font-display text-3xl font-semibold">{localOnly}</h1>
          <p className="mt-3 text-sm text-mutedText">
            This page pays on Solana devnet from a key file on the developer&apos;s machine, so it does not run on a hosted preview.
          </p>
          <Link href="/" className="mt-6 inline-flex items-center gap-2 text-sm text-mutedText hover:text-white">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to the playground
          </Link>
        </section>
      ) : null}
      <div hidden={Boolean(localOnly)}>
      <ProgressBar step={step} total={TOTAL_STEPS} />
      {error ? (
        <div role="alert" className="mb-6 rounded-xl border border-deny/40 bg-deny/10 px-4 py-3 text-sm text-deny">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <section>
          <h1 className="font-display text-3xl font-semibold">Connect your wallet</h1>
          <p className="mt-3 text-sm text-mutedText">
            Phantom or Solflare, on devnet. This account pays the deposit and the network fee. The voucher is signed on this machine only after the mandate allows it.
          </p>
          <ol className="mt-6 space-y-2">
            {['Your wallet is the fee payer', 'Atlas Rail signs the voucher only if the mandate allows it', 'Next, you set the rules for that spend'].map((item, index) => (
              <li key={item} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background font-mono text-xs text-mutedText">{index + 1}</span>
                {item}
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Connecting' : address ? 'Reconnect' : 'Connect wallet'}
          </button>
          {address && !busy ? (
            <div className="mt-6 rounded-2xl border border-allow/40 bg-allow/10 p-4">
              <p className="text-xs uppercase tracking-wide text-allow">Payer connected</p>
              <p className="mt-2 break-all font-mono text-sm">{address}</p>
              <p className="mt-3 text-sm text-mutedText">{sol ? `Devnet balance: ${sol} SOL` : 'Devnet balance unavailable'}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h1 className="font-display text-3xl font-semibold">Create the mandate</h1>
          <p className="mt-3 text-sm text-mutedText">
            Owner, approver, and the voucher signer sign the mandate when you pay. The payee is the recipient created for that channel.
          </p>
          {address ? <p className="mt-4 text-xs text-mutedText">Payer {address}</p> : null}
          <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <FixedRule label="Max per payment" value="1 token" />
              <FixedRule label="Max per day" value="1 token" />
              <FixedRule label="Max total" value="1 token" />
              <FixedRule label="This payment" value="0.01 token" />
              <FixedRule label="Resource" value="http://localhost:4402/research/*" wide />
            </dl>
          </div>
          <div className="mt-6">
            {mandateReady ? (
              <VerdictBanner verdict="ALLOW" headline="These rules will be signed when you pay" />
            ) : (
              <button
                type="button"
                onClick={() => setMandateReady(true)}
                className="inline-flex items-center gap-2 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background shadow-glow"
              >
                Use these rules
              </button>
            )}
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section>
          <h1 className="font-display text-3xl font-semibold">Pay on devnet</h1>
          <p className="mt-3 text-sm text-mutedText">
            The machine pays with the connected devnet fee payer key. Each mandate gets its own random voucher key. The browser extension does not sign the voucher.
          </p>
          <ol className="mt-6 space-y-2">
            {['Open the channel and deposit 0.01', 'Refuse the random recipient', 'Sign the allowed voucher', 'Settle on the payment-channels program', 'Anchor the receipt root'].map((item, index) => (
              <li key={item} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background font-mono text-xs text-mutedText">{index + 1}</span>
                {item}
                {busy ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-mutedText" aria-hidden="true" /> : null}
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={pay}
            disabled={busy || !address || !mandateReady}
            className="mt-8 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Paying…
              </span>
            ) : (
              'Pay on devnet'
            )}
          </button>
          {busy ? <p className="mt-4 text-sm text-mutedText">Two devnet transactions. This usually takes about a minute.</p> : null}
        </section>
      ) : null}

      {step === 4 && proof ? (
        <section>
          <h1 className="font-display text-3xl font-semibold">Settled and anchored</h1>
          <p className="mt-3 text-sm text-mutedText">The chain accepted the voucher. The root account is the separate receipt proof.</p>
          <Flow proof={proof} />
          <div className="mt-6 space-y-3">
            <VerdictBanner verdict="DENY" headline={proof.denial.signed ? 'Attack was signed' : `Refused (${proof.denial.message ?? 'denied'})`} />
            <VerdictBanner verdict="ALLOW" headline="Voucher settled" />
          </div>
          <div className="mt-6 space-y-4">
            <ProofRow
              label="Channel"
              hint="Escrow record. Deposit and settled amount live here. The tokens sit in its token account."
              value={proof.channel}
              href={proof.channelExplorer}
            />
            <ProofRow label="Settle transaction" hint="The payment. The program accepted the signed voucher." value={proof.settleSignature} href={proof.settleExplorer} />
            <ProofRow label="Anchor transaction" hint="Writes the receipt root. It does not move the tokens." value={proof.anchorSignature} href={proof.anchorExplorer} />
            <ProofRow label="Root account" hint="93-byte Merkle root for this receipt." value={proof.rootPda} href={proof.rootExplorer} />
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-surface p-4 text-sm text-mutedText">
            {proof.receiptId ? <p>Receipt {proof.receiptId}</p> : null}
            <p className="mt-2">
              Deposit {String(proof.deposit ?? '10000')} · settled {String(proof.settled ?? '10000')}
            </p>
            {proof.merkleRoot ? <p className="mt-2 break-all font-mono text-xs text-white">{proof.merkleRoot}</p> : null}
          </div>
        </section>
      ) : null}

      <div className="mt-10 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((current) => Math.max(1, current - 1))}
          disabled={step === 1 || busy}
          className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            onClick={() => setStep((current) => current + 1)}
            disabled={!canNext || busy}
            className="inline-flex items-center gap-2 rounded-full bg-solana-gradient px-5 py-2.5 text-sm font-semibold text-background disabled:opacity-40"
          >
            Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <Link href="/" className="text-sm text-mutedText hover:text-white">
            Back to start
          </Link>
        )}
      </div>
      </div>
    </main>
  );
}

function FixedRule({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`rounded-xl bg-background px-4 py-3${wide ? ' col-span-2' : ''}`}>
      <dt className="text-xs uppercase tracking-wide text-mutedText">{label}</dt>
      <dd className="mt-1 break-all font-display text-base font-semibold">{value}</dd>
    </div>
  );
}

const FLOW = [
  { title: 'Agent asks', body: 'The agent requests a voucher for this channel.' },
  { title: 'Gate checks', body: 'Atlas Rail compares the delta with the mandate.' },
  { title: 'Sign if allowed', body: 'The voucher key signs only an ALLOW.' },
  { title: 'Settle', body: 'The payment-channels program accepts the voucher.' },
  { title: 'Anchor', body: 'anchor_root stores the receipt Merkle root.' },
] as const;

function Flow({ proof }: { proof: PaymentProof }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (lit >= FLOW.length) return;
    const timer = setTimeout(() => setLit((current) => current + 1), 650);
    return () => clearTimeout(timer);
  }, [lit]);
  return (
    <ol className="mt-6">
      {FLOW.map((node, index) => {
        const on = index < lit;
        const href = index === 3 ? proof.settleExplorer : index === 4 ? proof.rootExplorer : null;
        return (
          <li key={node.title}>
            {index > 0 ? (
              <div className="flex justify-center py-1" aria-hidden="true">
                <Zap className={`h-4 w-4 ${on ? 'animate-pulse text-solana-green' : 'text-border'}`} />
              </div>
            ) : null}
            <div className={`rounded-2xl border px-4 py-3 transition ${on ? 'border-allow/50 bg-allow/10 shadow-glow-green' : 'border-border bg-surface'}`}>
              <p className="text-sm font-semibold">{node.title}</p>
              <p className="mt-1 text-xs text-mutedText">{node.body}</p>
              {href && on ? <ExplorerLink url={href} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ProofRow({ label, hint, value, href }: { label: string; hint: string; value: string; href: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-allow" aria-hidden="true" />
        <p className="text-xs uppercase tracking-wide text-mutedText">{label}</p>
      </div>
      <p className="mt-2 text-sm text-white/90">{hint}</p>
      <p className="mt-2 break-all font-mono text-xs">{value}</p>
      <ExplorerLink url={href} />
    </div>
  );
}
