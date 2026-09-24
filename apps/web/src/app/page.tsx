'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Landmark,
  Clock,
  CheckCircle2,
  ShieldAlert,
  ArrowUpRight,
  Plus,
  Send,
  AlertOctagon,
} from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { useApi } from '../lib/hooks';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import {
  Card,
  PageHeader,
  StatCard,
  StatusBadge,
  EmptyState,
  SkeletonRows,
} from '../components/ui';
import { formatUsdcCompact, formatUsdc, timeAgo, truncateAddress } from '../lib/format';
import type { Payout, Treasury, TreasuryBalance, ReconciliationSummary } from '../lib/types';

const STATUS_ORDER: Payout['status'][] = [
  'PENDING_APPROVAL',
  'APPROVED',
  'QUEUED_FOR_EXECUTION',
  'SIMULATING',
  'SUBMITTED',
  'CONFIRMED',
  'BLOCKED',
  'FAILED',
  'REJECTED',
];

export default function DashboardPage() {
  const { user } = useAuth();
  const { data: treasuries, loading: treasuriesLoading } = useApi<Treasury[]>('/v1/treasuries');
  const { data: payouts, loading: payoutsLoading } = useApi<Payout[]>('/v1/payouts');
  const { data: summary } = useApi<ReconciliationSummary>('/v1/reconciliation/summary');

  const [balances, setBalances] = useState<Record<string, TreasuryBalance>>({});

  useEffect(() => {
    if (!treasuries) return;
    treasuries.forEach((t) => {
      api
        .get<TreasuryBalance>(`/v1/treasuries/${t.id}/balance`)
        .then((b) => setBalances((prev) => ({ ...prev, [t.id]: b })))
        .catch(() => {});
    });
  }, [treasuries]);

  const totalBalanceBaseUnits = useMemo(() => {
    return Object.values(balances).reduce((sum, b) => sum + BigInt(b.balanceBaseUnits || '0'), 0n);
  }, [balances]);

  const pendingApprovals = useMemo(
    () => (payouts || []).filter((p) => p.status === 'PENDING_APPROVAL').length,
    [payouts],
  );
  const blockedCount = useMemo(
    () => (payouts || []).filter((p) => p.status === 'BLOCKED').length,
    [payouts],
  );
  const activeTreasuries = (treasuries || []).filter((t) => t.status === 'ACTIVE').length;

  const statusChartData = useMemo(() => {
    if (!payouts) return [];
    const counts = new Map<string, number>();
    for (const p of payouts) counts.set(p.status, (counts.get(p.status) || 0) + 1);
    return STATUS_ORDER.filter((s) => counts.has(s)).map((s) => ({
      status: s.replace(/_/g, ' '),
      count: counts.get(s),
    }));
  }, [payouts]);

  const recentPayouts = (payouts || []).slice(0, 6);

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome back${user ? `, ${user.displayName.split(' ')[0]}` : ''}`}
        description="Overview of devnet treasury balances, spend governance, and approval queues."
        actions={
          <Link href="/payouts/new" className="btn-gradient">
            <Plus className="h-4 w-4" />
            Draft Payout
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          icon={Landmark}
          label="Treasury Balance"
          value={`${formatUsdcCompact(totalBalanceBaseUnits.toString())} USDC`}
          sub={`${activeTreasuries} active treasur${activeTreasuries === 1 ? 'y' : 'ies'}`}
          accent="green"
          loading={treasuriesLoading}
        />
        <StatCard
          icon={Clock}
          label="Pending Approvals"
          value={pendingApprovals}
          sub={pendingApprovals > 0 ? 'Awaiting independent sign-off' : 'Queue is clear'}
          accent="amber"
          loading={payoutsLoading}
        />
        <StatCard
          icon={CheckCircle2}
          label="Confirmed Volume"
          value={`${summary ? formatUsdcCompact(summary.totalVolumeBaseUnits) : '0.00'} USDC`}
          sub={
            summary
              ? `${summary.confirmedPayoutsCount} settled payout${summary.confirmedPayoutsCount === 1 ? '' : 's'}`
              : 'Loading…'
          }
          accent="purple"
        />
        <StatCard
          icon={ShieldAlert}
          label="Policy Blocks"
          value={blockedCount}
          sub={blockedCount > 0 ? 'Blocked before signing' : 'Nothing blocked'}
          accent={blockedCount > 0 ? 'rose' : 'slate'}
          loading={payoutsLoading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="p-6 lg:col-span-2">
          <h2 className="font-display text-sm font-semibold text-slate-200">Payout Pipeline</h2>
          <p className="mt-0.5 text-xs text-mutedText">
            Live count of every payout by lifecycle state.
          </p>
          <div className="mt-4 h-64">
            {payoutsLoading ? (
              <div className="skeleton h-full w-full" />
            ) : statusChartData.length === 0 ? (
              <EmptyState
                icon={Send}
                title="No payouts yet"
                description="Draft your first payout to see it here."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusChartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: '#8b90ab', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="status"
                    width={120}
                    tick={{ fill: '#c4c8dd', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                    contentStyle={{
                      background: '#0b0d1c',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#f1f2f9',
                    }}
                  />
                  <Bar dataKey="count" fill="#9945FF" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card className="p-6 lg:col-span-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-200">Recent Payouts</h2>
              <p className="mt-0.5 text-xs text-mutedText">
                Most recently drafted USDC payout requests.
              </p>
            </div>
            <Link
              href="/payouts"
              className="flex items-center gap-1 text-xs font-medium text-solana-green hover:underline"
            >
              View all <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="mt-4 -mx-2">
            {payoutsLoading ? (
              <SkeletonRows rows={5} cols={4} />
            ) : recentPayouts.length === 0 ? (
              <EmptyState
                icon={AlertOctagon}
                title="No payouts drafted yet"
                description="Once payouts are created they'll show up here with live status."
              />
            ) : (
              <div className="divide-y divide-white/5">
                {recentPayouts.map((p) => (
                  <Link
                    key={p.id}
                    href={`/payouts/${p.id}`}
                    className="flex items-center justify-between gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {p.recipient?.displayName || truncateAddress(p.recipientId)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">{timeAgo(p.createdAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-slate-100">
                        {formatUsdc(p.amountBaseUnits, p.decimals)} {p.assetSymbol}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
