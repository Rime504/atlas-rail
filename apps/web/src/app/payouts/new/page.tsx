'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, AlertTriangle, Send, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { parseDisplayToBaseUnits } from '@atlas-rail/domain';
import { useApi } from '../../../lib/hooks';
import { api, ApiError } from '../../../lib/api';
import { useToast } from '../../../components/Toast';
import { Card, PageHeader, StatusBadge } from '../../../components/ui';
import { formatUsdc } from '../../../lib/format';
import type { Payout, PolicyEvaluationOutput, Recipient, Treasury } from '../../../lib/types';

export default function CreatePayoutPage() {
  const router = useRouter();
  const toast = useToast();
  const { data: treasuries, loading: treasuriesLoading } = useApi<Treasury[]>('/v1/treasuries');
  const { data: recipients, loading: recipientsLoading } = useApi<Recipient[]>('/v1/recipients');

  const [treasuryId, setTreasuryId] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('500.00');
  const [invoice, setInvoice] = useState('');
  const [memo, setMemo] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [evaluation, setEvaluation] = useState<PolicyEvaluationOutput | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);

  useEffect(() => {
    setIdempotencyKey(
      `idem-${typeof window !== 'undefined' ? window.crypto.randomUUID() : Date.now()}`,
    );
  }, []);

  useEffect(() => {
    if (treasuries && treasuries.length > 0 && !treasuryId) setTreasuryId(treasuries[0].id);
  }, [treasuries, treasuryId]);

  useEffect(() => {
    if (recipients && recipients.length > 0 && !recipientId) {
      const verified = recipients.find((r) => r.status === 'VERIFIED');
      setRecipientId((verified || recipients[0]).id);
    }
  }, [recipients, recipientId]);

  const treasury = treasuries?.find((t) => t.id === treasuryId);
  const recipient = recipients?.find((r) => r.id === recipientId);

  const amountBaseUnits = useMemo(() => {
    if (!amount) return null;
    try {
      return parseDisplayToBaseUnits(amount, 6);
    } catch {
      return null;
    }
  }, [amount]);

  useEffect(() => {
    setAmountError(
      amount && !amountBaseUnits ? 'Enter a valid decimal amount (up to 6 decimal places).' : null,
    );
  }, [amount, amountBaseUnits]);

  useEffect(() => {
    if (!treasury || !recipient || !amountBaseUnits) {
      setEvaluation(null);
      return;
    }
    let cancelled = false;
    setEvaluating(true);
    const timer = window.setTimeout(() => {
      api
        .post<PolicyEvaluationOutput>('/v1/policies/evaluate', {
          treasuryId: treasury.id,
          recipientId: recipient.id,
          amountBaseUnits,
          mintAddress: treasury.mintAddress,
          memo,
        })
        .then((res) => {
          if (!cancelled) setEvaluation(res);
        })
        .catch((err) => {
          if (!cancelled) {
            setEvaluation(null);
            if (err instanceof ApiError && err.status !== 0) {
              // A 404 usually just means the treasury has no active policy yet — surfaced inline below.
            }
          }
        })
        .finally(() => {
          if (!cancelled) setEvaluating(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treasury?.id, recipient?.id, amountBaseUnits, memo]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!treasury || !recipient || !amountBaseUnits) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payout = await api.post<Payout>(
        '/v1/payouts',
        {
          treasuryId: treasury.id,
          recipientId: recipient.id,
          amountBaseUnits,
          invoiceReference: invoice || undefined,
          memo: memo || undefined,
        },
        { 'idempotency-key': idempotencyKey },
      );
      toast.success(
        'Payout drafted',
        `${formatUsdc(payout.amountBaseUnits)} USDC to ${recipient.displayName}.`,
      );
      router.push(`/payouts/${payout.id}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : 'Something went wrong creating this payout.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const loading = treasuriesLoading || recipientsLoading;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Draft New USDC Payout Request"
        description="Specify payment details and preview live spend policy evaluation before submission."
      />

      {loading ? (
        <Card className="h-96 p-6">
          <div className="skeleton h-full w-full" />
        </Card>
      ) : !treasuries || treasuries.length === 0 ? (
        <Card>
          <div className="p-10 text-center text-sm text-slate-400">
            No treasuries are registered yet.{' '}
            <a href="/treasuries" className="text-solana-green hover:underline">
              Create one first.
            </a>
          </div>
        </Card>
      ) : !recipients || recipients.length === 0 ? (
        <Card>
          <div className="p-10 text-center text-sm text-slate-400">
            No recipients are registered yet.{' '}
            <a href="/recipients" className="text-solana-green hover:underline">
              Add one first.
            </a>
          </div>
        </Card>
      ) : (
        <form onSubmit={handleCreate}>
          <Card className="space-y-6 p-6">
            <div className="space-y-4">
              <div>
                <label className="field-label">Treasury</label>
                <select
                  value={treasuryId}
                  onChange={(e) => setTreasuryId(e.target.value)}
                  className="input-field"
                >
                  {treasuries.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.status})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="field-label">Recipient</label>
                <select
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value)}
                  className="input-field"
                >
                  {recipients.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName} — {r.status} ({r.walletAddress.slice(0, 6)}…
                      {r.walletAddress.slice(-6)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="field-label">Amount ({treasury?.assetSymbol || 'USDC'})</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="input-field font-mono"
                    placeholder="100.00"
                  />
                  {amountError && <p className="mt-1 text-xs text-rose-400">{amountError}</p>}
                </div>
                <div>
                  <label className="field-label">Invoice Reference</label>
                  <input
                    value={invoice}
                    onChange={(e) => setInvoice(e.target.value)}
                    className="input-field font-mono"
                    placeholder="INV-2026-0901"
                  />
                </div>
              </div>

              <div>
                <label className="field-label">Memo / Purpose (Optional)</label>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="input-field"
                  placeholder="Q3 Software License Fee"
                />
              </div>

              <div>
                <label className="field-label">Idempotency Key (guarantees non-duplication)</label>
                <input
                  value={idempotencyKey}
                  onChange={(e) => setIdempotencyKey(e.target.value)}
                  className="input-field font-mono text-xs text-slate-400"
                />
              </div>
            </div>

            <PolicyPreview
              evaluating={evaluating}
              evaluation={evaluation}
              recipient={recipient}
              amount={amount}
              assetSymbol={treasury?.assetSymbol}
            />

            {submitError && (
              <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-300">
                {submitError}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] pt-4">
              <button type="button" onClick={() => router.push('/payouts')} className="btn-ghost">
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  submitting ||
                  !!amountError ||
                  !amountBaseUnits ||
                  evaluation?.decision === 'BLOCK'
                }
                className="btn-gradient"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Submit Payout for Approval
              </button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}

function PolicyPreview({
  evaluating,
  evaluation,
  recipient,
  amount,
  assetSymbol,
}: {
  evaluating: boolean;
  evaluation: PolicyEvaluationOutput | null;
  recipient?: Recipient;
  amount: string;
  assetSymbol?: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-solana-purple/25 bg-solana-purple/5 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center text-xs font-bold uppercase text-solana-purple">
          <ShieldCheck className="mr-1.5 h-4 w-4" />
          Policy Engine Evaluation Preview
        </span>
        {evaluating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
        ) : evaluation ? (
          <StatusBadge status={evaluation.decision} />
        ) : (
          <span className="text-[11px] text-slate-600">Waiting for input…</span>
        )}
      </div>

      <div className="space-y-1.5 text-xs text-slate-300">
        <PreviewLine
          ok={recipient?.status === 'VERIFIED'}
          label={`Recipient status is ${recipient?.status || '—'}`}
        />
        <PreviewLine
          ok={!!amount && Number(amount) > 0}
          label={`Amount (${amount || '0'} ${assetSymbol || 'USDC'}) is a valid positive value`}
        />
        {evaluation?.reasons?.map((reason, i) => (
          <PreviewLine
            key={`${reason.code}-${i}`}
            ok={reason.severity !== 'BLOCK'}
            label={reason.message}
          />
        ))}
        {evaluation?.requiredApprovals !== undefined && (
          <PreviewLine
            ok={evaluation.decision !== 'BLOCK'}
            label={`Requires ${evaluation.requiredApprovals} independent approval${evaluation.requiredApprovals === 1 ? '' : 's'} before execution`}
          />
        )}
      </div>
    </div>
  );
}

function PreviewLine({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : ok === false ? XCircle : AlertTriangle;
  return (
    <div className={`flex items-center ${ok ? 'text-emerald-400' : 'text-amber-400'}`}>
      <Icon className="mr-1.5 h-3.5 w-3.5 shrink-0" />
      <span className="text-slate-300">{label}</span>
    </div>
  );
}
