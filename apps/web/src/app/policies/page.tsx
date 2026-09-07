'use client';

import React from 'react';
import { FileText, CheckCircle2 } from 'lucide-react';

export default function PoliciesPage() {
  const policyRules = {
    version: 1,
    approval: {
      requiredApprovals: 2,
      eligibleRoles: ['OWNER', 'ADMIN', 'APPROVER'],
      preventCreatorApproval: true,
    },
    limits: {
      maxSinglePayoutBaseUnits: '5000000000', // 5,000 USDC
      dailyLimitBaseUnits: '25000000000', // 25,000 USDC
      monthlyLimitBaseUnits: '100000000000', // 100,000 USDC
    },
    recipients: {
      requireVerifiedRecipient: true,
      allowedRecipientIds: [],
      blockedRecipientIds: [],
    },
    assets: {
      allowedMintAddresses: ['4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'],
    },
    transaction: {
      requireSuccessfulSimulation: true,
      blockUnknownProgramIds: true,
      allowProgramIds: [
        '11111111111111111111111111111111',
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
        'ComputeBudget111111111111111111111111111111',
        'MemoSsq6gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcY',
      ],
      blockMemoRequired: false,
      minimumConfirmations: 'confirmed',
    },
    risk: {
      blockHighRiskRecipients: true,
      manualReviewAboveRiskLevel: 'HIGH',
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Spend Policies & Governance</h1>
          <p className="text-sm text-slate-400">Programmable rules defining authorization thresholds, approval counts, and instruction allowlists.</p>
        </div>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <FileText className="w-6 h-6 text-blue-400" />
            <div>
              <h2 className="font-bold text-lg">Default Enterprise Treasury Policy v1</h2>
              <span className="text-xs text-slate-400 font-mono">version: 1</span>
            </div>
          </div>
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>ACTIVE POLICY</span>
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="bg-slate-900/80 p-4 rounded border border-slate-800">
            <div className="text-xs text-slate-400 uppercase font-semibold">Required Approvals</div>
            <div className="text-xl font-bold mt-1 text-slate-100">2 Approvers</div>
            <p className="text-xs text-slate-400 mt-1">Creator approval explicitly prohibited</p>
          </div>
          <div className="bg-slate-900/80 p-4 rounded border border-slate-800">
            <div className="text-xs text-slate-400 uppercase font-semibold">Single Payout Max</div>
            <div className="text-xl font-bold mt-1 text-slate-100">5,000.00 USDC</div>
            <p className="text-xs text-slate-400 mt-1">5,000,000,000 base units</p>
          </div>
          <div className="bg-slate-900/80 p-4 rounded border border-slate-800">
            <div className="text-xs text-slate-400 uppercase font-semibold">Transaction Simulation</div>
            <div className="text-xl font-bold mt-1 text-emerald-400">Strict Allowlist</div>
            <p className="text-xs text-slate-400 mt-1">Blocks unknown program IDs</p>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800">
          <h3 className="text-sm font-semibold text-slate-300 mb-2">Policy Configuration JSON</h3>
          <pre className="bg-slate-950 p-4 rounded text-xs font-mono text-blue-300 border border-slate-800 overflow-x-auto">
            {JSON.stringify(policyRules, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
