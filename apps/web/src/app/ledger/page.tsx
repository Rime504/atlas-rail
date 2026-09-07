'use client';

import React from 'react';
import { Download } from 'lucide-react';

export default function LedgerPage() {
  const handleExportCsv = () => {
    window.open('http://localhost:3001/v1/reconciliation/export.csv', '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reconciliation Ledger & Accounting</h1>
          <p className="text-sm text-slate-400">Append-only audit ledger matching on-chain transactions to internal invoice references.</p>
        </div>
        <button
          onClick={handleExportCsv}
          className="inline-flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>Export Reconciliation CSV</span>
        </button>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 uppercase text-[11px] font-semibold tracking-wider">
            <tr>
              <th className="p-4">Entry ID</th>
              <th className="p-4">Timestamp</th>
              <th className="p-4">Entry Type</th>
              <th className="p-4">Direction</th>
              <th className="p-4">Amount (USDC)</th>
              <th className="p-4">Recipient</th>
              <th className="p-4">Invoice Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
            <tr className="hover:bg-slate-800/40">
              <td className="p-4 text-slate-300">ldg_01J88A9</td>
              <td className="p-4 text-slate-400">2026-09-01 10:15:00 UTC</td>
              <td className="p-4 text-emerald-400 font-semibold">PAYOUT_CONFIRMED</td>
              <td className="p-4 text-rose-400 font-semibold">DEBIT</td>
              <td className="p-4 text-slate-100 font-bold">1,500.000000</td>
              <td className="p-4 text-slate-300">Acme Logistics Inc</td>
              <td className="p-4 text-slate-400">PO-99120</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
