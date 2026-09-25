'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Anchor, ChevronRight, ReceiptText } from 'lucide-react';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth-context';
import { api, ApiError } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { Card, EmptyState, MonoAddress, PageHeader, SkeletonRows, Spinner, StatusBadge } from '../../components/ui';
import { explorerTxUrl } from '../../lib/format';
import { formatToken, hostOf, shortHash, timeAgoUnix } from '../../lib/agent-format';
import type { AnchorRunResult, ReceiptListItem } from '../../lib/agent-types';

export default function ReceiptsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch } = useApi<ReceiptListItem[]>('/v1/agent/receipts?limit=100');
  const [anchoring, setAnchoring] = useState(false);
  const canAnchor = Boolean(user && hasPermission(user.role, 'receipt:anchor'));
  const unanchored = (data ?? []).filter((r) => !r.anchored).length;

  const anchorNow = async () => {
    setAnchoring(true);
    try {
      const res = await api.post<AnchorRunResult>('/v1/agent/anchor');
      if (res.batch) toast.success(`Anchored ${res.anchored} receipt${res.anchored === 1 ? '' : 's'}`, `Merkle root ${shortHash(res.batch.merkleRoot)} written to Solana devnet.`);
      else toast.info('Nothing to anchor', 'Every receipt is already anchored.');
      refetch();
    } catch (err) {
      toast.error('Anchoring failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setAnchoring(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bound Receipts"
        description="Each paid request leaves a receipt that binds the mandate, the policy gate’s decision, the on-chain settlement and the response. Anyone can verify one offline."
        actions={
          canAnchor && (
            <button className="btn-ghost" onClick={anchorNow} disabled={anchoring || unanchored === 0}>
              {anchoring ? <Spinner /> : <Anchor className="h-4 w-4" />}
              Anchor {unanchored > 0 ? `${unanchored} pending` : 'now'}
            </button>
          )
        }
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300" role="alert">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <SkeletonRows rows={5} cols={5} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No receipts yet"
            description="Receipts are issued when an agent’s payment settles and the seller responds. They will appear here, then get anchored on Solana."
          />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {data.map((r) => (
              <li key={r.id}>
                <Link href={`/receipts/${r.id}`} className="group flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:gap-5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-100">{hostOf(r.resourceUrl)}</p>
                      <StatusBadge status={r.anchored ? 'ANCHORED' : 'UNANCHORED'} />
                      {r.decisionKind === 'APPROVED' && <StatusBadge status="APPROVED" />}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{r.agentLabel}</span>
                      <span>{timeAgoUnix(r.issuedAt)}</span>
                      <span className="font-mono">receipt {shortHash(r.receiptHash, 8, 4)}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4 sm:justify-end">
                    <span className="font-mono text-base font-bold text-slate-100">{formatToken(r.amount)}</span>
                    <span className="hidden sm:block">
                      <MonoAddress value={r.txSignature} lead={6} trail={4} />
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition-colors group-hover:text-solana-green" />
                  </div>
                </Link>
                {r.anchorTx && (
                  <div className="border-t border-white/[0.03] bg-black/10 px-4 py-2 text-[11px] text-slate-600 sm:px-5">
                    Anchored in{' '}
                    <a href={explorerTxUrl(r.anchorTx)} target="_blank" rel="noreferrer" className="font-mono text-solana-green hover:underline">
                      {shortHash(r.anchorTx, 8, 6)}
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
