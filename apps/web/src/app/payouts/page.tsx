'use client';

import React from 'react';
import Link from 'next/link';
import { Plus, CheckCircle2, Clock } from 'lucide-react';

export default function PayoutsPage() {
  const payouts = [
    {
      id: 'pay_01',
      recipient: 'Acme Logistics Inc',
      amount: '1,500.00 USDC',
      status: 'CONFIRMED',
      idempotency: 'idem-seed-001',
      invoice: 'PO-99120',
      sig: '5K7m1zX4vM9nL2kP8jQ3wE6rT1yU4iO9pS2aD5fG8hJ0kL3mN6bP9qR2sT5uV8wX',
    },
    {
      id: 'pay_02',
      recipient: 'Acme Logistics Inc',
      amount: '3,500.00 USDC',
      status: 'PENDING_APPROVAL',
      idempotency: 'idem-seed-002',
      invoice: 'PO-99185',
      sig: null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">USDC Payout Requests</h1>
          <p className="text-sm text-slate-400">Track payout status, collected approvals, simulations, and devnet confirmation signatures.</p>
        </div>
        <Link
          href="/payouts/new"
          className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Payout Request</span>
        </Link>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 uppercase text-[11px] font-semibold tracking-wider">
            <tr>
              <th className="p-4">Payout ID</th>
              <th className="p-4">Recipient</th>
              <th className="p-4">Amount</th>
              <th className="p-4">Status</th>
              <th className="p-4">Invoice Reference</th>
              <th className="p-4">Signature / Key</th>
              <th className="p-4 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {payouts.map((p) => (
              <tr key={p.id} className="hover:bg-slate-800/40">
                <td className="p-4 font-mono text-xs text-slate-300 font-semibold">{p.id}</td>
                <td className="p-4 font-medium text-slate-200">{p.recipient}</td>
                <td className="p-4 font-bold text-slate-100">{p.amount}</td>
                <td className="p-4">
                  {p.status === 'CONFIRMED' && (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>CONFIRMED</span>
                    </span>
                  )}
                  {p.status === 'PENDING_APPROVAL' && (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <Clock className="w-3 h-3" />
                      <span>PENDING (1/2)</span>
                    </span>
                  )}
                </td>
                <td className="p-4 font-mono text-xs text-slate-400">{p.invoice}</td>
                <td className="p-4 font-mono text-xs text-slate-400 truncate max-w-[200px]">
                  {p.sig ? p.sig : p.idempotency}
                </td>
                <td className="p-4 text-right">
                  <Link href={`/payouts/${p.id}`} className="text-xs text-blue-400 hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
