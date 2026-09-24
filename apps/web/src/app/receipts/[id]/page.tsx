'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Download, ExternalLink, MinusCircle, ReceiptText, ShieldCheck, XCircle } from 'lucide-react';
import { useApi } from '../../../lib/hooks';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { Card, EmptyState, MonoAddress, SectionLabel, SkeletonRows, Spinner, StatusBadge } from '../../../components/ui';
import { KeyValue, RuleList } from '../../../components/agent/Bits';
import { explorerTxUrl } from '../../../lib/format';
import { formatToken, formatUnix, hostOf, shortHash } from '../../../lib/agent-format';
import type { BoundReceiptView, ReceiptVerificationView } from '../../../lib/agent-types';

const CHECK_ICON = {
  PASS: { icon: CheckCircle2, cls: 'text-emerald-400' },
  FAIL: { icon: XCircle, cls: 'text-rose-400' },
  SKIP: { icon: MinusCircle, cls: 'text-slate-500' },
} as const;

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const toast = useToast();
  const { data: receipt, loading, error } = useApi<BoundReceiptView>(id ? `/v1/agent/receipts/${id}` : null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<ReceiptVerificationView | null>(null);

  if (loading && !receipt) {
    return (
      <Card>
        <SkeletonRows rows={6} cols={3} />
      </Card>
    );
  }
  if (error || !receipt) {
    return (
      <Card>
        <EmptyState
          icon={ReceiptText}
          title="Receipt not available"
          description={error ?? 'It may belong to another organisation.'}
          action={
            <Link href="/receipts" className="btn-ghost mt-2">
              <ArrowLeft className="h-4 w-4" /> Back to receipts
            </Link>
          }
        />
      </Card>
    );
  }

  const verify = async () => {
    setVerifying(true);
    try {
      const res = await api.post<ReceiptVerificationView>(`/v1/agent/receipts/${receipt.id}/verify`);
      setResult(res);
      if (res.pass) toast.success('Receipt verified', `${res.checks.filter((c) => c.status === 'PASS').length} checks passed.`);
      else toast.error('Verification failed', 'One or more checks did not pass.');
    } catch (err) {
      toast.error('Could not verify', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${receipt.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const record = receipt.decision.record;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/receipts" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> All receipts
        </Link>
        <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-white">{hostOf(receipt.offer.resourceUrl)}</h1>
              <StatusBadge status={receipt.anchor ? 'ANCHORED' : 'UNANCHORED'} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Issued {formatUnix(receipt.issuedAt)} · receipt <span className="font-mono">{shortHash(receipt.receiptHash, 12, 6)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={download}>
              <Download className="h-4 w-4" /> Download JSON
            </button>
            <button className="btn-gradient" onClick={verify} disabled={verifying}>
              {verifying ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
              Verify
            </button>
          </div>
        </div>
      </div>

      {result && (
        <Card className={`overflow-hidden ${result.pass ? 'border-emerald-500/30' : 'border-rose-500/30'}`} role="status">
          <div className={`flex items-center gap-3 px-5 py-4 ${result.pass ? 'bg-emerald-500/[0.07]' : 'bg-rose-500/[0.07]'}`}>
            {result.pass ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <XCircle className="h-6 w-6 text-rose-400" />}
            <div>
              <p className="font-display text-lg font-bold text-white">{result.pass ? 'Verified' : 'Verification failed'}</p>
              <p className="text-xs text-slate-400">
                {result.checks.filter((c) => c.status === 'PASS').length} passed · {result.checks.filter((c) => c.status === 'FAIL').length} failed · {result.checks.filter((c) => c.status === 'SKIP').length} skipped
              </p>
            </div>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {result.checks.map((c) => {
              const meta = CHECK_ICON[c.status];
              const Icon = meta.icon;
              return (
                <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.cls}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-200">{c.title}</p>
                    <p className="mt-0.5 break-words text-xs text-slate-500">{c.message}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <SectionLabel>Payment</SectionLabel>
          <p className="font-display text-3xl font-bold text-white">
            {formatToken(receipt.offer.amount)}
            <span className="ml-1.5 text-sm font-medium text-slate-500">USDC</span>
          </p>
          <dl className="space-y-3">
            <KeyValue label="Recipient">
              <MonoAddress value={receipt.offer.payTo} lead={8} trail={8} />
            </KeyValue>
            <KeyValue label="Settlement transaction">
              <span className="inline-flex items-center gap-2">
                <MonoAddress value={receipt.settlement.txSignature} lead={8} trail={8} />
                <a href={explorerTxUrl(receipt.settlement.txSignature)} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-solana-green" aria-label="View on Solana Explorer">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </span>
            </KeyValue>
            <KeyValue label="Seller response">
              HTTP {receipt.response.status} · body sha256 <span className="font-mono text-xs">{shortHash(receipt.response.bodySha256, 8, 6)}</span>
            </KeyValue>
          </dl>
        </Card>

        <Card className="space-y-4 p-5">
          <SectionLabel>Anchor</SectionLabel>
          {receipt.anchor ? (
            <dl className="space-y-3">
              <KeyValue label="Merkle root">
                <MonoAddress value={receipt.anchor.merkleRoot} lead={10} trail={8} />
              </KeyValue>
              <KeyValue label="Position">
                Leaf {receipt.anchor.leafIndex + 1} of {receipt.anchor.leafCount} · proof of {receipt.anchor.proof.length} hash{receipt.anchor.proof.length === 1 ? '' : 'es'}
              </KeyValue>
              <KeyValue label="Anchor transaction (Memo)">
                <span className="inline-flex items-center gap-2">
                  <MonoAddress value={receipt.anchor.txSignature} lead={8} trail={8} />
                  <a href={explorerTxUrl(receipt.anchor.txSignature)} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-solana-green" aria-label="View anchor on Solana Explorer">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </span>
              </KeyValue>
              <KeyValue label="Anchored">{formatUnix(receipt.anchor.anchoredAt)}</KeyValue>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              Not yet anchored. Receipts are batched into a Merkle tree and the root is written to Solana devnet; until then the receipt is still signed and verifiable, but not time-stamped on chain.
            </p>
          )}
        </Card>
      </div>

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>Gate decision</SectionLabel>
          <StatusBadge status={record.decision} />
          {record.kind === 'APPROVED' && <span className="text-xs text-slate-500">released after human approval</span>}
        </div>
        <RuleList rules={record.rulesEvaluated} />
      </Card>

      <Card className="p-5">
        <SectionLabel>Signing keys</SectionLabel>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <KeyValue label="Atlas Rail instance">
            <MonoAddress value={receipt.instance.publicKey} lead={8} trail={8} />
          </KeyValue>
          <KeyValue label="Agent">
            <MonoAddress value={receipt.mandate.agent.publicKey} lead={8} trail={8} />
          </KeyValue>
        </dl>
        <p className="mt-4 text-xs text-slate-600">
          Verify this file without trusting this console: <span className="font-mono text-slate-400">atlas verify receipt-{receipt.id}.json</span>
        </p>
      </Card>
    </div>
  );
}
