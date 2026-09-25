'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, ChevronRight, Plus } from 'lucide-react';
import { hasPermission } from '@atlas-rail/domain';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth-context';
import { Card, EmptyState, PageHeader, SkeletonRows, StatusBadge, MonoAddress } from '../../components/ui';
import { MandateWizard } from '../../components/agent/MandateWizard';
import { SpendBar } from '../../components/agent/Bits';
import { formatToken, formatDuration, formatUnix } from '../../lib/agent-format';
import type { MandateView } from '../../lib/agent-types';

export default function MandatesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: mandates, loading, error, refetch } = useApi<MandateView[]>('/v1/agent/mandates');
  const [wizardOpen, setWizardOpen] = useState(false);
  const canCreate = Boolean(user && hasPermission(user.role, 'mandate:create'));

  const sorted = [...(mandates ?? [])].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agent Mandates"
        description="Signed, revocable spending authority for autonomous agents. The policy gate checks every payment against these limits before a key ever signs."
        actions={
          canCreate && (
            <button className="btn-gradient" onClick={() => setWizardOpen(true)}>
              <Plus className="h-4 w-4" />
              New mandate
            </button>
          )
        }
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300" role="alert">
          {error}{' '}
          <button className="font-semibold underline" onClick={refetch}>
            Retry
          </button>
        </div>
      )}

      {loading && !mandates ? (
        <Card>
          <SkeletonRows rows={4} cols={4} />
        </Card>
      ) : sorted.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={Bot}
            title="No mandates yet"
            description="Draft a mandate to give an agent a budget, an allow-list and a human approval threshold."
            action={
              canCreate && (
                <button className="btn-gradient mt-2" onClick={() => setWizardOpen(true)}>
                  <Plus className="h-4 w-4" />
                  Draft your first mandate
                </button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((m) => {
            const limits = m.mandate.scope.limits;
            const signed = m.signers.length;
            return (
              <Link key={m.id} href={`/mandates/${m.id}`} className="group block focus:outline-none">
                <Card hover className="h-full space-y-4 p-5 group-focus-visible:border-solana-purple/60">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate font-display text-lg font-bold text-white">{m.mandate.agent.label}</h2>
                      <div className="mt-1">
                        <MonoAddress value={m.mandate.agent.publicKey} />
                      </div>
                    </div>
                    <StatusBadge status={m.status} />
                  </div>

                  <div className="space-y-3">
                    <SpendBar label={`Spent · ${formatDuration(limits.windowSeconds)} window`} used={m.spend.windowAutonomousBaseUnits} limit={limits.maxPerWindow} />
                    <SpendBar label="Spent · lifetime" used={m.spend.totalBaseUnits} limit={limits.maxTotal} />
                  </div>

                  <dl className="grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4 text-xs">
                    <div>
                      <dt className="text-slate-500">Per payment</dt>
                      <dd className="mt-0.5 font-mono font-semibold text-slate-200">{formatToken(limits.maxPerPayment)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Ask human &gt;</dt>
                      <dd className="mt-0.5 font-mono font-semibold text-amber-300">{formatToken(m.mandate.escalation.thresholdBaseUnits)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Signatures</dt>
                      <dd className="mt-0.5 font-semibold text-slate-200">
                        {signed} / {m.mandate.delegation.requiredApprovals + 2}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Expires {formatUnix(m.mandate.expiresAt)}</span>
                    <span className="flex items-center gap-0.5 font-semibold text-solana-green opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      Open <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <MandateWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={(m) => {
          setWizardOpen(false);
          router.push(`/mandates/${m.id}`);
        }}
      />
    </div>
  );
}
