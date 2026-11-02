'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Connection, LAMPORTS_PER_SOL, type PublicKey } from '@solana/web3.js';

const DEVNET_RPC = 'https://api.devnet.solana.com';

type InjectedWallet = {
  isPhantom?: boolean;
  publicKey: PublicKey | null;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
};

function wallet(): InjectedWallet | null {
  const scope = window as Window & { solana?: InjectedWallet; solflare?: InjectedWallet };
  return scope.solana ?? scope.solflare ?? null;
}

export default function WalletPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function connect() {
    setError(null);
    setCopied(false);
    const injected = wallet();
    if (!injected) {
      setError('No wallet found. Install Phantom or Solflare, then refresh this page.');
      return;
    }
    setBusy(true);
    try {
      const result = await injected.connect();
      const key = result.publicKey;
      setAddress(key.toBase58());
      const balance = await new Connection(DEVNET_RPC, 'confirmed').getBalance(key);
      setSol((balance / LAMPORTS_PER_SOL).toFixed(4));
    } catch (cause) {
      setAddress(null);
      setSol(null);
      setError(cause instanceof Error ? cause.message : 'The wallet rejected the connection.');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setError(null);
    await wallet()?.disconnect().catch(() => undefined);
    setAddress(null);
    setSol(null);
    setCopied(false);
  }

  async function copy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <Link href="/" className="text-sm text-mutedText hover:text-white">
        Atlas Rail
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold">Connect a Solana wallet</h1>
      <p className="mt-3 text-sm text-mutedText">
        Devnet only. This connects the wallet in your browser and shows its public address. That address is the second account for a channel voucher: the payee. It does not sign the voucher and it does not spend the deposit.
      </p>
      <button
        type="button"
        onClick={address ? disconnect : connect}
        disabled={busy}
        className="mt-8 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background disabled:opacity-60"
      >
        {busy ? 'Connecting…' : address ? 'Disconnect' : 'Connect wallet'}
      </button>
      {error ? <p className="mt-4 text-sm text-deny">{error}</p> : null}
      {address ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-4 text-left">
          <p className="text-xs uppercase tracking-wide text-mutedText">Public address</p>
          <p className="mt-2 break-all font-mono text-sm">{address}</p>
          <p className="mt-3 text-sm text-mutedText">Devnet balance: {sol ?? '…'} SOL</p>
          <button type="button" onClick={copy} className="mt-4 text-sm font-medium text-white underline">
            {copied ? 'Copied' : 'Copy address'}
          </button>
        </div>
      ) : null}
    </main>
  );
}
