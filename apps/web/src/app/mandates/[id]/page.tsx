'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Ban, Bot, CheckCircle2, Circle, KeyRound, PenLine, ShieldCheck } from 'lucide-react';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../../lib/hooks';
import { useAuth } from '../../../lib/auth-context';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { Card, EmptyState, Modal, MonoAddress, SectionLabel, SkeletonRows, Spinner, StatusBadge } from '../../../components/ui';
import { DecisionRow, KeyValue, SpendBar } from '../../../components/agent/Bits';
import { truncateAddress } from '../../../lib/format';
import { formatToken, formatDuration, formatUnix, shortHash } from '../../../lib/agent-format';
import type { AgentDecisionView, MandateView } from '../../../lib/agent-types';

type ChainSlot = { role: 'OWNER' | 'APPROVER' | 'AGENT'; label: string; signer?: MandateView['signers'][number] };

function chainSlots(m: MandateView): ChainSlot[] {
  const byRole = (role: ChainSlot['role']) => m.signers.filter((s) => s.role === role);
  const slots: ChainSlot[] = [{ role: 'OWNER', label: 'Owner', signer: byRole('OWNER')[0] }];
  const approvers = byRole('APPROVER');
  for (let i = 0; i < m.mandate.delegation.requiredApprovals; i += 1) {
    slots.push({ role: 'APPROVER', label: m.mandate.delegation.requiredApprovals > 1 ? `Approver ${i + 1}` : 'Approver', signer: approvers[i] });
  }
  slots.push({ role: 'AGENT', label: 'Agent (proof of possession)', signer: byRole('AGENT')[0] });
  return slots;
}

export default function MandateDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { user } = useAuth();
  const toast = useToast();
  const { data: m, loading, error, refetch } = useApi<MandateView>(id ? `/v1/agent/mandates/${id}` : null);
  const { data: decisions } = useApi<AgentDecisionView[]>(id ? `/v1/agent/decisions?mandateId=${id}&limit=20` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (loading && !m) {
    return (
      <Card>
        <SkeletonRows rows={6} cols={3} />
      </Card>
    );
  }
  if (error || !m) {
    return (
      <Card>
        <EmptyState
          icon={Bot}
          title="Mandate not available"
          description={error ?? 'It may have been removed, or belongs to another organisation.'}
          action={
            <Link href="/mandates" className="btn-ghost mt-2">
              <ArrowLeft className="h-4 w-4" /> Back to mandates
            </Link>
          }
        />
      </Card>
    );
  }

  const limits = m.mandate.scope.limits;
  const slots = chainSlots(m);
  const hasOwner = m.signers.some((s) => s.role === 'OWNER');
  const approverCount = m.signers.filter((s) => s.role === 'APPROVER').length;
  const alreadySigned = Boolean(user && m.signers.some((s) => s.userId === user.id));
  const canSign = Boolean(user && hasPermission(user.role, 'mandate:sign')) && m.status !== 'REVOKED' && !alreadySigned;
  const nextRole: 'OWNER' | 'APPROVER' | null = !hasOwner ? 'OWNER' : approverCount < m.mandate.delegation.requiredApprovals ? 'APPROVER' : null;
  const canRevoke = Boolean(user && hasPermission(user.role, 'mandate:revoke')) && m.status !== 'REVOKED';

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(success);
      refetch();
    } catch (err) {
      toast.error('Action failed', err instanceof ApiError ? err.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/mandates" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> All mandates
        </Link>
        <div className="mt-3 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-2xl font-bold tracking-tight text-white">{m.mandate.agent.label}</h1>
              <StatusBadge status={m.status} />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
              <span>Mandate</span>
              <span className="font-mono">{shortHash(m.id, 12, 4)}</span>
              <span>· hash</span>
              <span className="font-mono">{shortHash(m.mandateHash, 12, 6)}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSign && nextRole && (
              <button
                className="btn-gradient"
                disabled={busy !== null}
                onClick={() =>
                  run(`sign-${nextRole}`, () => api.post(`/v1/agent/mandates/${m.id}/sign`, { role: nextRole }), `Signed as ${nextRole.toLowerCase()}`)
                }
              >
                {busy?.startsWith('sign') ? <Spinner /> : <PenLine className="h-4 w-4" />}
                Sign as {nextRole.toLowerCase()}
              </button>
            )}
            {canRevoke && (
              <button className="btn-danger" onClick={() => setRevokeOpen(true)} disabled={busy !== null}>
                <Ban className="h-4 w-4" /> Revoke
              </button>
            )}
          </div>
        </div>
      </div>

      {m.revocation && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.07] p-4 text-sm text-rose-200" role="status">
          <p className="font-semibold">Revoked {formatUnix(m.revocation.revokedAt)}</p>
          <p className="mt-0.5 text-rose-300/80">{m.revocation.reason ? m.revocation.reason.replace(/[.!?]*$/, '.') : 'No reason recorded.'} Every gate evaluation since then has been denied.</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Delegation chain */}
        <Card className="p-5 lg:col-span-2">
          <SectionLabel>Delegation chain</SectionLabel>
          <ol className="mt-4 space-y-0">
            {slots.map((slot, i) => (
              <li key={`${slot.role}-${i}`} className="relative flex gap-4 pb-5 last:pb-0">
                {i < slots.length - 1 && <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-white/10" aria-hidden />}
                <span
                  className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                    slot.signer ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-white/10 bg-white/[0.03] text-slate-600'
                  }`}
                >
                  {slot.signer ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3">
                    <p className="text-sm font-semibold text-slate-100">{slot.label}</p>
                    {slot.signer ? (
                      <span className="text-[11px] text-slate-500">signed {formatUnix(slot.signer.signedAt)}</span>
                    ) : (
                      <span className="text-[11px] text-amber-400">awaiting signature</span>
                    )}
                  </div>
                  {slot.signer ? (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                      {slot.signer.displayName && <span>{slot.signer.displayName}</span>}
                      <span className="inline-flex items-center gap-1">
                        <KeyRound className="h-3 w-3 text-slate-600" />
                        <MonoAddress value={slot.signer.publicKey} />
                      </span>
                    </div>
                  ) : slot.role === 'AGENT' ? (
                    <p className="mt-1 text-xs text-slate-500">
                      The agent countersigns on its first gate request, proving it holds <span className="font-mono">{truncateAddress(m.mandate.agent.publicKey)}</span>.
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-lg border border-white/[0.06] bg-black/20 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <ShieldCheck className={`h-4 w-4 ${m.verification.valid ? 'text-emerald-400' : 'text-amber-400'}`} />
              {m.verification.valid ? 'Chain verifies: every signature and link is valid' : 'Chain incomplete or invalid'}
            </div>
            {!m.verification.valid && m.verification.errors.length > 0 && (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-slate-500">
                {m.verification.errors.slice(0, 4).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Spend */}
        <Card className="space-y-4 p-5">
          <SectionLabel>Budget</SectionLabel>
          <SpendBar label={`Window · ${formatDuration(limits.windowSeconds)}`} used={m.spend.windowAutonomousBaseUnits} limit={limits.maxPerWindow} />
          <SpendBar label="Lifetime" used={m.spend.totalBaseUnits} limit={limits.maxTotal} />
          <dl className="grid grid-cols-2 gap-4 border-t border-white/[0.06] pt-4">
            <KeyValue label="Per payment">
              <span className="font-mono font-semibold">{formatToken(limits.maxPerPayment)}</span>
            </KeyValue>
            <KeyValue label="Ask human above">
              <span className="font-mono font-semibold text-amber-300">{formatToken(m.mandate.escalation.thresholdBaseUnits)}</span>
            </KeyValue>
            <KeyValue label="Valid from">{formatUnix(m.mandate.notBefore)}</KeyValue>
            <KeyValue label="Expires">{formatUnix(m.mandate.expiresAt)}</KeyValue>
          </dl>
        </Card>
      </div>

      {/* Scope */}
      <Card className="p-5">
        <SectionLabel>Scope</SectionLabel>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <p className="field-label">Allowed recipients</p>
            <ul className="space-y-1.5">
              {m.mandate.scope.allowedPayTo.map((a) => (
                <li key={a}>
                  <MonoAddress value={a} lead={8} trail={8} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="field-label">Allowed resources</p>
            <ul className="space-y-1.5">
              {m.mandate.scope.allowedResources.map((r) => (
                <li key={r} className="break-all font-mono text-xs text-slate-300">
                  {r}
                </li>
              ))}
            </ul>
            {m.mandate.escalation.resources.length > 0 && (
              <>
                <p className="field-label mt-4">Always needs a human</p>
                <ul className="space-y-1.5">
                  {m.mandate.escalation.resources.map((r) => (
                    <li key={r} className="break-all font-mono text-xs text-amber-300/90">
                      {r}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <p className="field-label">Asset (mint)</p>
            <MonoAddress value={limits.mint} lead={8} trail={8} />
          </div>
          <div>
            <p className="field-label">Network</p>
            <p className="font-mono text-xs text-slate-300">{m.mandate.scope.allowedNetworks.join(', ')}</p>
          </div>
        </div>
      </Card>

      {/* Decisions */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <SectionLabel>Recent decisions</SectionLabel>
          <Link href="/decisions" className="text-xs font-semibold text-solana-green hover:underline">
            Live feed
          </Link>
        </div>
        {!decisions || decisions.length === 0 ? (
          <p className="px-5 py-8 text-center text-xs text-slate-500">
            No payments attempted yet. Every allow, deny and escalation appears here with the rules that decided it.
          </p>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {decisions.map((d) => (
              <DecisionRow key={d.id} decision={d} />
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        title="Revoke this mandate?"
        description="The agent’s very next payment will be denied. This cannot be undone; issue a new mandate to restore access."
      >
        <label className="block">
          <span className="field-label">Reason (recorded in the audit ledger)</span>
          <input className="input-field" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Agent behaved unexpectedly" />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button className="btn-ghost" onClick={() => setRevokeOpen(false)}>
            Keep active
          </button>
          <button
            className="btn-danger"
            disabled={busy !== null}
            onClick={async () => {
              await run('revoke', () => api.post(`/v1/agent/mandates/${m.id}/revoke`, { reason: reason.trim() || undefined }), 'Mandate revoked');
              setRevokeOpen(false);
            }}
          >
            {busy === 'revoke' ? <Spinner /> : <Ban className="h-4 w-4" />}
            Revoke now
          </button>
        </div>
      </Modal>
    </div>
  );
}
