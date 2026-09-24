'use client';

import React, { useEffect, useState } from 'react';
import { FileText, ShieldCheck, Plus, Loader2, Rocket } from 'lucide-react';
import { useApi } from '../../lib/hooks';
import { api, ApiError } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { useToast } from '../../components/Toast';
import { Card, PageHeader, StatusBadge, EmptyState, Modal } from '../../components/ui';
import { formatUsdc } from '../../lib/format';
import type { Policy, Treasury } from '../../lib/types';
import { hasPermission } from '@atlas-rail/domain';

const DEFAULT_RULES = `{
  "approval": { "requiredApprovals": 2, "preventCreatorApproval": true, "eligibleRoles": ["OWNER", "ADMIN", "APPROVER"] },
  "limits": {
    "maxSinglePayoutBaseUnits": "5000000000",
    "dailyLimitBaseUnits": "25000000000",
    "monthlyLimitBaseUnits": "100000000000"
  },
  "recipients": { "requireVerifiedRecipient": true },
  "transaction": { "requireSuccessfulSimulation": true, "blockUnknownProgramIds": true },
  "risk": { "blockHighRiskRecipients": true, "manualReviewAboveRiskLevel": "HIGH" }
}`;

export default function PoliciesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const { data: treasuries, loading: treasuriesLoading } = useApi<Treasury[]>('/v1/treasuries');
  const [selectedTreasuryId, setSelectedTreasuryId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (treasuries && treasuries.length > 0 && !selectedTreasuryId) {
      setSelectedTreasuryId(treasuries[0].id);
    }
  }, [treasuries, selectedTreasuryId]);

  const {
    data: policies,
    loading: policiesLoading,
    refetch,
  } = useApi<Policy[]>(selectedTreasuryId ? `/v1/treasuries/${selectedTreasuryId}/policies` : null);

  const canWrite = user && hasPermission(user.role, 'policy:write');
  const canActivate = user && hasPermission(user.role, 'policy:activate');
  const activePolicy = policies?.find((p) => p.status === 'ACTIVE');
  const selectedTreasury = treasuries?.find((t) => t.id === selectedTreasuryId);

  const activate = async (policy: Policy) => {
    setBusyId(policy.id);
    try {
      await api.post(`/v1/policies/${policy.id}/activate`);
      toast.success('Policy activated', `${policy.name} (v${policy.version}) is now enforced.`);
      refetch();
    } catch (err) {
      toast.error(
        'Could not activate policy',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Spend Policies & Governance"
        description="Programmable rules defining authorization thresholds, approval counts, and instruction allowlists."
        actions={
          canWrite &&
          selectedTreasuryId && (
            <button onClick={() => setCreateOpen(true)} className="btn-gradient">
              <Plus className="h-4 w-4" />
              Draft New Policy
            </button>
          )
        }
      />

      {treasuries && treasuries.length > 1 && (
        <div className="flex items-center gap-2">
          {treasuries.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTreasuryId(t.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                selectedTreasuryId === t.id
                  ? 'border-solana-purple/40 bg-solana-purple/10 text-white'
                  : 'border-white/[0.08] text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {treasuriesLoading || policiesLoading ? (
        <Card className="h-72 p-6">
          <div className="skeleton h-full w-full" />
        </Card>
      ) : !policies || policies.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="No policy configured"
            description="Draft a policy for this treasury before payouts can be created."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {activePolicy && (
            <Card className="p-6">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-solana-purple/15 text-solana-purple">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-display text-base font-bold text-white">
                      {activePolicy.name}
                    </h2>
                    <span className="font-mono text-[11px] text-slate-500">
                      version {activePolicy.version}
                    </span>
                  </div>
                </div>
                <StatusBadge status="ACTIVE" />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 pt-2 md:grid-cols-3">
                <RuleStat
                  label="Required Approvals"
                  value={`${activePolicy.rules?.approval?.requiredApprovals ?? '—'} Approvers`}
                  sub={
                    activePolicy.rules?.approval?.preventCreatorApproval
                      ? 'Creator approval prohibited'
                      : undefined
                  }
                />
                <RuleStat
                  label="Single Payout Max"
                  value={
                    activePolicy.rules?.limits?.maxSinglePayoutBaseUnits
                      ? `${formatUsdc(activePolicy.rules.limits.maxSinglePayoutBaseUnits)} ${selectedTreasury?.assetSymbol || 'USDC'}`
                      : '—'
                  }
                />
                <RuleStat
                  label="Simulation"
                  value={
                    activePolicy.rules?.transaction?.requireSuccessfulSimulation
                      ? 'Strict Allowlist'
                      : 'Not enforced'
                  }
                  accent={
                    activePolicy.rules?.transaction?.requireSuccessfulSimulation
                      ? 'green'
                      : undefined
                  }
                />
              </div>

              <div className="mt-5 border-t border-white/[0.06] pt-4">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Policy Configuration JSON
                </h3>
                <pre className="overflow-x-auto rounded-lg border border-white/[0.06] bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-[#c9a3ff]">
                  {JSON.stringify(activePolicy.rules, null, 2)}
                </pre>
              </div>
            </Card>
          )}

          {policies.filter((p) => p.status !== 'ACTIVE').length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-white/[0.06] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Other Versions
                </h3>
              </div>
              <div className="divide-y divide-white/5">
                {policies
                  .filter((p) => p.status !== 'ACTIVE')
                  .map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-4">
                      <div>
                        <p className="text-sm font-medium text-slate-200">
                          {p.name}{' '}
                          <span className="font-mono text-xs text-slate-500">v{p.version}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={p.status} />
                        {canActivate && p.status === 'DRAFT' && (
                          <button
                            onClick={() => activate(p)}
                            disabled={busyId === p.id}
                            className="flex items-center gap-1.5 text-xs font-semibold text-solana-green hover:underline"
                          >
                            {busyId === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Rocket className="h-3.5 w-3.5" />
                            )}
                            Activate
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {selectedTreasuryId && (
        <CreatePolicyModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          treasuryId={selectedTreasuryId}
          nextVersion={(policies?.[0]?.version || 0) + 1}
          onCreated={refetch}
        />
      )}
    </div>
  );
}

function RuleStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green';
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
      <div className="text-[11px] font-semibold uppercase text-slate-500">{label}</div>
      <div
        className={`font-display mt-1 text-lg font-bold ${accent === 'green' ? 'text-solana-green' : 'text-white'}`}
      >
        {value}
      </div>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function CreatePolicyModal({
  open,
  onClose,
  treasuryId,
  nextVersion,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  treasuryId: string;
  nextVersion: number;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(`Treasury Policy v${nextVersion}`);
  const [rulesText, setRulesText] = useState(DEFAULT_RULES);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    let rules: unknown;
    try {
      rules = JSON.parse(rulesText);
    } catch {
      toast.error('Invalid JSON', 'Check the policy rules for a syntax error.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/v1/treasuries/${treasuryId}/policies`, { name, rules });
      toast.success(
        'Policy drafted',
        `${name} saved as DRAFT — activate it to enforce these rules.`,
      );
      onCreated();
      onClose();
    } catch (err) {
      toast.error(
        'Could not draft policy',
        err instanceof ApiError ? err.message : 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Draft New Policy"
      description="Saved as DRAFT until explicitly activated."
      maxWidth="max-w-2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="field-label">Policy Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input-field"
          />
        </div>
        <div>
          <label className="field-label">Rules (JSON)</label>
          <textarea
            required
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            rows={12}
            className="input-field resize-y font-mono text-[11px] leading-relaxed"
            spellCheck={false}
          />
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-solana-purple/20 bg-solana-purple/5 p-3 text-xs text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-solana-purple" />
          Every payout is evaluated deterministically against these rules before it can be approved
          or executed.
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-gradient">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Draft
          </button>
        </div>
      </form>
    </Modal>
  );
}
