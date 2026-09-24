'use client';

import React, { use, useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  ExternalLink,
  ArrowLeft,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  Rocket,
  History,
  AlertTriangle,
  CircleSlash,
} from 'lucide-react';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../../lib/hooks';
import { api, ApiError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth-context';
import { useToast } from '../../../components/Toast';
import { Card, StatusBadge, MonoAddress, RiskBadge } from '../../../components/ui';
import { formatUsdc, formatDate, explorerTxUrl, truncateAddress } from '../../../lib/format';
import type { AuditEvent, Payout } from '../../../lib/types';

export default function PayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { user } = useAuth();
  const toast = useToast();
  const { data: payout, loading, refetch } = useApi<Payout>(`/v1/payouts/${id}`);
  const { data: audit } = useApi<AuditEvent[]>(`/v1/payouts/${id}/audit`);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | 'execute' | null>(null);

  const act = async (
    action: 'approve' | 'reject' | 'queue-execution',
    kind: 'approve' | 'reject' | 'execute',
  ) => {
    setBusy(kind);
    try {
      await api.post(
        `/v1/payouts/${id}/${action}`,
        action === 'queue-execution' ? undefined : { comment: comment || undefined },
      );
      toast.success(
        action === 'approve'
          ? 'Approval recorded'
          : action === 'reject'
            ? 'Payout rejected'
            : 'Queued for execution',
        action === 'queue-execution'
          ? 'The worker will simulate, sign, and submit this payout.'
          : undefined,
      );
      setComment('');
      refetch();
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Card className="h-24 p-6">
          <div className="skeleton h-full w-full" />
        </Card>
        <Card className="h-64 p-6">
          <div className="skeleton h-full w-full" />
        </Card>
      </div>
    );
  }

  if (!payout) {
    return (
      <div className="mx-auto max-w-4xl py-16 text-center text-sm text-slate-400">
        Payout not found, or you don&rsquo;t have access to it.
      </div>
    );
  }

  const required = payout.policyEvaluation?.requiredApprovals ?? 0;
  const approvals = payout.approvals || [];
  const approvedList = approvals.filter((a) => a.decision === 'APPROVED');
  const rejectedList = approvals.filter((a) => a.decision === 'REJECTED');
  const alreadyActed = approvals.some((a) => a.userId === user?.id);
  const isOwnPayout = payout.createdByUserId === user?.id;

  const canApprove =
    user &&
    hasPermission(user.role, 'payout:approve') &&
    payout.status === 'PENDING_APPROVAL' &&
    !alreadyActed;
  const canExecute =
    user && hasPermission(user.role, 'payout:execute') && payout.status === 'APPROVED';
  const simulationSucceeded = Boolean(payout.simulationResult?.success);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link
          href="/payouts"
          className="mb-3 flex items-center text-xs text-slate-500 transition-colors hover:text-slate-200"
        >
          <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back to Payouts
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-white">
              {formatUsdc(payout.amountBaseUnits, payout.decimals)} {payout.assetSymbol}
            </h1>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {payout.id} · Idempotency: {payout.idempotencyKey}
            </p>
          </div>
          <StatusBadge status={payout.status} className="px-3 py-1.5 text-xs" />
        </div>
      </div>

      {payout.status === 'BLOCKED' && (
        <Card className="border-rose-500/25 bg-rose-500/5 p-4">
          <div className="flex items-start gap-3">
            <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-semibold text-rose-300">
                Blocked by policy before it could reach approval
              </p>
              {payout.riskReasons && payout.riskReasons.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-xs text-rose-300/80">
                  {payout.riskReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {payout.status === 'FAILED' && payout.failureMessage && (
        <Card className="border-rose-500/25 bg-rose-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <p className="text-sm font-semibold text-rose-300">
                {payout.failureCode || 'Execution failed'}
              </p>
              <p className="mt-0.5 text-xs text-rose-300/80">{payout.failureMessage}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Core details */}
      <Card className="grid grid-cols-1 gap-6 p-6 md:grid-cols-3">
        <div>
          <div className="text-[11px] font-semibold uppercase text-slate-500">Amount</div>
          <div className="mt-1 text-xl font-bold text-slate-100">
            {formatUsdc(payout.amountBaseUnits, payout.decimals)} {payout.assetSymbol}
          </div>
          <div className="mt-0.5 font-mono text-xs text-slate-500">
            {payout.amountBaseUnits} base units
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase text-slate-500">Recipient</div>
          <div className="mt-1 flex items-center gap-2 font-semibold text-slate-200">
            {payout.recipient?.displayName || truncateAddress(payout.recipientId)}
            {payout.recipient && <RiskBadge level={payout.recipient.riskLevel} />}
          </div>
          {payout.recipient && (
            <div className="mt-0.5">
              <MonoAddress value={payout.recipient.walletAddress} />
            </div>
          )}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase text-slate-500">
            Invoice & Purpose
          </div>
          <div className="mt-1 font-semibold text-slate-200">{payout.invoiceReference || '—'}</div>
          <div className="mt-0.5 text-xs text-slate-500">{payout.memo || 'No memo provided'}</div>
        </div>
      </Card>

      {/* Simulation & execution report */}
      <Card className="space-y-4 p-6">
        <h2 className="flex items-center space-x-2 border-b border-white/[0.06] pb-3 text-lg font-semibold text-slate-100">
          <ShieldCheck className="h-5 w-5 text-solana-purple" />
          <span>Solana Devnet Simulation &amp; Execution Report</span>
        </h2>

        {payout.simulationResult ? (
          <div className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-white/[0.06] bg-black/20 p-4">
              <div className="font-semibold uppercase text-slate-500">Simulation Status</div>
              <div
                className={`flex items-center font-bold ${simulationSucceeded ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                <ShieldCheck className="mr-1 h-4 w-4" />
                {simulationSucceeded ? 'Transaction Simulation Passed' : 'Simulation Failed'}
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-white/[0.06] bg-black/20 p-4">
              <div className="font-semibold uppercase text-slate-500">Program IDs Verified</div>
              <div className="space-y-1 font-mono text-[11px] text-slate-300">
                {payout.simulationResult.programIds.map((pid) => (
                  <div
                    key={pid}
                    className={
                      payout.simulationResult?.unknownProgramIds.includes(pid)
                        ? 'text-rose-400'
                        : ''
                    }
                  >
                    • {pid}
                  </div>
                ))}
              </div>
              {typeof payout.simulationResult.unitsConsumed === 'number' && (
                <div className="pt-1 text-slate-500">
                  Compute Units:{' '}
                  <span className="font-mono text-slate-200">
                    {payout.simulationResult.unitsConsumed.toLocaleString()} CU
                  </span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.08] bg-black/10 p-4 text-xs text-slate-500">
            {payout.status === 'DRAFT' ||
            payout.status === 'PENDING_APPROVAL' ||
            payout.status === 'APPROVED'
              ? 'Simulation runs once this payout is queued for execution — the worker checks every instruction’s program ID against the allowlist before anything is signed.'
              : 'No simulation result recorded.'}
          </div>
        )}

        {payout.transactionSignature && (
          <div className="space-y-2 rounded-lg border border-white/[0.06] bg-black/20 p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">
              Devnet Confirmation Signature
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="break-all font-mono text-xs text-slate-200">
                {payout.transactionSignature}
              </span>
              <a
                href={explorerTxUrl(payout.transactionSignature)}
                target="_blank"
                rel="noreferrer"
                className="ml-2 flex items-center text-xs text-solana-green hover:underline"
              >
                Explorer <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </div>
          </div>
        )}
      </Card>

      {/* Approval queue */}
      <Card className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
          <h2 className="text-lg font-semibold text-slate-100">
            Multi-User Approval {required > 0 ? `(Required: ${required})` : ''}
          </h2>
          {canExecute && (
            <button
              onClick={() => act('queue-execution', 'execute')}
              disabled={busy !== null}
              className="btn-gradient"
            >
              {busy === 'execute' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              Queue for Execution
            </button>
          )}
        </div>

        <div className="space-y-3 text-xs">
          {approvedList.map((a) => (
            <ApprovalRow
              key={a.id}
              decision="APPROVED"
              name={a.user.displayName}
              comment={a.comment}
            />
          ))}
          {rejectedList.map((a) => (
            <ApprovalRow
              key={a.id}
              decision="REJECTED"
              name={a.user.displayName}
              comment={a.comment}
            />
          ))}
          {approvals.length === 0 && payout.status === 'PENDING_APPROVAL' && (
            <div className="flex items-center justify-between rounded-lg border border-dashed border-white/[0.08] bg-black/10 px-3 py-3 text-slate-500">
              <span>Awaiting first independent approval</span>
              <StatusBadge status="PENDING" />
            </div>
          )}
        </div>

        {canApprove && (
          <div className="space-y-3 border-t border-white/[0.06] pt-4">
            {isOwnPayout && (
              <p className="flex items-center gap-1.5 text-xs text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> You created this payout — policy may
                prevent you from approving your own request.
              </p>
            )}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional approval comment…"
              rows={2}
              className="input-field resize-none text-xs"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={() => act('approve', 'approve')}
                disabled={busy !== null}
                className="btn-gradient"
              >
                {busy === 'approve' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ThumbsUp className="h-3.5 w-3.5" />
                )}
                Approve
              </button>
              <button
                onClick={() => act('reject', 'reject')}
                disabled={busy !== null}
                className="btn-danger"
              >
                {busy === 'reject' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ThumbsDown className="h-3.5 w-3.5" />
                )}
                Reject
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* Audit trail */}
      {audit && audit.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.06] pb-3 text-lg font-semibold text-slate-100">
            <History className="h-5 w-5 text-solana-green" />
            Immutable Audit Timeline
          </h2>
          <ol className="space-y-4">
            {audit.map((event) => (
              <li key={event.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className="h-2 w-2 rounded-full bg-solana-gradient" />
                  <span className="mt-1 w-px flex-1 bg-white/[0.08]" />
                </div>
                <div className="pb-1">
                  <p className="text-xs font-semibold text-slate-200">
                    {event.action.replace(/_/g, ' ')}
                  </p>
                  <p className="text-[11px] text-slate-500">{formatDate(event.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

function ApprovalRow({
  decision,
  name,
  comment,
}: {
  decision: 'APPROVED' | 'REJECTED';
  name: string;
  comment?: string | null;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/20 p-3">
      <div>
        <div className="font-semibold text-slate-200">{name}</div>
        {comment && <div className="text-slate-400">&ldquo;{comment}&rdquo;</div>}
      </div>
      <StatusBadge status={decision} />
    </div>
  );
}
