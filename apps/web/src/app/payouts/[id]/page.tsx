'use client';

import React, { use } from 'react';
import { CheckCircle2, Clock, ShieldCheck, ExternalLink, ArrowLeft, ThumbsUp, ThumbsDown } from 'lucide-react';
import Link from 'next/link';

export default function PayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isConfirmed = id === 'pay_01';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <Link href="/payouts" className="text-xs text-slate-400 hover:text-slate-200 flex items-center mb-3">
          <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back to Payouts List
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Payout Request {id}</h1>
            <p className="text-sm text-slate-400 font-mono">Idempotency Key: idem-seed-{isConfirmed ? '001' : '002'}</p>
          </div>
          {isConfirmed ? (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="w-4 h-4" />
              <span>CONFIRMED</span>
            </span>
          ) : (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Clock className="w-4 h-4" />
              <span>PENDING APPROVAL (1/2)</span>
            </span>
          )}
        </div>
      </div>

      {/* Payout Core Details */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <div className="text-xs text-slate-400 uppercase font-semibold">Payout Amount</div>
          <div className="text-2xl font-bold text-slate-100 mt-1">{isConfirmed ? '1,500.00 USDC' : '3,500.00 USDC'}</div>
          <div className="text-xs text-slate-400 font-mono mt-0.5">{isConfirmed ? '1500000000 base units' : '3500000000 base units'}</div>
        </div>

        <div>
          <div className="text-xs text-slate-400 uppercase font-semibold">Recipient</div>
          <div className="font-semibold text-slate-200 mt-1">Acme Logistics Inc</div>
          <div className="text-xs font-mono text-slate-400 mt-0.5 truncate">9WzDXw...9zYtAWWM</div>
        </div>

        <div>
          <div className="text-xs text-slate-400 uppercase font-semibold">Invoice & Purpose</div>
          <div className="font-semibold text-slate-200 mt-1">{isConfirmed ? 'PO-99120' : 'PO-99185'}</div>
          <div className="text-xs text-slate-400 mt-0.5">{isConfirmed ? 'March Freight Invoice #41' : 'Q2 Server Infrastructure'}</div>
        </div>
      </div>

      {/* Transaction & Simulation Report */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold flex items-center space-x-2 border-b border-slate-800 pb-3">
          <ShieldCheck className="w-5 h-5 text-blue-400" />
          <span>Solana Devnet Simulation & Execution Report</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-2">
            <div className="text-slate-400 font-semibold uppercase">Simulation Status</div>
            <div className="text-emerald-400 font-bold flex items-center">
              <CheckCircle2 className="w-4 h-4 mr-1" /> Transaction Simulation Passed
            </div>
            <div className="text-slate-400">Compute Units: <span className="font-mono text-slate-200">12,500 CU</span></div>
          </div>

          <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-2">
            <div className="text-slate-400 font-semibold uppercase">Program IDs Verified</div>
            <div className="font-mono text-[11px] text-slate-300 space-y-1">
              <div>• 11111111111111111111111111111111 (System)</div>
              <div>• TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (SPL Token)</div>
              <div>• ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL (ATA)</div>
            </div>
          </div>
        </div>

        {isConfirmed && (
          <div className="p-4 bg-slate-900 border border-slate-800 rounded space-y-2">
            <div className="text-xs text-slate-400 font-semibold uppercase">Devnet Confirmation Signature</div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-slate-200 break-all">
                5K7m1zX4vM9nL2kP8jQ3wE6rT1yU4iO9pS2aD5fG8hJ0kL3mN6bP9qR2sT5uV8wX
              </span>
              <a
                href="https://explorer.solana.com/tx/5K7m1zX4vM9nL2kP8jQ3wE6rT1yU4iO9pS2aD5fG8hJ0kL3mN6bP9qR2sT5uV8wX?cluster=devnet"
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-xs text-blue-400 hover:underline flex items-center"
              >
                <span>Explorer</span> <ExternalLink className="w-3 h-3 ml-1" />
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Multi-User Authorization Queue */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-lg font-semibold">Multi-User Approval Authorization (Required: 2)</h2>
          {!isConfirmed && (
            <div className="flex items-center space-x-2">
              <button className="inline-flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors">
                <ThumbsUp className="w-3.5 h-3.5" />
                <span>Grant 2nd Approval</span>
              </button>
              <button className="inline-flex items-center space-x-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors">
                <ThumbsDown className="w-3.5 h-3.5" />
                <span>Reject Payout</span>
              </button>
            </div>
          )}
        </div>

        <div className="space-y-3 text-xs">
          <div className="p-3 bg-slate-900 rounded border border-slate-800 flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-200">Sarah Jenkins (VP Finance — APPROVER)</div>
              <div className="text-slate-400">&ldquo;Verified invoice with freight receipt documentation&rdquo;</div>
            </div>
            <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              APPROVED
            </span>
          </div>

          {isConfirmed ? (
            <div className="p-3 bg-slate-900 rounded border border-slate-800 flex items-center justify-between">
              <div>
                <div className="font-semibold text-slate-200">David Kim (Treasury Manager — APPROVER)</div>
                <div className="text-slate-400">&ldquo;Approved per Q1 treasury budget limits&rdquo;</div>
              </div>
              <span className="text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                APPROVED
              </span>
            </div>
          ) : (
            <div className="p-3 bg-slate-900/60 rounded border border-dashed border-slate-800 flex items-center justify-between text-slate-500">
              <div>
                <div className="font-semibold">Awaiting Second Independent Approval</div>
                <div>Eligible roles: OWNER, ADMIN, APPROVER</div>
              </div>
              <span className="text-amber-400 font-semibold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                PENDING
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
