'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Ban, CheckCircle2, Clock, ExternalLink, ReceiptText, ShieldAlert } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { Card, EmptyState, PageHeader, SkeletonRows, StatCard, StatusBadge } from '../../components/ui';
import { explorerTxUrl } from '../../lib/format';
import { formatToken, formatUnix, shortHash } from '../../lib/agent-format';
import type { PaymentHistoryView, PaymentRowView, PaymentStatusView, PaymentTokenView } from '../../lib/agent-types';

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
  if (token.decimals === null) return `${amount} base units`;
  return `${formatToken(amount, token.decimals)} ${token.label}`;
}

function dayStart(value: string): number | null {
  if (!value) return null;
  const time = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
}

function dayEnd(value: string): number | null {
  if (!value) return null;
  const time = new Date(`${value}T23:59:59`).getTime();
  return Number.isNaN(time) ? null : Math.floor(time / 1000);
}

export default function PaymentsPage() {
  const { data, loading, error } = useApi<PaymentHistoryView>('/v1/agent/payments');
  const [status, setStatus] = useState<PaymentStatusView | 'all'>('all');
  const [namespace, setNamespace] = useState<'all' | 'devnet' | 'other'>('all');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const rows = useMemo(() => {
    const start = dayStart(from);
    const end = dayEnd(to);
    const needle = query.trim().toLowerCase();
    return (data?.payments ?? []).filter((row) => {
      if (status !== 'all' && row.status !== status) return false;
      if (namespace !== 'all' && row.namespace !== namespace) return false;
      if (start !== null && row.at < start) return false;
      if (end !== null && row.at > end) return false;
      if (!needle) return true;
      return [row.purpose, row.recipient, row.settlementSignature, row.mandateId, row.statusLabel].join(' ').toLowerCase().includes(needle);
    });
  }, [data, status, namespace, query, from, to]);

  const totals = useMemo(() => {
    const grouped = new Map<string, { label: string; decimals: number | null; amount: bigint; count: number; namespace: string }>();
    for (const row of rows) {
      if (row.status !== 'settled' || !row.settledAmount) continue;
      const key = `${row.namespace}:${row.token.mint}`;
      const current = grouped.get(key);
      const amount = BigInt(row.settledAmount);
      if (current) {
        current.amount += amount;
        current.count += 1;
      } else {
        grouped.set(key, { label: row.token.label, decimals: row.token.decimals, amount, count: 1, namespace: row.namespace });
      }
    }
    return [...grouped.values()];
  }, [rows]);

  const count = (kind: PaymentStatusView) => rows.filter((row) => row.status === kind).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Settled spend is counted only when a receipt stores a settlement signature. A blocked request, an approval, and a Merkle root are separate facts."
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading && !data ? (
          <Card className="p-5 sm:col-span-2 xl:col-span-4"><SkeletonRows rows={1} cols={3} /></Card>
        ) : totals.length === 0 ? (
          <StatCard icon={CheckCircle2} label="Settled spend" value="—" sub="No settled payments in this view" accent="green" />
        ) : (
          totals.map((total) => (
            <StatCard
              key={`${total.namespace}:${total.label}:${total.amount}`}
              icon={CheckCircle2}
              label={`Settled · ${total.namespace}`}
              value={total.decimals === null ? `${total.amount.toString()} base units` : `${formatToken(total.amount.toString(), total.decimals)} ${total.label}`}
              sub={`${total.count} payment${total.count === 1 ? '' : 's'}`}
              accent="green"
            />
          ))
        )}
        <StatCard icon={Clock} label="Not settled yet" value={data ? count('authorized') + count('pending') : '—'} sub={data ? `${count('authorized')} authorized · ${count('pending')} pending` : undefined} accent="purple" />
        <StatCard icon={Ban} label="Blocked" value={data ? count('blocked') : '—'} accent="rose" />
        <StatCard icon={ShieldAlert} label="Verification unavailable" value={data ? count('verification_unavailable') + count('failed') : '—'} accent="slate" />
      </div>

      <p className="text-xs text-slate-500">{data?.fees.detail} {data?.limitNote}</p>

      <Card className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-xs text-slate-500">
          Search
          <input className="input-field mt-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Recipient, purpose, signature" />
        </label>
        <label className="block text-xs text-slate-500">
          Status
          <select className="input-field mt-1" value={status} onChange={(event) => setStatus(event.target.value as PaymentStatusView | 'all')}>
            <option value="all">All</option>
            <option value="settled">Settled</option>
            <option value="authorized">Authorized — awaiting settlement</option>
            <option value="pending">Pending</option>
            <option value="blocked">Blocked by policy</option>
            <option value="failed">Failed</option>
            <option value="verification_unavailable">Verification unavailable</option>
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          Network
          <select className="input-field mt-1" value={namespace} onChange={(event) => setNamespace(event.target.value as 'all' | 'devnet' | 'other')}>
            <option value="all">All networks</option>
            <option value="devnet">Devnet</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block text-xs text-slate-500">
          From
          <input className="input-field mt-1" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="block text-xs text-slate-500">
          To
          <input className="input-field mt-1" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
      </Card>

      <Card className="overflow-hidden">
        {loading && !data ? (
          <SkeletonRows rows={5} cols={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No payments in this view" description="Settled, pending, and blocked attempts for this organisation show up here. Nothing is invented when the list is empty." />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {rows.map((row) => (
              <PaymentLine key={row.id} row={row} />
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-display text-sm font-semibold text-slate-200">Anchor batches</h2>
        {!data || data.batches.filter((batch) => rows.some((row) => row.anchor?.txSignature === batch.txSignature)).length === 0 ? (
          <p className="text-sm text-slate-500">No anchored batch is stored for these payments.</p>
        ) : (
          <ul className="space-y-4">
            {data.batches.filter((batch) => rows.some((row) => row.anchor?.txSignature === batch.txSignature)).map((batch) => (
              <li key={batch.txSignature} className="rounded-lg border border-white/[0.06] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-100">{batch.receiptCount} receipts in this batch</p>
                  {batch.namespace === 'devnet' ? (
                    <a className="inline-flex items-center gap-1 text-xs text-solana-green hover:underline" href={explorerTxUrl(batch.txSignature)} target="_blank" rel="noreferrer">
                      {shortHash(batch.txSignature, 8, 6)} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-slate-400">{shortHash(batch.txSignature, 8, 6)} · {batch.network}</span>
                  )}
                </div>
                <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
                  <div>Settlements recorded: {batch.settlementsRecorded}</div>
                  <div>Inclusion proofs matching the stored root: {batch.inclusionVerified}</div>
                  <div>Inclusion proofs that failed: {batch.inclusionFailed}</div>
                  <div>Leaf count stored with the root: {batch.leafCount}</div>
                  <div className="sm:col-span-2 font-mono">Root {shortHash(batch.merkleRoot, 12, 8)}</div>
                </dl>
                <p className="mt-3 text-xs text-slate-500">{batch.note} Chain confirmation: stored, not re-checked.</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PaymentLine({ row }: { row: PaymentRowView }) {
  const amount = row.status === 'settled' ? row.settledAmount : row.requestedAmount ?? row.authorizedAmount;
  return (
    <li>
      <Link href={`/payments/${row.id}`} className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-100">{row.purpose}</p>
            <StatusBadge status={BADGE[row.status]} />
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
            <span className="font-mono">{row.recipient.slice(0, 4)}…{row.recipient.slice(-4)}</span>
            <span>{formatUnix(row.at)}</span>
            {row.settlementSignature && <span className="font-mono">{shortHash(row.settlementSignature, 6, 4)}</span>}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="font-mono text-sm font-bold text-slate-100">{showAmount(amount, row.token)}</p>
          <p className="text-[11px] text-slate-500">{row.status === 'settled' ? 'Settled' : 'Requested'}</p>
        </div>
      </Link>
    </li>
  );
}
