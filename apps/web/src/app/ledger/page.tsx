'use client';

import React, { useState } from 'react';
import { Download, BookOpen, Loader2, TrendingUp, Hash } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { downloadAuthenticated, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Card, PageHeader, EmptyState, SkeletonRows, StatCard } from '../../components/ui';
import { formatUsdc, formatDate } from '../../lib/format';
import type { LedgerEntry, ReconciliationSummary } from '../../lib/types';
import { hasPermission } from '@atlas-rail/domain';

export default function LedgerPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: entries, loading } = useApi<LedgerEntry[]>('/v1/ledger');
  const { data: summary } = useApi<ReconciliationSummary>('/v1/reconciliation/summary');
  const [exporting, setExporting] = useState(false);

  const canExport = user && hasPermission(user.role, 'reconciliation:export');

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAuthenticated(
        '/v1/reconciliation/export.csv',
        `atlas_rail_reconciliation_${Date.now()}.csv`,
      );
      toast.success('Export ready', 'Reconciliation CSV downloaded and logged to the audit trail.');
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reconciliation Ledger & Accounting"
        description="Append-only audit ledger matching on-chain settlement to internal invoice references."
        actions={
          canExport && (
            <button onClick={handleExport} disabled={exporting} className="btn-gradient">
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export Reconciliation CSV
            </button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          icon={TrendingUp}
          label="Confirmed Volume"
          value={
            summary ? `${formatUsdc(summary.totalVolumeBaseUnits)} ${summary.assetSymbol}` : '—'
          }
          accent="green"
        />
        <StatCard
          icon={Hash}
          label="Settled Payouts"
          value={summary?.confirmedPayoutsCount ?? '—'}
          accent="purple"
        />
        <StatCard
          icon={BookOpen}
          label="Ledger Entries"
          value={entries?.length ?? '—'}
          accent="slate"
        />
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <SkeletonRows rows={6} cols={5} />
        ) : !entries || entries.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No ledger activity yet"
            description="Confirmed payouts and policy/treasury events post here as immutable entries."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/[0.06] text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="p-4">Entry</th>
                  <th className="p-4">Timestamp</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Direction</th>
                  <th className="p-4">Amount</th>
                  <th className="p-4">Recipient</th>
                  <th className="p-4">Invoice Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-xs">
                {entries.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="p-4 text-slate-400">{e.id}</td>
                    <td className="p-4 text-slate-500">{formatDate(e.createdAt)}</td>
                    <td
                      className={`p-4 font-semibold ${
                        e.entryType.includes('CONFIRMED')
                          ? 'text-emerald-400'
                          : e.entryType.includes('BLOCKED') || e.entryType.includes('REJECTED')
                            ? 'text-rose-400'
                            : 'text-solana-purple'
                      }`}
                    >
                      {e.entryType}
                    </td>
                    <td
                      className={`p-4 font-semibold ${
                        e.direction === 'DEBIT'
                          ? 'text-rose-400'
                          : e.direction === 'CREDIT'
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                      }`}
                    >
                      {e.direction}
                    </td>
                    <td className="p-4 font-bold text-slate-100">
                      {e.amountBaseUnits ? formatUsdc(e.amountBaseUnits) : '—'}
                    </td>
                    <td className="p-4 text-slate-300">
                      {e.payout?.recipient?.displayName || '—'}
                    </td>
                    <td className="p-4 text-slate-500">{e.payout?.invoiceReference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
