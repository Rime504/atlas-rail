'use client';

import React from 'react';
import { Landmark, ShieldCheck, Lock } from 'lucide-react';

export default function TreasuriesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Organization Treasuries</h1>
          <p className="text-sm text-slate-400">Registered devnet USDC treasuries and settlement wallet configurations.</p>
        </div>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded bg-blue-600/20 text-blue-400">
              <Landmark className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-bold text-lg">Atlas Main USDC Treasury</h2>
              <span className="text-xs text-slate-400 font-mono">slug: usdc-devnet-treasury</span>
            </div>
          </div>
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>ACTIVE</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-sm">
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Settlement Wallet Address</div>
            <div className="font-mono text-xs text-slate-200 mt-1 break-all bg-slate-900 p-2 rounded">
              7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">USDC Token Mint</div>
            <div className="font-mono text-xs text-slate-200 mt-1 break-all bg-slate-900 p-2 rounded">
              4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase font-semibold">Network Cluster</div>
            <div className="font-mono text-xs text-blue-400 mt-1 bg-slate-900 p-2 rounded">
              DEVNET ONLY
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end space-x-3">
          <button className="inline-flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors">
            <Lock className="w-3.5 h-3.5" />
            <span>Freeze Treasury</span>
          </button>
        </div>
      </div>
    </div>
  );
}
