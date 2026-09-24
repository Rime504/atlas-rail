'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Gauge, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useToast } from '../Toast';
import { Modal, Spinner } from '../ui';
import { decimalToBaseUnits } from '../../lib/agent-format';
import type { MandateView } from '../../lib/agent-types';
import type { Treasury } from '../../lib/types';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface FormState {
  label: string;
  agentPublicKey: string;
  mint: string;
  payTo: string;
  resources: string;
  maxPerPayment: string;
  maxPerWindow: string;
  windowHours: string;
  maxTotal: string;
  threshold: string;
  escalateResources: string;
  ttlDays: string;
  approvalMinutes: string;
}

const INITIAL: FormState = {
  label: '',
  agentPublicKey: '',
  mint: '',
  payTo: '',
  resources: '',
  maxPerPayment: '50',
  maxPerWindow: '100',
  windowHours: '24',
  maxTotal: '500',
  threshold: '5',
  escalateResources: '',
  ttlDays: '3',
  approvalMinutes: '15',
};

const STEPS = [
  { title: 'Agent & asset', icon: Bot },
  { title: 'Scope', icon: ShieldCheck },
  { title: 'Limits & escalation', icon: Gauge },
];

function lines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function validate(step: number, f: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 0) {
    if (!f.label.trim()) errors.label = 'Give the agent a name.';
    if (!BASE58.test(f.agentPublicKey.trim())) errors.agentPublicKey = 'Enter the agent’s Solana public key (base58).';
    if (!BASE58.test(f.mint.trim())) errors.mint = 'Enter the token mint address the agent may spend.';
  }
  if (step === 1) {
    const payTo = lines(f.payTo);
    if (payTo.length === 0) errors.payTo = 'Allow at least one recipient wallet.';
    else if (payTo.some((a) => !BASE58.test(a))) errors.payTo = 'Every recipient must be a valid base58 address.';
    const resources = lines(f.resources);
    if (resources.length === 0) errors.resources = 'Allow at least one resource URL pattern.';
    else if (resources.some((r) => !/^https?:\/\//.test(r))) errors.resources = 'Patterns must start with http:// or https://.';
  }
  if (step === 2) {
    const perPayment = decimalToBaseUnits(f.maxPerPayment);
    const perWindow = decimalToBaseUnits(f.maxPerWindow);
    const total = decimalToBaseUnits(f.maxTotal);
    const threshold = decimalToBaseUnits(f.threshold);
    if (!perPayment || perPayment === '0') errors.maxPerPayment = 'Enter an amount greater than zero (max 6 decimals).';
    if (!perWindow || perWindow === '0') errors.maxPerWindow = 'Enter an amount greater than zero.';
    if (!total || total === '0') errors.maxTotal = 'Enter an amount greater than zero.';
    if (!threshold) errors.threshold = 'Enter an amount (0 escalates every payment).';
    if (perPayment && perWindow && BigInt(perWindow) < BigInt(perPayment)) errors.maxPerWindow = 'Window budget cannot be below the per-payment ceiling.';
    if (perWindow && total && BigInt(total) < BigInt(perWindow)) errors.maxTotal = 'Lifetime budget cannot be below the window budget.';
    if (perPayment && threshold && BigInt(threshold) > BigInt(perPayment)) errors.threshold = 'Approval threshold cannot exceed the per-payment ceiling.';
    if (!/^\d+$/.test(f.windowHours) || Number(f.windowHours) < 1) errors.windowHours = 'Whole hours, at least 1.';
    if (!/^\d+$/.test(f.ttlDays) || Number(f.ttlDays) < 1) errors.ttlDays = 'Whole days, at least 1.';
    if (!/^\d+$/.test(f.approvalMinutes) || Number(f.approvalMinutes) < 1) errors.approvalMinutes = 'Whole minutes, at least 1.';
    const esc = lines(f.escalateResources);
    if (esc.some((r) => !/^https?:\/\//.test(r))) errors.escalateResources = 'Patterns must start with http:// or https://.';
  }
  return errors;
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-rose-400">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-slate-600">{hint}</span>
      ) : null}
    </label>
  );
}

export function MandateWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (mandate: MandateView) => void;
}) {
  const toast = useToast();
  const { data: treasuries } = useApi<Treasury[]>(open ? '/v1/treasuries' : null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setForm(INITIAL);
      setErrors({});
      setSubmitError(null);
    }
  }, [open]);

  useEffect(() => {
    if (treasuries && treasuries.length > 0) {
      setForm((f) => (f.mint ? f : { ...f, mint: treasuries[0].mintAddress }));
    }
  }, [treasuries]);

  const set = <K extends keyof FormState>(key: K, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key]) return e;
      const rest = { ...e };
      delete rest[key];
      return rest;
    });
  };

  const next = () => {
    const found = validate(step, form);
    setErrors(found);
    if (Object.keys(found).length === 0) setStep((s) => s + 1);
  };

  const submit = async () => {
    const found = validate(2, form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api.post<MandateView>('/v1/agent/mandates', {
        label: form.label.trim(),
        agentPublicKey: form.agentPublicKey.trim(),
        mint: form.mint.trim(),
        maxPerPayment: decimalToBaseUnits(form.maxPerPayment),
        maxPerWindow: decimalToBaseUnits(form.maxPerWindow),
        windowSeconds: Number(form.windowHours) * 3600,
        maxTotal: decimalToBaseUnits(form.maxTotal),
        allowedPayTo: lines(form.payTo),
        allowedResources: lines(form.resources),
        escalation: {
          thresholdBaseUnits: decimalToBaseUnits(form.threshold),
          resources: lines(form.escalateResources),
          approvalTtlSeconds: Number(form.approvalMinutes) * 60,
        },
        ttlSeconds: Number(form.ttlDays) * 86_400,
      });
      toast.success('Mandate drafted', 'Sign it as owner, then as approver, to activate.');
      onCreated(created);
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not create the mandate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New agent mandate"
      description="A mandate is a signed, revocable spending authority for one agent key. Nothing is spendable until it is signed."
      maxWidth="max-w-2xl"
    >
      <ol className="mb-6 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const state = i < step ? 'done' : i === step ? 'current' : 'todo';
          return (
            <li key={s.title} className="flex flex-1 items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
                  state === 'todo'
                    ? 'bg-white/[0.05] text-slate-600'
                    : 'bg-solana-gradient text-[#05060f] shadow-glow'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className={`hidden text-xs font-semibold sm:inline ${state === 'todo' ? 'text-slate-600' : 'text-slate-200'}`}>
                {s.title}
              </span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-white/[0.08]" />}
            </li>
          );
        })}
      </ol>

      <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
        {step === 0 && (
          <>
            <Field label="Agent name" error={errors.label}>
              <input className="input-field" value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Research agent" maxLength={120} />
            </Field>
            <Field label="Agent public key" error={errors.agentPublicKey} hint="The agent signs every gate request with this key. Atlas Rail never holds it.">
              <input className="input-field font-mono text-xs" value={form.agentPublicKey} onChange={(e) => set('agentPublicKey', e.target.value)} placeholder="Base58 Solana address" spellCheck={false} />
            </Field>
            <Field label="Token mint" error={errors.mint} hint="Devnet only. Defaults to your treasury asset.">
              <input className="input-field font-mono text-xs" value={form.mint} onChange={(e) => set('mint', e.target.value)} placeholder="Mint address" spellCheck={false} />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Field label="Allowed recipient wallets" error={errors.payTo} hint="One address per line. A payment to any other wallet is denied.">
              <textarea className="input-field min-h-[84px] font-mono text-xs" value={form.payTo} onChange={(e) => set('payTo', e.target.value)} placeholder="Base58 addresses, one per line" spellCheck={false} />
            </Field>
            <Field label="Allowed resources" error={errors.resources} hint="URL patterns, one per line. A trailing /* allows everything under that path, e.g. http://localhost:4402/research/*">
              <textarea className="input-field min-h-[84px] font-mono text-xs" value={form.resources} onChange={(e) => set('resources', e.target.value)} placeholder="https://api.example.com/research/*" spellCheck={false} />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Per payment (max)" error={errors.maxPerPayment}>
                <input className="input-field font-mono" inputMode="decimal" value={form.maxPerPayment} onChange={(e) => set('maxPerPayment', e.target.value)} />
              </Field>
              <Field label="Per window (max)" error={errors.maxPerWindow}>
                <input className="input-field font-mono" inputMode="decimal" value={form.maxPerWindow} onChange={(e) => set('maxPerWindow', e.target.value)} />
              </Field>
              <Field label="Lifetime (max)" error={errors.maxTotal}>
                <input className="input-field font-mono" inputMode="decimal" value={form.maxTotal} onChange={(e) => set('maxTotal', e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Window (hours)" error={errors.windowHours}>
                <input className="input-field font-mono" inputMode="numeric" value={form.windowHours} onChange={(e) => set('windowHours', e.target.value)} />
              </Field>
              <Field label="Valid for (days)" error={errors.ttlDays}>
                <input className="input-field font-mono" inputMode="numeric" value={form.ttlDays} onChange={(e) => set('ttlDays', e.target.value)} />
              </Field>
              <Field label="Approval expires (min)" error={errors.approvalMinutes}>
                <input className="input-field font-mono" inputMode="numeric" value={form.approvalMinutes} onChange={(e) => set('approvalMinutes', e.target.value)} />
              </Field>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Human-in-the-loop</p>
              <div className="mt-3 space-y-4">
                <Field label="Ask a human above" error={errors.threshold} hint="Any single payment above this amount pauses for approval.">
                  <input className="input-field font-mono" inputMode="decimal" value={form.threshold} onChange={(e) => set('threshold', e.target.value)} />
                </Field>
                <Field label="Always ask for these resources (optional)" error={errors.escalateResources}>
                  <textarea className="input-field min-h-[64px] font-mono text-xs" value={form.escalateResources} onChange={(e) => set('escalateResources', e.target.value)} placeholder="https://api.example.com/inference/*" spellCheck={false} />
                </Field>
              </div>
            </div>
          </>
        )}
      </div>

      {submitError && (
        <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">
          {submitError}
        </p>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button type="button" className="btn-ghost" onClick={step === 0 ? onClose : () => setStep((s) => s - 1)} disabled={submitting}>
          {step === 0 ? (
            'Cancel'
          ) : (
            <>
              <ArrowLeft className="h-4 w-4" /> Back
            </>
          )}
        </button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn-gradient" onClick={next}>
            Continue <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" className="btn-gradient" onClick={submit} disabled={submitting}>
            {submitting ? <Spinner /> : <ShieldCheck className="h-4 w-4" />}
            Draft mandate
          </button>
        )}
      </div>
    </Modal>
  );
}
