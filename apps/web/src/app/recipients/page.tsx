'use client';

import React from 'react';
import { CheckCircle2, Clock, Ban, Plus } from 'lucide-react';

export default function RecipientsPage() {
  const recipients = [
    {
      id: 'rec_01',
      displayName: 'Acme Logistics Inc',
      type: 'BUSINESS',
      status: 'VERIFIED',
      address: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
      code: 'VEN-8821',
      risk: 'LOW',
    },
    {
      id: 'rec_02',
      displayName: 'Global Tech Contractors Ltd',
      type: 'BUSINESS',
      status: 'PENDING',
      address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q544fKrF',
      code: 'VEN-9012',
      risk: 'MEDIUM',
    },
    {
      id: 'rec_03',
      displayName: 'Suspicious Entity Entity',
      type: 'INDIVIDUAL',
      status: 'BLOCKED',
      address: '11111111111111111111111111111111',
      code: 'BLK-001',
      risk: 'CRITICAL',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Registered Recipients</h1>
          <p className="text-sm text-slate-400">Allowlist of verified vendor wallets and recipient governance controls.</p>
        </div>
        <button className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors">
          <Plus className="w-4 h-4" />
          <span>Add Recipient</span>
        </button>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400 border-b border-slate-800 uppercase text-[11px] font-semibold tracking-wider">
            <tr>
              <th className="p-4">Recipient Name</th>
              <th className="p-4">Status</th>
              <th className="p-4">Solana Wallet Address</th>
              <th className="p-4">Vendor Code</th>
              <th className="p-4">Risk Level</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {recipients.map((r) => (
              <tr key={r.id} className="hover:bg-slate-800/40">
                <td className="p-4 font-semibold text-slate-200">{r.displayName}</td>
                <td className="p-4">
                  {r.status === 'VERIFIED' && (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>VERIFIED</span>
                    </span>
                  )}
                  {r.status === 'PENDING' && (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                      <Clock className="w-3 h-3" />
                      <span>PENDING</span>
                    </span>
                  )}
                  {r.status === 'BLOCKED' && (
                    <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                      <Ban className="w-3 h-3" />
                      <span>BLOCKED</span>
                    </span>
                  )}
                </td>
                <td className="p-4 font-mono text-xs text-slate-400">{r.address}</td>
                <td className="p-4 text-slate-300 font-mono text-xs">{r.code}</td>
                <td className="p-4 font-semibold text-xs text-slate-300">{r.risk}</td>
                <td className="p-4 text-right">
                  {r.status === 'PENDING' && (
                    <button className="text-xs text-blue-400 hover:underline">Verify</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
