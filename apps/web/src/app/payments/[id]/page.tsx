'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, ReceiptText } from 'lucide-react';
import { useApi } from '../../../lib/hooks';
import { Card, EmptyState, MonoAddress, SectionLabel, SkeletonRows, StatusBadge } from '../../../components/ui';
import { KeyValue } from '../../../components/agent/Bits';
import { explorerTxUrl } from '../../../lib/format';
import { formatToken, formatUnix } from '../../../lib/agent-format';
import type { PaymentRowView, PaymentStatusView, PaymentTokenView } from '../../../lib/agent-types';

const BADGE: Record<PaymentStatusView, string> = {
  settled: 'SETTLED',
  authorized: 'AUTHORIZED',
  pending: 'PENDING',
  blocked: 'POLICY_BLOCKED',
  failed: 'FAILED',
  verification_unavailable: 'VERIFICATION_UNAVAILABLE',
};

function showAmount(amount: string | null, token: PaymentTokenView): string {
  if (!amount) return '—';
  if (token.decimals === null) return `${amount} base units of ${token.mint}`;
  return `${formatToken(amount, token.decimals)} ${token.label}`;
}

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { data, loading, error } = useApi<PaymentRowView>(id ? `/v1/agent/payments/${id}` : null);

  if (loading && !data) {
    return <Card><SkeletonRows rows={6} cols={2} /></Card>;
  }
  if (error || !data) {
    return (
      <Card>
        <EmptyState
          icon={ReceiptText}
          title="Payment not available"
          description={error ?? 'It may belong to another organisation, or it is outside the latest 200 records.'}
          action={<Link href="/payments" className="btn-ghost mt-2"><ArrowLeft className="h-4 w-4" /> Back to payments</Link>}
        />
      </Card>
    );
  }

  const devnet = data.namespace === 'devnet';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/payments" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> All payments
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-white">{data.purpose}</h1>
          <StatusBadge status={BADGE[data.status]} />
        </div>
        <p className="mt-1 text-xs text-slate-500">{formatUnix(data.at)} · {data.namespace}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="space-y-4 p-5">
          <SectionLabel>Amounts</SectionLabel>
          <dl className="space-y-3 text-sm">
            <KeyValue label="Requested">{showAmount(data.requestedAmount, data.token)}</KeyValue>
            <KeyValue label="Authorized">{showAmount(data.authorizedAmount, data.token)}</KeyValue>
            <KeyValue label="Settled">{showAmount(data.settledAmount, data.token)}</KeyValue>
            <KeyValue label="Recipient"><MonoAddress value={data.recipient} lead={8} trail={8} /></KeyValue>
            <KeyValue label="Mandate"><MonoAddress value={data.mandateId} lead={8} trail={8} /></KeyValue>
            <KeyValue label="Network fee">{data.fees.detail}</KeyValue>
          </dl>
        </Card>

        <Card className="space-y-4 p-5">
          <SectionLabel>Three separate checks</SectionLabel>
          <dl className="space-y-3 text-sm text-slate-300">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Root anchored</p>
              <p className="mt-1">{data.claims.rootDetail}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Included in the stored tree</p>
              <p className="mt-1">{data.claims.inclusionDetail}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Settlement</p>
              <p className="mt-1">{data.claims.settlementDetail}</p>
            </div>
          </dl>
          {data.settlementSignature && devnet && (
            <a className="inline-flex items-center gap-1 text-sm text-solana-green hover:underline" href={explorerTxUrl(data.settlementSignature)} target="_blank" rel="noreferrer">
              Settlement transaction <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {data.anchor && devnet && (
            <a className="ml-4 inline-flex items-center gap-1 text-sm text-solana-green hover:underline" href={explorerTxUrl(data.anchor.txSignature)} target="_blank" rel="noreferrer">
              Anchor transaction <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {!devnet && (data.settlementSignature || data.anchor) && (
            <p className="text-xs text-slate-500">Explorer links are shown for devnet. This row is on {data.network}.</p>
          )}
          {data.receiptId && (
            <p className="text-xs text-slate-500">
              Receipt <Link className="text-solana-green hover:underline" href={`/receipts/${data.receiptId}`}>{data.receiptId}</Link>
              {' '}can be verified on chain from that page.
            </p>
          )}
        </Card>
      </div>

      <Card className="space-y-3 p-5">
        <SectionLabel>Policy</SectionLabel>
        <p className="text-sm text-slate-300">{data.policy ?? 'No policy reason is stored for this row.'}</p>
      </Card>

      <Card className="p-5">
        <SectionLabel>Timeline</SectionLabel>
        <ol className="mt-4 space-y-4">
          {data.timeline.map((stage) => (
            <li key={stage.id} className="border-l border-white/10 pl-4">
              <p className="text-sm font-semibold text-slate-100">{stage.label}</p>
              <p className="text-xs uppercase tracking-wide text-slate-500">{stage.state}</p>
              <p className="mt-1 text-sm text-slate-400">{stage.detail}</p>
            </li>
          ))}
        </ol>
      </Card>

      {data.anchor && (
        <Card className="space-y-3 p-5">
          <SectionLabel>Merkle batch</SectionLabel>
          <dl className="space-y-3 text-sm">
            <KeyValue label="Root"><MonoAddress value={data.anchor.merkleRoot} lead={10} trail={8} /></KeyValue>
            <KeyValue label="Leaf"> {data.anchor.leafIndex + 1} of {data.anchor.leafCount}</KeyValue>
            <KeyValue label="Anchored">{formatUnix(data.anchor.anchoredAt)}</KeyValue>
          </dl>
        </Card>
      )}
    </div>
  );
}
