'use client';

import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Access Keys</h1>
          <p className="text-sm text-slate-400">Scoped organization developer keys for programmatic payout creation and polling.</p>
        </div>
        <button className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors">
          <Plus className="w-4 h-4" />
          <span>Generate API Key</span>
        </button>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <div className="font-bold text-slate-200">Dev Integration Master Key</div>
            <div className="text-xs text-slate-400 font-mono">Prefix: atk_88fa... • Scopes: [*]</div>
          </div>
          <button className="p-2 text-rose-400 hover:bg-rose-500/10 rounded transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
