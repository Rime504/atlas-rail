'use client';

import React from 'react';
import { Landmark, ShieldAlert, CheckCircle2, Clock, Activity, ArrowUpRight, Plus } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Treasury Dashboard</h1>
          <p className="text-sm text-slate-400">Overview of active devnet USDC balances, spend governance, and approval queues.</p>
        </div>
        <Link
          href="/payouts/new"
          className="inline-flex items-center space-x-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-md transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>Draft Payout</span>
        </Link>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-[#0f172a] border border-slate-800 p-5 rounded-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Treasury Balance</span>
            <Landmark className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold">50,000.00 USDC</div>
          <span className="text-xs text-emerald-400 flex items-center mt-1">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Devnet Reserve Active
          </span>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 p-5 rounded-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Pending Approvals</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold">1 Payout</div>
          <span className="text-xs text-amber-400 mt-1 block">Awaiting 2nd Approval</span>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 p-5 rounded-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Confirmed (30d)</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold">1,500.00 USDC</div>
          <span className="text-xs text-slate-400 mt-1 block">1 transaction settled</span>
        </div>

        <div className="bg-[#0f172a] border border-slate-800 p-5 rounded-lg">
          <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Policy Enforcements</span>
            <ShieldAlert className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold">Policy v1</div>
          <span className="text-xs text-slate-400 mt-1 block">2 Approvals Required</span>
        </div>
      </div>

      {/* Main Grid: Activity Timeline & Quick Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Recent Activity */}
        <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <h2 className="text-lg font-semibold flex items-center space-x-2">
              <Activity className="w-5 h-5 text-blue-400" />
              <span>Recent Payout Activity</span>
            </h2>
            <Link href="/payouts" className="text-xs text-blue-400 hover:underline flex items-center">
              View All <ArrowUpRight className="w-3 h-3 ml-1" />
            </Link>
          </div>

          <div className="space-y-3">
            <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-md flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">Acme Logistics Inc — Invoice #41</div>
                <div className="text-xs text-slate-400 font-mono">5K7m1zX4vM9nL2kP8jQ3wE6rT1yU4iO9pS2aD5fG8hJ0kL3mN6bP9qR2sT5uV8wX</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-emerald-400 text-sm">1,500.00 USDC</div>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
                  CONFIRMED
                </span>
              </div>
            </div>

            <div className="p-4 bg-slate-900/60 border border-slate-800/80 rounded-md flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">Global Tech Contractors — Server Infrastructure</div>
                <div className="text-xs text-slate-400 font-mono">Idempotency: idem-seed-002</div>
              </div>
              <div className="text-right">
                <div className="font-bold text-amber-400 text-sm">3,500.00 USDC</div>
                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded font-mono">
                  PENDING_APPROVAL (1/2)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Governance Status */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold border-b border-slate-800 pb-4">Devnet Network Health</h2>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400">Target Cluster</span>
              <span className="font-mono text-xs bg-slate-800 px-2 py-0.5 rounded text-blue-300">devnet</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400">USDC Mint Address</span>
              <span className="font-mono text-xs text-slate-300">4zMMC9...JncDU</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-800/60">
              <span className="text-slate-400">Signing Adapter</span>
              <span className="text-xs text-amber-300 font-mono">MockDevnetSigner</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-400">Mainnet Safeguard</span>
              <span className="text-xs text-emerald-400 font-bold">STRICTLY PROHIBITED</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
