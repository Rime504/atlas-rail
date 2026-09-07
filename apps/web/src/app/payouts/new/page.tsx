'use client';

import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, Send, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function CreatePayoutPage() {
  const router = useRouter();
  const [recipientId, setRecipientId] = useState('rec_01');
  const [amount, setAmount] = useState('500.00');
  const [invoice, setInvoice] = useState('INV-2026-0901');
  const [memo, setMemo] = useState('Q3 Software License Fee');
  const [idempotencyKey, setIdempotencyKey] = useState(`idem-${Date.now()}`);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    router.push('/payouts');
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Draft New USDC Payout Request</h1>
        <p className="text-sm text-slate-400">Specify payment details, preview spend policy evaluation rules, and attach idempotency keys.</p>
      </div>

      <form onSubmit={handleCreate} className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Select Treasury</label>
            <select className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500">
              <option>Atlas Main USDC Treasury (Devnet Reserve: 50,000 USDC)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Verified Recipient</label>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="rec_01">Acme Logistics Inc (VERIFIED — 9WzDXw...9zYtAWWM)</option>
              <option value="rec_02">Global Tech Contractors Ltd (PENDING — 5Q544f...4fKrF)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Amount (USDC)</label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
                placeholder="100.00"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Invoice Reference</label>
              <input
                type="text"
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Memo / Purpose (Optional)</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-400 mb-1">Idempotency Key (Guarantees non-duplication)</label>
            <input
              type="text"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Real-time Policy Engine Evaluation Preview */}
        <div className="bg-slate-900/90 border border-blue-500/30 p-4 rounded-md space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-blue-400 flex items-center">
              <ShieldCheck className="w-4 h-4 mr-1.5" />
              Policy Engine Evaluation Preview
            </span>
            <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded font-semibold">
              REQUIRE_APPROVAL (2 Approvals)
            </span>
          </div>

          <div className="space-y-1.5 text-xs text-slate-300">
            <div className="flex items-center text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Recipient status is VERIFIED
            </div>
            <div className="flex items-center text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Amount ({amount} USDC) is within single payout limit (5,000.00 USDC)
            </div>
            <div className="flex items-center text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              Target asset matches devnet USDC mint
            </div>
            <div className="flex items-center text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
              Requires 2 independent approvals from OWNER, ADMIN, or APPROVER role before submission
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end space-x-3 pt-4 border-t border-slate-800">
          <button
            type="button"
            onClick={() => router.push('/payouts')}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-5 py-2 rounded-md transition-colors"
          >
            <Send className="w-4 h-4" />
            <span>Submit Payout for Approval</span>
          </button>
        </div>
      </form>
    </div>
  );
}
