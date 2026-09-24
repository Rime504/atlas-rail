'use client';

import React, { useEffect, useState } from 'react';
import { Check, Clock, ShieldAlert, UserCheck, X } from 'lucide-react';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth-context';
import { api, ApiError } from '../../lib/api';
import { usePendingApprovals, useNowSeconds } from '../../lib/agent-hooks';
import { useToast } from '../../components/Toast';
import { Card, EmptyState, MonoAddress, PageHeader, SkeletonRows, Spinner, StatusBadge } from '../../components/ui';
import { KeyValue } from '../../components/agent/Bits';
import { formatToken, countdownUnix, formatUnix, hostOf, ruleTitle, timeAgoUnix } from '../../lib/agent-format';
import type { ApprovalView } from '../../lib/agent-types';

type Tab = 'PENDING' | 'HISTORY';

function ApprovalCard({
  approval,
  now,
  canDecide,
  onDecided,
}: {
  approval: ApprovalView;
  now: number;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [comment, setComment] = useState('');
  const pending = approval.status === 'PENDING';
  const left = approval.expiresAt - now;
  const urgent = pending && left < 60;

  const decide = async (kind: 'approve' | 'deny') => {
    setBusy(kind);
    try {
      await api.post(`/v1/agent/approvals/${approval.id}/${kind}`, comment.trim() ? { comment: comment.trim() } : {});
      toast.success(kind === 'approve' ? 'Payment approved' : 'Payment denied', kind === 'approve' ? 'The agent may now complete this exact payment, once.' : 'The agent has been told no.');
      onDecided();
    } catch (err) {
      toast.error('Could not record your decision', err instanceof ApiError ? err.message : 'Please try again.');
      onDecided();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className={`overflow-hidden ${pending ? 'border-amber-500/25' : ''}`}>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{approval.agentLabel ?? 'Agent'} requests</p>
            <p className="mt-1 font-display text-3xl font-bold tracking-tight text-white">
              {formatToken(approval.offer.amount)}
              <span className="ml-1.5 text-sm font-medium text-slate-500">USDC</span>
            </p>
          </div>
          {pending ? (
            <span
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                urgent ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              {countdownUnix(approval.expiresAt, now)}
            </span>
          ) : (
            <StatusBadge status={approval.status} />
          )}
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <KeyValue label="Resource">
            <span className="break-all font-mono text-xs">{hostOf(approval.offer.resourceUrl)}</span>
          </KeyValue>
          <KeyValue label="Recipient">
            <MonoAddress value={approval.offer.payTo} lead={8} trail={8} />
          </KeyValue>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-400" />
          <span className="text-xs text-slate-400">Needs a human because:</span>
          {approval.escalationRules.map((r) => (
            <span key={r} className="rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
              {ruleTitle(r)}
            </span>
          ))}
        </div>

        {pending && canDecide && (
          <>
            <input
              className="input-field"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note (optional)"
              maxLength={500}
              aria-label="Decision note"
            />
            <div className="grid grid-cols-2 gap-3">
              <button
                className="btn-danger min-h-[48px] text-base"
                disabled={busy !== null || left <= 0}
                onClick={() => decide('deny')}
              >
                {busy === 'deny' ? <Spinner /> : <X className="h-5 w-5" />} Deny
              </button>
              <button
                className="btn-gradient min-h-[48px] text-base"
                disabled={busy !== null || left <= 0}
                onClick={() => decide('approve')}
              >
                {busy === 'approve' ? <Spinner /> : <Check className="h-5 w-5" />} Approve
              </button>
            </div>
            <p className="text-center text-[11px] text-slate-600">
              Approval is bound to this exact recipient, amount and resource, works once, and expires on its own.
            </p>
          </>
        )}

        {!pending && (
          <p className="text-xs text-slate-500">
            {approval.status === 'EXPIRED'
              ? 'Expired without a decision.'
              : `${approval.status === 'DENIED' ? 'Denied' : 'Approved'}${approval.decidedBy ? ` by ${approval.decidedBy.role.toLowerCase()}` : ''} ${timeAgoUnix(approval.decidedAt)}`}
            {approval.comment ? ` — “${approval.comment}”` : ''}
          </p>
        )}
        <p className="text-[11px] text-slate-600">Requested {formatUnix(approval.requestedAt)}</p>
      </div>
    </Card>
  );
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const now = useNowSeconds();
  const { refresh } = usePendingApprovals();
  const { data, loading, error, refetch } = useApi<ApprovalView[]>('/v1/agent/approvals?limit=100');
  const [tab, setTab] = useState<Tab>('PENDING');
  const canDecide = Boolean(user && hasPermission(user.role, 'approval:decide'));

  useEffect(() => {
    const id = window.setInterval(refetch, 4000);
    return () => window.clearInterval(id);
  }, [refetch]);

  const isPending = (a: ApprovalView) => a.status === 'PENDING' && a.expiresAt > now;
  const pending = (data ?? []).filter(isPending).sort((a, b) => a.expiresAt - b.expiresAt);
  const history = (data ?? []).filter((a) => !isPending(a)).sort((a, b) => b.requestedAt - a.requestedAt);
  const list = tab === 'PENDING' ? pending : history;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="When an agent asks to spend more than its mandate allows on its own, it waits here for a human. Approve or deny from any device."
      />

      <div className="flex gap-2" role="tablist" aria-label="Approval queue">
        {(
          [
            ['PENDING', `Pending${pending.length ? ` (${pending.length})` : ''}`],
            ['HISTORY', 'History'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`min-h-[40px] flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors sm:flex-none ${
              tab === key ? 'border-solana-purple/50 bg-solana-purple/15 text-white' : 'border-white/10 text-slate-400 hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300" role="alert">
          {error}
        </div>
      )}

      {loading && !data ? (
        <Card>
          <SkeletonRows rows={3} cols={3} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={UserCheck}
            title={tab === 'PENDING' ? 'Nothing waiting on you' : 'No past approvals'}
            description={
              tab === 'PENDING'
                ? 'When an agent requests a payment above its human-approval threshold, it appears here instantly and the agent waits.'
                : 'Decided and expired approvals are kept here for review.'
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              now={now}
              canDecide={canDecide}
              onDecided={() => {
                refetch();
                refresh();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
