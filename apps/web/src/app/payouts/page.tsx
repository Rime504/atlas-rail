'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, Send } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth-context';
import {
  Card,
  PageHeader,
  StatusBadge,
  EmptyState,
  SkeletonRows,
  MonoAddress,
} from '../../components/ui';
import { formatUsdc, timeAgo, truncateAddress } from '../../lib/format';
import type { Payout } from '../../lib/types';
import { hasPermission } from '@atlas-rail/domain';

export default function PayoutsPage() {
  const { user } = useAuth();
  const { data: payouts, loading } = useApi<Payout[]>('/v1/payouts');
  const canCreate = user && hasPermission(user.role, 'payout:create');

  return (
    <div className="space-y-6">
      <PageHeader
        title="USDC Payout Requests"
        description="Track policy evaluation, collected approvals, simulation results, and devnet confirmation signatures."
        actions={
          canCreate && (
            <Link href="/payouts/new" className="btn-gradient">
              <Plus className="h-4 w-4" />
              New Payout Request
            </Link>
          )
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} cols={5} />
        ) : !payouts || payouts.length === 0 ? (
          <EmptyState
            icon={Send}
            title="No payouts yet"
            description="Payout requests you draft will appear here with live approval and simulation status."
            action={
              canCreate && (
                <Link href="/payouts/new" className="btn-gradient mt-2">
                  <Plus className="h-4 w-4" />
                  Draft your first payout
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-4">Payout</th>
                  <th className="p-4">Recipient</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Approvals</th>
                  <th className="p-4">Signature</th>
                  <th className="p-4">Created</th>
                  <th className="p-4 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {payouts.map((p) => {
                  const required = p.policyEvaluation?.requiredApprovals ?? 0;
                  const collected =
                    p.approvals?.filter((a) => a.decision === 'APPROVED').length ?? 0;
                  return (
                    <tr key={p.id} className="transition-colors hover:bg-white/[0.02]">
                      <td className="p-4 font-mono text-xs font-semibold text-slate-300">{p.id}</td>
                      <td className="p-4 font-medium text-slate-200">
                        {p.recipient?.displayName || truncateAddress(p.recipientId)}
                      </td>
                      <td className="p-4 font-mono font-bold text-slate-100">
                        {formatUsdc(p.amountBaseUnits, p.decimals)} {p.assetSymbol}
                      </td>
                      <td className="p-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="p-4 text-xs text-slate-400">
                        {required > 0 ? `${collected}/${required}` : '—'}
                      </td>
                      <td className="p-4">
                        {p.transactionSignature ? (
                          <MonoAddress value={p.transactionSignature} />
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                      <td className="p-4 text-xs text-slate-500">{timeAgo(p.createdAt)}</td>
                      <td className="p-4 text-right">
                        <Link
                          href={`/payouts/${p.id}`}
                          className="text-xs font-semibold text-solana-green hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
