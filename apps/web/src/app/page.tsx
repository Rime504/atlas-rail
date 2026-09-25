'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Bot,
  Landmark,
  Plus,
  ReceiptText,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../lib/hooks';
import { useAuth } from '../lib/auth-context';
import { Card, EmptyState, MonoAddress, SkeletonRows, StatCard, StatusBadge } from '../components/ui';
import { GuidedTour } from '../components/GuidedTour';
import { DecisionRow, SpendBar } from '../components/agent/Bits';
import { formatToken, ruleTitle, timeAgoUnix } from '../lib/agent-format';
import type { AgentDecisionView, ApprovalView, MandateView, ReceiptListItem } from '../lib/agent-types';

/** Plain-language "what's happening right now" for someone who has never seen a rule ID. */
function summarizeMandate(m: MandateView): string {
  if (m.status === 'REVOKED') return 'Revoked — this agent can no longer spend.';
  if (m.status === 'DRAFT') return 'Waiting on signatures before it’s active.';
  if (m.status === 'EXPIRED') return 'Expired — renew it to let this agent keep spending.';
  const limits = m.mandate.scope.limits;
  const pct = (() => {
    try {
      const limit = BigInt(limits.maxPerWindow);
      return limit === 0n ? 0 : Number((BigInt(m.spend.windowAutonomousBaseUnits) * 100n) / limit);
    } catch {
      return 0;
    }
  })();
  return pct >= 90 ? 'Close to its spending limit for this window.' : 'Operating normally, within budget.';
}

export default function AgentHomePage() {
  const { user } = useAuth();
  const canSeeMandates = Boolean(user && hasPermission(user.role, 'mandate:read'));
  const canSeeApprovals = Boolean(user && hasPermission(user.role, 'approval:read'));
  const canSeeReceipts = Boolean(user && hasPermission(user.role, 'receipt:read'));
  const canCreateMandate = Boolean(user && hasPermission(user.role, 'mandate:create'));

  const { data: mandates, loading: mandatesLoading } = useApi<MandateView[]>(canSeeMandates ? '/v1/agent/mandates' : null);
  const { data: approvals, loading: approvalsLoading } = useApi<ApprovalView[]>(
    canSeeApprovals ? '/v1/agent/approvals?status=PENDING&limit=50' : null,
  );
  const { data: decisions } = useApi<AgentDecisionView[]>(canSeeMandates ? '/v1/agent/decisions?limit=6' : null);
  const { data: receipts } = useApi<ReceiptListItem[]>(canSeeReceipts ? '/v1/agent/receipts?limit=5' : null);

  const activeMandates = useMemo(() => (mandates ?? []).filter((m) => m.status === 'ACTIVE'), [mandates]);
  const pendingCount = approvals?.length ?? 0;
  const needsAttention = useMemo(
    () => (decisions ?? []).filter((d) => d.decision !== 'ALLOW').slice(0, 3),
    [decisions],
  );

  // "Clear next action": the single most useful thing to do right now, ranked by urgency.
  const nextAction = (() => {
    if (canSeeApprovals && pendingCount > 0) {
      return {
        text: `${pendingCount} payment${pendingCount === 1 ? '' : 's'} waiting for your approval`,
        href: '/approvals',
        cta: 'Review now',
        tone: 'amber' as const,
      };
    }
    if (canSeeMandates && mandates && activeMandates.length === 0) {
      return {
        text: 'No active mandates yet — an agent can’t spend anything until one exists',
        href: '/mandates',
        cta: canCreateMandate ? 'Create a mandate' : 'View mandates',
        tone: 'purple' as const,
      };
    }
    return null;
  })();

  return (
    <div className="space-y-8">
      <GuidedTour />

      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-white">
            Welcome back{user ? `, ${user.displayName.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-mutedText">
            What your agents are doing right now, and what needs you.
          </p>
        </div>
        <Link href="/treasury" className="btn-ghost shrink-0">
          <Landmark className="h-4 w-4" />
          Treasury dashboard
        </Link>
      </div>

      {nextAction && (
        <Card
          className={`flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center ${
            nextAction.tone === 'amber' ? 'border-amber-500/25' : 'border-solana-purple/25'
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                nextAction.tone === 'amber' ? 'bg-amber-500/10 text-amber-400' : 'bg-solana-purple/10 text-solana-purple'
              }`}
            >
              <ShieldAlert className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Next action</p>
              <p className="text-sm font-medium text-slate-100">{nextAction.text}</p>
            </div>
          </div>
          <Link href={nextAction.href} className="btn-gradient w-full shrink-0 sm:w-auto">
            {nextAction.cta}
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={Bot}
          label="Active mandates"
          value={activeMandates.length}
          sub="Agents currently able to spend"
          accent="green"
          loading={mandatesLoading}
        />
        <StatCard
          icon={UserCheck}
          label="Pending approvals"
          value={pendingCount}
          sub={pendingCount > 0 ? 'Waiting on a human decision' : 'Nothing waiting'}
          accent={pendingCount > 0 ? 'amber' : 'slate'}
          loading={approvalsLoading}
        />
        <StatCard
          icon={ReceiptText}
          label="Receipts (all time)"
          value={receipts ? receipts.length : '—'}
          sub="Most recent 5 shown below"
          accent="purple"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {canSeeMandates && (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-200">Your agents</h2>
                <p className="mt-0.5 text-xs text-mutedText">Spend against budget, in plain terms.</p>
              </div>
              <Link href="/mandates" className="flex items-center gap-1 text-xs font-semibold text-solana-green hover:underline">
                All mandates <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="mt-4 space-y-4">
              {mandatesLoading && !mandates ? (
                <SkeletonRows rows={3} cols={2} />
              ) : activeMandates.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title="No active agents"
                  description="Draft a mandate to give an agent a budget and a human approval threshold."
                  action={
                    canCreateMandate && (
                      <Link href="/mandates" className="btn-gradient mt-2">
                        <Plus className="h-4 w-4" /> Create a mandate
                      </Link>
                    )
                  }
                />
              ) : (
                activeMandates.slice(0, 4).map((m) => (
                  <Link key={m.id} href={`/mandates/${m.id}`} className="block rounded-lg border border-white/[0.05] p-3.5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.02]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-slate-100">{m.mandate.agent.label}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-1 text-xs text-mutedText">{summarizeMandate(m)}</p>
                    <div className="mt-3">
                      <SpendBar label="This window" used={m.spend.windowAutonomousBaseUnits} limit={m.mandate.scope.limits.maxPerWindow} />
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>
        )}

        {canSeeApprovals && (
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-sm font-semibold text-slate-200">Waiting on you</h2>
                <p className="mt-0.5 text-xs text-mutedText">Payments above an agent&rsquo;s own authority.</p>
              </div>
              <Link href="/approvals" className="flex items-center gap-1 text-xs font-semibold text-solana-green hover:underline">
                All approvals <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {approvalsLoading && !approvals ? (
                <SkeletonRows rows={2} cols={2} />
              ) : pendingCount === 0 ? (
                <EmptyState icon={ShieldCheck} title="Nothing waiting" description="Every agent is operating on its own authority right now." />
              ) : (
                (approvals ?? []).slice(0, 4).map((a) => (
                  <Link key={a.id} href="/approvals" className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3.5 transition-colors hover:border-amber-500/40">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{a.agentLabel ?? 'Agent'} requests {formatToken(a.offer.amount)}</p>
                      <p className="mt-0.5 text-xs text-mutedText">
                        {a.escalationRules[0] ? ruleTitle(a.escalationRules[0]) : 'Needs approval'}
                      </p>
                    </div>
                    <MonoAddress value={a.offer.payTo} lead={4} trail={4} />
                  </Link>
                ))
              )}
            </div>
          </Card>
        )}
      </div>

      {canSeeMandates && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-200">Latest decisions</h2>
              <p className="mt-0.5 text-xs text-mutedText">
                {needsAttention.length > 0
                  ? `${needsAttention.length} recent decision${needsAttention.length === 1 ? '' : 's'} weren’t a plain allow.`
                  : 'Every recent request was allowed within its mandate.'}
              </p>
            </div>
            <Link href="/decisions" className="flex items-center gap-1 text-xs font-semibold text-solana-green hover:underline">
              Live feed <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          {!decisions || decisions.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No decisions yet" description="Once an agent tries to pay for something, every decision shows up here." />
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {decisions.slice(0, 5).map((d) => (
                <DecisionRow key={d.id} decision={d} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {canSeeReceipts && receipts && receipts.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
            <h2 className="font-display text-sm font-semibold text-slate-200">Latest receipts</h2>
            <Link href="/receipts" className="flex items-center gap-1 text-xs font-semibold text-solana-green hover:underline">
              All receipts <ArrowUpRight className="h-3 w-3" />
            </Link>
          </div>
          <ul className="divide-y divide-white/[0.05]">
            {receipts.map((r) => (
              <li key={r.id}>
                <Link href={`/receipts/${r.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-white/[0.02]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">{r.agentLabel}</p>
                    <p className="mt-0.5 text-xs text-mutedText">{timeAgoUnix(r.issuedAt)}</p>
                  </div>
                  <span className="font-mono text-sm font-bold text-slate-100">{formatToken(r.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
