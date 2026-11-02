'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import { injectedWallet } from '@/lib/phantom-fund';
import {
  DEVNET_GENESIS,
  DEVNET_RPC,
  MANDATE_PROGRAM_ID,
  cosignCreateMandate,
  enforcementMap,
  fetchMandateExport,
  FACILITATOR_MIN_GRACE_SECONDS,
  legacyTransaction,
  mandatePdaForForm,
  parsePubkeyList,
  postChannel,
  prepareCreateMandate,
  prepareRevokeMandate,
  randomMandateHashHex,
  validateMandateForm,
  type MandateFormInput,
} from '@/lib/mandate-create';

type Step = 'form' | 'review' | 'result';

function defaultForm(): MandateFormInput {
  const now = Math.floor(Date.now() / 1000);
  return {
    label: 'My AI agent',
    agentPublicKey: '',
    approverPublicKey: '',
    gateAuthority: '',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    maxPerPayment: '1000',
    maxPerWindow: '10000',
    windowSeconds: '86400',
    maxTotal: '10000',
    escalationThreshold: '1000',
    notBefore: String(now - 60),
    expiresAt: String(now + 86_400),
    allowedRecipients: '',
    allowedResources: 'http://localhost:4402/research/*',
    mandateHashHex: randomMandateHashHex(),
  };
}

export default function MandatePage() {
  const [owner, setOwner] = useState<string | null>(null);
  const [genesis, setGenesis] = useState<string | null>(null);
  const [form, setForm] = useState<MandateFormInput>(defaultForm);
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approverSecret, setApproverSecret] = useState<Keypair | null>(null);
  const [agentSecret, setAgentSecret] = useState<Keypair | null>(null);
  const [payeeSecret, setPayeeSecret] = useState<Keypair | null>(null);
  const [deposit, setDeposit] = useState('10000');
  const [graceSeconds, setGraceSeconds] = useState(String(FACILITATOR_MIN_GRACE_SECONDS));
  const [payAmount, setPayAmount] = useState('1000');
  const [channel, setChannel] = useState<{ channel: string; escrow: string; openSignature: string } | null>(null);
  const [result, setResult] = useState<{
    mandatePda: string;
    signature: string;
    exportJson: string;
    status: 'confirmed' | 'submitted' | 'failed';
  } | null>(null);

  const errors = useMemo(() => validateMandateForm(form, owner), [form, owner]);
  const formOk = Object.keys(errors).length === 0;
  const pda = formOk ? mandatePdaForForm(form) : null;

  async function connect() {
    setError(null);
    const provider = injectedWallet();
    if (!provider) {
      setError('No wallet found. Install Phantom, then refresh.');
      return;
    }
    setBusy(true);
    try {
      const connected = await provider.connect();
      const key = connected.publicKey.toBase58();
      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const hash = await connection.getGenesisHash();
      setOwner(key);
      setGenesis(hash);
      if (hash !== DEVNET_GENESIS) setError('Wallet RPC genesis is not Solana Devnet. Switch Phantom to Devnet.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet connect failed');
    } finally {
      setBusy(false);
    }
  }

  function generateApprover() {
    const kp = Keypair.generate();
    setApproverSecret(kp);
    setForm((f) => ({ ...f, approverPublicKey: kp.publicKey.toBase58() }));
  }

  function generateAgent() {
    const kp = Keypair.generate();
    setAgentSecret(kp);
    setForm((f) => ({ ...f, agentPublicKey: kp.publicKey.toBase58() }));
  }

  function generatePayee() {
    const kp = Keypair.generate();
    setPayeeSecret(kp);
    setForm((f) => ({ ...f, allowedRecipients: kp.publicKey.toBase58() }));
  }

  function downloadKey(label: string, kp: Keypair) {
    const blob = new Blob([JSON.stringify(Array.from(kp.secretKey))], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atlas-${label}-${kp.publicKey.toBase58().slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function goReview() {
    setError(null);
    if (!formOk) {
      setError('Fix the form errors before review.');
      return;
    }
    if (!approverSecret || approverSecret.publicKey.toBase58() !== form.approverPublicKey.trim()) {
      setError('Approver must be generated in this session so it can co-sign create_mandate (program requires three distinct signers).');
      return;
    }
    if (!agentSecret || agentSecret.publicKey.toBase58() !== form.agentPublicKey.trim()) {
      setError('Agent must be generated in this session so it can co-sign create_mandate (proof of possession).');
      return;
    }
    setStep('review');
  }

  async function authorize() {
    setError(null);
    setResult(null);
    if (!owner || !approverSecret || !agentSecret) return;
    const provider = injectedWallet();
    if (!provider?.signTransaction) {
      setError('Wallet disconnected or cannot sign.');
      return;
    }
    setBusy(true);
    try {
      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const genesisHash = await connection.getGenesisHash();
      if (genesisHash !== DEVNET_GENESIS) throw new Error('RPC is not Solana Devnet');
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const prepared = await prepareCreateMandate({ form, owner, recentBlockhash: blockhash });
      const cosigned = cosignCreateMandate(prepared.unsignedBase64, [approverSecret, agentSecret]);
      const signed = await provider.signTransaction(cosigned);
      const signature = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) throw new Error(`create_mandate failed: ${JSON.stringify(confirmation.value.err)}`);
      const loaded = await fetchMandateExport(prepared.mandatePda);
      if (loaded.owner !== owner) throw new Error('On-chain owner does not match the connected wallet');
      if (loaded.agent !== form.agentPublicKey.trim()) throw new Error('On-chain agent mismatch after create');
      if (!loaded.active) throw new Error('Created account is not active (check notBefore / expiresAt)');
      const exported = {
        ...loaded.export,
        tx_signature: signature,
        off_chain: {
          label: form.label.trim() || undefined,
          allowed_recipients: parsePubkeyList(form.allowedRecipients),
          allowed_resources: parsePubkeyList(form.allowedResources),
          note: 'Recipients and resources are enforced only by the Atlas Rail gate, not by the mandate program or payment-channels program.',
        },
      };
      setResult({
        mandatePda: prepared.mandatePda,
        signature,
        exportJson: JSON.stringify(exported, null, 2),
        status: 'confirmed',
      });
      setStep('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authorization failed');
      setResult((prev) => (prev ? { ...prev, status: 'failed' } : null));
    } finally {
      setBusy(false);
    }
  }

  async function sendLegacy(tx: Transaction, cosigner?: Keypair): Promise<string> {
    const provider = injectedWallet();
    if (!provider?.signTransaction) throw new Error('Wallet disconnected or cannot sign.');
    if (cosigner) tx.partialSign(cosigner);
    const signed = await provider.signTransaction(tx);
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' });
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    return signature;
  }

  async function openEscrow() {
    if (!owner || !payeeSecret || !form.agentPublicKey) return;
    setBusy(true);
    setError(null);
    try {
      const prepared = await postChannel({
        action: 'open',
        owner,
        payee: payeeSecret.publicKey.toBase58(),
        agent: form.agentPublicKey.trim(),
        mint: form.mint.trim(),
        deposit,
        graceSeconds: Number(graceSeconds),
        salt: String(Date.now()),
      });
      const openSignature = await sendLegacy(legacyTransaction(prepared.transaction));
      setChannel({ channel: prepared.channel, escrow: prepared.escrow, openSignature });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open failed');
    } finally {
      setBusy(false);
    }
  }

  async function payEscrow() {
    if (!owner || !result || !channel || !agentSecret || !payeeSecret) return;
    setBusy(true);
    setError(null);
    try {
      const request = {
        owner,
        mandatePda: result.mandatePda,
        channel: channel.channel,
        amount: payAmount,
        recipient: payeeSecret.publicKey.toBase58(),
        allowedRecipients: parsePubkeyList(form.allowedRecipients),
      };
      // The server checks the mandate and returns the voucher bytes. The agent key signs them here and never leaves the browser.
      const voucher = await postChannel({ action: 'voucher', ...request });
      const message = Uint8Array.from(atob(voucher.message), (c) => c.charCodeAt(0));
      const signature = ed25519.sign(message, agentSecret.secretKey.slice(0, 32));
      const prepared = await postChannel({
        action: 'pay',
        ...request,
        expiresAt: voucher.expiresAt,
        voucherSignature: btoa(String.fromCharCode(...signature)),
      });
      const settleSignature = await sendLegacy(legacyTransaction(prepared.settle));
      const distributeSignature = await sendLegacy(legacyTransaction(prepared.distribute));
      setError(null);
      setChannel({ ...channel, openSignature: `${settleSignature} ${distributeSignature}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  async function sealAndRefund() {
    if (!owner || !channel || !payeeSecret) return;
    const prepared = await postChannel({
      action: 'seal',
      owner,
      channel: channel.channel,
      payee: payeeSecret.publicKey.toBase58(),
    });
    const sealSignature = await sendLegacy(legacyTransaction(prepared.seal), payeeSecret);
    const withdrawSignature = await sendLegacy(legacyTransaction(prepared.withdraw));
    return { sealSignature, withdrawSignature };
  }

  async function refundNow() {
    if (!channel || !payeeSecret) return;
    setBusy(true);
    setError(null);
    try {
      const refund = await sealAndRefund();
      if (refund) setChannel({ ...channel, openSignature: `${refund.sealSignature} ${refund.withdrawSignature}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refund failed');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!owner || !result) return;
    const provider = injectedWallet();
    if (!provider?.signTransaction) {
      setError('Wallet disconnected or cannot sign.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const connection = new Connection(DEVNET_RPC, 'confirmed');
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const unsigned = await prepareRevokeMandate({
        mandatePda: result.mandatePda,
        authority: owner,
        recentBlockhash: blockhash,
      });
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(unsigned), (c) => c.charCodeAt(0)));
      const signed = await provider.signTransaction(tx);
      const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      await connection.confirmTransaction(signature, 'confirmed');
      const loaded = await fetchMandateExport(result.mandatePda);
      if (!loaded.revoked) throw new Error('Account was not marked revoked');
      if (channel && payeeSecret) {
        const refund = await sealAndRefund();
        if (refund) setChannel({ ...channel, openSignature: `${refund.sealSignature} ${refund.withdrawSignature}` });
      }
      const exported = { ...loaded.export, tx_signature: signature };
      setResult({
        mandatePda: result.mandatePda,
        signature,
        exportJson: JSON.stringify(exported, null, 2),
        status: 'confirmed',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    } finally {
      setBusy(false);
    }
  }

  function field(key: keyof MandateFormInput, label: string, hint?: string) {
    return (
      <label className="block text-left text-sm">
        <span className="font-medium text-white">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-mutedText">{hint}</span> : null}
        <input
          className="mt-1 w-full rounded border border-border bg-surface px-3 py-2 font-mono text-xs text-white"
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
        {errors[key] ? <span className="mt-1 block text-xs text-deny">{errors[key]}</span> : null}
      </label>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-mutedText hover:text-white">← Home</Link>
      <h1 className="mt-4 font-display text-3xl font-semibold text-white">Create an Atlas Mandate</h1>
      <p className="mt-3 text-sm text-mutedText">
        Registers spending limits on the deployed Atlas Mandate program
        {' '}
        <code className="text-xs">{MANDATE_PROGRAM_ID}</code>
        {' '}
        (Devnet). Recipients and resources are exported for the gate only — they are not stored on-chain.
      </p>

      <section className="mt-8 rounded border border-border bg-surface/60 p-4 text-left text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-mutedText">Owner wallet</div>
            <div className="font-mono text-xs text-white">{owner ?? 'Not connected'}</div>
            <div className="mt-1 text-xs text-mutedText">
              Network check: {genesis ? (genesis === DEVNET_GENESIS ? 'Devnet OK' : 'Wrong cluster') : '—'}
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void connect()}
            className="rounded-full bg-solana-gradient px-4 py-2 text-sm font-semibold text-background"
          >
            {owner ? 'Reconnect Phantom' : 'Connect Phantom'}
          </button>
        </div>
      </section>

      {step === 'form' ? (
        <section className="mt-8 space-y-4">
          {field('label', 'Label (UI only)', 'Not written on-chain.')}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded border border-border px-3 py-1 text-xs" onClick={generateApprover}>Generate approver key</button>
            {approverSecret ? (
              <button type="button" className="rounded border border-border px-3 py-1 text-xs" onClick={() => downloadKey('approver', approverSecret)}>Download approver secret</button>
            ) : null}
            <button type="button" className="rounded border border-border px-3 py-1 text-xs" onClick={generateAgent}>Generate agent key</button>
            {agentSecret ? (
              <button type="button" className="rounded border border-border px-3 py-1 text-xs" onClick={() => downloadKey('agent', agentSecret)}>Download agent secret</button>
            ) : null}
            <button type="button" className="rounded border border-border px-3 py-1 text-xs" onClick={generatePayee}>Generate payee key</button>
            {payeeSecret ? (
              <button type="button" className="rounded border border-border px-3 py-1 text-xs" onClick={() => downloadKey('payee', payeeSecret)}>Download payee secret</button>
            ) : null}
          </div>
          {field('approverPublicKey', 'Approver public key', 'Must differ from owner and agent. Co-signs create_mandate.')}
          {field('agentPublicKey', 'Agent public key', 'Must co-sign create_mandate. Give this key to your AI/SDK voucher path.')}
          {field('gateAuthority', 'Gate authority (instance)', 'Signs gate decisions / anchor_root. Usually your Atlas Rail instance key.')}
          {field('mint', 'Token mint')}
          {field('maxPerPayment', 'Max per payment (base units)')}
          {field('maxPerWindow', 'Max per window (base units)')}
          {field('windowSeconds', 'Window seconds')}
          {field('maxTotal', 'Total budget (base units)')}
          {field('escalationThreshold', 'Escalation threshold (base units)')}
          {field('notBefore', 'Not before (unix seconds)')}
          {field('expiresAt', 'Expires at (unix seconds)')}
          {field('mandateHashHex', 'Mandate hash (32-byte hex)', 'PDA seed. Use the SHA-256 of your off-chain mandate body in production.')}
          {field('allowedRecipients', 'Allowed recipients (off-chain)', 'Comma or newline separated. Gate-only.')}
          {field('allowedResources', 'Allowed resources (off-chain)', 'Gate-only URL patterns.')}
          {pda ? <p className="text-xs text-mutedText">Predicted mandate PDA: <code>{pda}</code></p> : null}
          <button
            type="button"
            disabled={!owner || busy}
            onClick={goReview}
            className="rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background disabled:opacity-40"
          >
            Review mandate
          </button>
        </section>
      ) : null}

      {step === 'review' ? (
        <section className="mt-8 space-y-3 rounded border border-border bg-surface/60 p-4 text-left text-sm">
          <h2 className="font-display text-xl text-white">Review before wallet signature</h2>
          <p className="text-mutedText">Program will require signatures from owner (Phantom), approver, and agent. No signature has been requested yet.</p>
          <ul className="space-y-1 font-mono text-xs text-white">
            <li>owner: {owner}</li>
            <li>approver: {form.approverPublicKey}</li>
            <li>agent: {form.agentPublicKey}</li>
            <li>gate: {form.gateAuthority}</li>
            <li>mint: {form.mint}</li>
            <li>maxPerPayment: {form.maxPerPayment}</li>
            <li>maxPerWindow: {form.maxPerWindow}</li>
            <li>windowSeconds: {form.windowSeconds}</li>
            <li>maxTotal: {form.maxTotal}</li>
            <li>expiresAt: {form.expiresAt}</li>
            <li>pda: {pda}</li>
          </ul>
          <div className="flex gap-3 pt-2">
            <button type="button" className="rounded border border-border px-4 py-2" onClick={() => setStep('form')}>Back</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void authorize()}
              className="rounded-full bg-solana-gradient px-6 py-2 text-sm font-semibold text-background"
            >
              Authorize on Solana
            </button>
          </div>
        </section>
      ) : null}

      {step === 'result' && result ? (
        <section className="mt-8 space-y-3 rounded border border-border bg-surface/60 p-4 text-left text-sm">
          <h2 className="font-display text-xl text-white">Mandate {result.status}</h2>
          <p className="font-mono text-xs break-all">Address: {result.mandatePda}</p>
          <p className="font-mono text-xs break-all">Signature: {result.signature}</p>
          <a
            className="text-allow underline"
            href={`https://explorer.solana.com/tx/${result.signature}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Solana Explorer
          </a>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-border px-3 py-1 text-xs"
              onClick={() => void navigator.clipboard.writeText(result.mandatePda)}
            >
              Copy mandate address
            </button>
            <a
              className="rounded border border-border px-3 py-1 text-xs"
              href={`data:application/json,${encodeURIComponent(result.exportJson)}`}
              download={`mandate-${result.mandatePda.slice(0, 8)}.json`}
            >
              Download JSON
            </a>
            <button type="button" className="rounded border border-border px-3 py-1 text-xs" disabled={busy} onClick={() => void revoke()}>
              {channel ? 'Revoke and seal' : 'Revoke on-chain'}
            </button>
          </div>
          <div className="space-y-2 rounded border border-border p-3">
            <p className="text-xs text-mutedText">
              Payee {payeeSecret ? payeeSecret.publicKey.toBase58() : 'not generated'}. Forced close waits {graceSeconds} seconds unless the payee seals now.
            </p>
            <label className="block text-xs text-mutedText">
              Deposit (base units)
              <input className="mt-1 w-full rounded border border-border bg-black/30 px-2 py-1 font-mono text-white" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
            </label>
            <label className="block text-xs text-mutedText">
              Grace seconds (minimum {FACILITATOR_MIN_GRACE_SECONDS})
              <input className="mt-1 w-full rounded border border-border bg-black/30 px-2 py-1 font-mono text-white" value={graceSeconds} onChange={(e) => setGraceSeconds(e.target.value)} />
            </label>
            <label className="block text-xs text-mutedText">
              Payment (base units)
              <input className="mt-1 w-full rounded border border-border bg-black/30 px-2 py-1 font-mono text-white" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="rounded border border-border px-3 py-1 text-xs" disabled={busy || !payeeSecret} onClick={() => void openEscrow()}>Open escrow</button>
              <button type="button" className="rounded border border-border px-3 py-1 text-xs" disabled={busy || !channel} onClick={() => void payEscrow()}>Pay</button>
              <button type="button" className="rounded border border-border px-3 py-1 text-xs" disabled={busy || !channel} onClick={() => void refundNow()}>Refund now</button>
            </div>
            {channel ? (
              <p className="font-mono text-[10px] break-all text-white">
                channel {channel.channel} escrow {channel.escrow} {channel.openSignature}
              </p>
            ) : null}
          </div>
          <pre className="max-h-80 overflow-auto rounded bg-black/40 p-3 text-[10px] text-mutedText">{result.exportJson}</pre>
        </section>
      ) : null}

      <section className="mt-10 text-left text-xs text-mutedText">
        <h3 className="mb-2 text-sm font-medium text-white">What is enforced where</h3>
        <ul className="space-y-2">
          {enforcementMap().map((row) => (
            <li key={row.field}>
              <strong className="text-white">{row.field}</strong>
              {' — '}
              on-chain: {row.onChain ? 'yes' : 'no'}; program: {row.enforcedByProgram}; gate: {row.enforcedByGate}
            </li>
          ))}
        </ul>
        <p className="mt-3">
          Open, pay, and refund run from this page. Refund now and Revoke and seal use the payee key, so an already-signed voucher cannot settle during grace. A forced close without that key still waits the grace stored at open. The page rejects a grace under 900 seconds.
        </p>
      </section>

      {error ? <p className="mt-6 text-sm text-deny">{error}</p> : null}
    </main>
  );
}
