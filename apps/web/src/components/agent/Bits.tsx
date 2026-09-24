'use client';

import React from 'react';
import { CheckCircle2, ChevronDown, CircleSlash, MinusCircle, ShieldAlert, XCircle } from 'lucide-react';
import { MonoAddress, StatusBadge } from '../ui';
import { formatUsdc } from '../../lib/format';
import { hostOf, ruleTitle } from '../../lib/agent-format';
import type { AgentDecisionView, RuleResultView } from '../../lib/agent-types';

/** Budget consumption bar. Uses BigInt so no amount is ever rounded through a float. */
export function SpendBar({
  label,
  used,
  limit,
  decimals = 6,
}: {
  label: string;
  used: string;
  limit: string;
  decimals?: number;
}) {
  let pct = 0;
  try {
    const l = BigInt(limit);
    pct = l === 0n ? 0 : Number((BigInt(used) * 1000n) / l) / 10;
  } catch {
    pct = 0;
  }
  const clamped = Math.min(100, Math.max(0, pct));
  const tone = clamped >= 90 ? 'bg-rose-400' : clamped >= 70 ? 'bg-amber-400' : 'bg-solana-gradient';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className="font-mono text-slate-300">
          {formatUsdc(used, decimals)} <span className="text-slate-600">/</span> {formatUsdc(limit, decimals)}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
      >
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 min-w-0 break-words text-sm text-slate-200">{children}</dd>
    </div>
  );
}

const RULE_ICON: Record<string, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  PASS: { icon: CheckCircle2, cls: 'text-emerald-400' },
  FAIL: { icon: XCircle, cls: 'text-rose-400' },
  ESCALATE: { icon: ShieldAlert, cls: 'text-amber-400' },
  OVERRIDDEN: { icon: CheckCircle2, cls: 'text-solana-purple' },
  SKIPPED: { icon: MinusCircle, cls: 'text-slate-600' },
};

/** Every rule the gate evaluated, in order, with the failing one(s) highlighted. */
export function RuleList({ rules, highlight }: { rules: RuleResultView[]; highlight?: string[] }) {
  return (
    <ol className="space-y-1.5">
      {rules.map((rule) => {
        const meta = RULE_ICON[rule.status] ?? { icon: CircleSlash, cls: 'text-slate-500' };
        const Icon = meta.icon;
        const flagged = rule.status === 'FAIL' || rule.status === 'ESCALATE' || highlight?.includes(rule.id);
        return (
          <li
            key={rule.id}
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-xs ${
              rule.status === 'FAIL'
                ? 'border-rose-500/30 bg-rose-500/[0.07]'
                : rule.status === 'ESCALATE'
                  ? 'border-amber-500/30 bg-amber-500/[0.07]'
                  : 'border-white/[0.05] bg-white/[0.02]'
            }`}
          >
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.cls}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className={`font-semibold ${flagged ? 'text-white' : 'text-slate-300'}`}>
                  {ruleTitle(rule.id)}
                </span>
                <span className="font-mono text-[10px] text-slate-600">{rule.id}</span>
              </div>
              <p className="mt-0.5 break-words text-slate-400">{rule.message}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** One decision, collapsed to a row and expandable to the full per-rule evidence. */
export function DecisionRow({
  decision,
  fresh = false,
  agentLabel,
  decimals = 6,
}: {
  decision: AgentDecisionView;
  fresh?: boolean;
  agentLabel?: string;
  decimals?: number;
}) {
  const [open, setOpen] = React.useState(false);
  const accent =
    decision.decision === 'ALLOW'
      ? 'before:bg-emerald-400'
      : decision.decision === 'DENY'
        ? 'before:bg-rose-400'
        : 'before:bg-amber-400';
  const at = new Date(decision.createdAt * 1000).toLocaleTimeString('en-US', { hour12: false });
  return (
    <li
      className={`relative overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${accent} ${
        fresh ? 'animate-fade-in bg-white/[0.03]' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-col gap-2 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:gap-4"
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 sm:w-40 sm:shrink-0">
          <StatusBadge status={decision.decision} />
          <span className="font-mono text-[11px] text-slate-500">{at}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{hostOf(decision.offer.resourceUrl)}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {agentLabel ? `${agentLabel} · ` : ''}
            {decision.decision === 'ALLOW'
              ? decision.kind === 'APPROVED'
                ? 'released after human approval'
                : 'within mandate'
              : decision.failedRule
                ? `${ruleTitle(decision.failedRule)} — ${decision.reason}`
                : decision.reason}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="font-mono text-sm font-bold text-slate-100">
            {formatUsdc(decision.offer.amount, decimals)}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="space-y-4 border-t border-white/[0.05] bg-black/20 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <KeyValue label="Pay to">
              <MonoAddress value={decision.offer.payTo} />
            </KeyValue>
            <KeyValue label="Asset">
              <MonoAddress value={decision.offer.asset} />
            </KeyValue>
            <KeyValue label="Decision hash">
              <MonoAddress value={decision.decisionHash} lead={10} trail={6} />
            </KeyValue>
          </div>
          <RuleList rules={decision.rulesEvaluated} highlight={decision.failedRules} />
        </div>
      )}
    </li>
  );
}
