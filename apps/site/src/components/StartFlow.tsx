'use client';

import { useState } from 'react';
import { ArrowUpRight, Check, Coins, Compass, Globe, KeyRound, Plug, Repeat } from 'lucide-react';
import { JOIN_FORM, PLAYGROUND, VERIFY } from '@/content';

type ChoiceId = 'apis' | 'per-call' | 'trade' | 'pay-tool' | 'keys' | 'exploring';

const CHOICES: Array<{ id: ChoiceId; icon: typeof Globe; label: string }> = [
  { id: 'apis', icon: Globe, label: 'Pay for APIs or data' },
  { id: 'per-call', icon: Repeat, label: 'Pay per call (many small payments)' },
  { id: 'trade', icon: Coins, label: 'Trade on-chain' },
  { id: 'pay-tool', icon: Plug, label: "Use Solana's pay tool" },
  { id: 'keys', icon: KeyRound, label: 'Hold a wallet, and I worry about keys or getting hacked' },
  { id: 'exploring', icon: Compass, label: 'Not built yet, just exploring' },
];

const ANSWERS: Record<ChoiceId, { status: 'today' | 'next' | null; text: string }> = {
  apis: {
    status: 'today',
    text: 'You set the rules once: which sellers, how much per payment, per day and in total. Every payment is checked before it’s signed and gets a receipt anyone can verify on Solana.',
  },
  'per-call': {
    status: 'today',
    text: 'Deposit once, pay per call through a payment channel. The check adds a few milliseconds, and every call stays within your limits.',
  },
  trade: {
    status: 'next',
    text: 'Rules for trading agents: max trade size, allowed tokens, allowed exchanges. Join as a design partner and we’ll build them with you.',
  },
  'pay-tool': {
    status: 'today',
    text: 'Atlas Rail plugs in as the spending authority that decides which payments go through, and leaves proof of every decision.',
  },
  keys: {
    status: null,
    text: 'Your agent’s app never holds the key. The key only signs payments your rules allow, so even if the app is hacked, spending stays within your limits.',
  },
  exploring: { status: null, text: '' },
};

export function StartFlow() {
  const [picked, setPicked] = useState<ChoiceId[]>([]);
  const toggle = (id: ChoiceId) => setPicked((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));
  const chosen = CHOICES.filter((c) => picked.includes(c.id));

  return (
    <>
      <fieldset>
        <legend className="sr-only">What do your AI agents do? Pick one or more.</legend>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CHOICES.map(({ id, icon: Icon, label }) => {
            const on = picked.includes(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(id)}
                  className={`flex min-h-[76px] w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left text-[16px] font-medium transition-colors sm:text-[17px] ${
                    on ? 'border-mint/60 bg-mint/[0.07] text-white' : 'border-line bg-panel text-white/90 hover:border-white/20'
                  }`}
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${on ? 'border-mint/50 bg-mint/10' : 'border-line bg-raised'}`}>
                    <Icon className={`h-5 w-5 ${on ? 'text-mint' : 'text-muted'}`} aria-hidden="true" />
                  </span>
                  <span className="flex-1">{label}</span>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${on ? 'border-mint bg-mint' : 'border-white/20'}`} aria-hidden="true">
                    {on && <Check className="h-4 w-4 text-ink" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div aria-live="polite">
        {chosen.length > 0 && (
          <section aria-labelledby="answers-title" className="mt-10">
            <h2 id="answers-title" className="eyebrow">
              What Atlas Rail does for you
            </h2>
            <ul className="mt-5 space-y-3">
              {chosen.map(({ id, label }) => {
                const answer = ANSWERS[id];
                return (
                  <li key={id} className="card p-6">
                    <p className="text-[15px] text-muted">{label}</p>
                    {answer.status && (
                      <p className={`mt-3 text-[13px] font-semibold uppercase tracking-[0.12em] ${answer.status === 'today' ? 'text-mint' : 'text-violet-text'}`}>
                        {answer.status === 'today' ? 'Works today' : 'Coming next'}
                      </p>
                    )}
                    {id === 'exploring' ? (
                      <p className="mt-2 text-[17px] leading-relaxed text-white">
                        Try the{' '}
                        <a href={PLAYGROUND} target="_blank" rel="noreferrer" className="link-quiet text-white">
                          playground
                        </a>{' '}
                        and{' '}
                        <a href={VERIFY} target="_blank" rel="noreferrer" className="link-quiet text-white">
                          verify a real payment from the chain
                        </a>
                        .
                      </p>
                    ) : (
                      <p className="mt-2 text-[17px] leading-relaxed text-white">{answer.text}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-5 text-[14px] text-faint">Runs on Solana devnet today. No real money, no external audit yet.</p>
          </section>
        )}
      </div>

      <section aria-labelledby="join-title" className="card mt-12 overflow-hidden">
        <div className="p-6 sm:p-8">
          <h2 id="join-title" className="text-[24px] font-semibold tracking-[-0.02em] text-white sm:text-[28px]">
            Join Atlas Rail
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Your name, email, Telegram or X, your project, and whether you want a 30-minute setup session. It takes one minute.
          </p>
          <a href={JOIN_FORM} target="_blank" rel="noreferrer" className="btn-accent mt-6 w-full sm:w-auto">
            Join Atlas Rail <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </section>
    </>
  );
}
