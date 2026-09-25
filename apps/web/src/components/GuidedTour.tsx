'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, FileCheck2, ScrollText, ShieldCheck, UserCheck, X } from 'lucide-react';
import { useAuth } from '../lib/auth-context';

const STEPS = [
  {
    icon: FileCheck2,
    title: '1. Mandate',
    body: 'The owner and an independent approver sign a spending authority for one agent key: a budget, which wallets it may pay, which resources it may buy, and an amount above which a human must be asked. Nothing is spendable until it’s signed.',
  },
  {
    icon: ShieldCheck,
    title: '2. Policy Gate',
    body: 'Every time the agent tries to pay, the gate checks the request against the mandate — not against what the agent “thinks” it’s allowed to do. It answers one of three ways: allow it, deny it, or ask a human.',
  },
  {
    icon: UserCheck,
    title: '3. Approval',
    body: 'When the gate asks a human, the request waits on the Approvals page — bound to that exact amount and recipient, usable once, and it expires on its own. Approve or deny from any device, including a phone.',
  },
  {
    icon: ScrollText,
    title: '4. Receipt',
    body: 'Every payment that goes through leaves a signed, tamper-evident receipt binding the mandate, the decision and the on-chain settlement together — verifiable offline, by anyone, without trusting this console.',
  },
] as const;

const STORAGE_PREFIX = 'atlas_tour_seen_';

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

/** True once this user has finished or skipped the tour on this browser. Never throws in a locked-down environment. */
function hasSeenTour(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) === '1';
  } catch {
    return true; // fail closed on storage errors: never nag a user we can't remember state for
  }
}

function markTourSeen(userId: string): void {
  try {
    window.localStorage.setItem(storageKey(userId), '1');
  } catch {
    // per-viewer convenience only; nothing to recover
  }
}

/**
 * First-time, four-step explainer for mandate -> gate -> approval -> receipt. Shown once per user
 * per browser (localStorage, not server state — it's a UI nicety, not something worth a migration).
 * Mount this once, high in the agent section of the app; it no-ops after the first dismissal.
 */
export function GuidedTour() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (!hasSeenTour(user.id)) setOpen(true);
  }, [user]);

  if (!open || !user) return null;

  const finish = () => {
    markTourSeen(user.id);
    setOpen(false);
  };

  const current = STEPS[step];
  const Icon = current.icon;
  const last = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={finish} />
      <div className="glass-card relative w-full max-w-md animate-fade-in bg-[#0b0d1c]/95 p-6 shadow-2xl">
        <button
          type="button"
          onClick={finish}
          className="absolute right-4 top-4 rounded-md p-1 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
          aria-label="Skip tour"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`h-1 flex-1 rounded-full transition-colors ${i <= step ? 'bg-solana-gradient' : 'bg-white/[0.08]'}`}
            />
          ))}
        </div>

        <div className="mt-6 flex h-12 w-12 items-center justify-center rounded-xl bg-solana-gradient text-[#05060f] shadow-glow">
          <Icon className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-display text-xl font-bold text-white">{current.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{current.body}</p>

        <div className="mt-8 flex items-center justify-between gap-3">
          <button type="button" onClick={finish} className="text-xs font-semibold text-slate-500 hover:text-slate-300">
            Skip
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button type="button" onClick={() => setStep((s) => s - 1)} className="btn-ghost !px-3 !py-2 text-xs">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? finish() : setStep((s) => s + 1))}
              className="btn-gradient !px-4 !py-2 text-xs"
            >
              {last ? (
                <>
                  <Bot className="h-3.5 w-3.5" /> Got it
                </>
              ) : (
                <>
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Restarts the tour on demand (a "Replay tour" link/help menu can call this). */
export function resetGuidedTour(userId: string): void {
  try {
    window.localStorage.removeItem(storageKey(userId));
  } catch {
    // best effort
  }
}
