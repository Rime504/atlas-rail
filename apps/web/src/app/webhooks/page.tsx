'use client';

import React from 'react';
import { Plus, Send } from 'lucide-react';

export default function WebhooksPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Signed Webhooks</h1>
          <p className="text-sm text-slate-400">HMAC-SHA256 signed event notifications for ERP and backend system integrations.</p>
        </div>
        <button className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors">
          <Plus className="w-4 h-4" />
          <span>Add Webhook Endpoint</span>
        </button>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="font-bold text-lg text-slate-200">https://example-erp.local/webhooks/atlas</div>
            <div className="text-xs text-slate-400 font-mono">id: wh_seed_001 • events: payout.created, payout.confirmed, payout.failed</div>
          </div>
          <button className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-blue-600/20 text-blue-400 border border-blue-500/30 hover:bg-blue-600/30 transition-colors">
            <Send className="w-3.5 h-3.5" />
            <span>Send Test Delivery</span>
          </button>
        </div>

        <div className="text-xs space-y-1">
          <div className="text-slate-400">Signature Format Header:</div>
          <div className="bg-slate-950 p-3 rounded font-mono text-emerald-400 border border-slate-800">
            Atlas-Signature: t=1788265000,v1=5d41402abc4b2a76b9719d911017c592
          </div>
        </div>
      </div>
    </div>
  );
}
