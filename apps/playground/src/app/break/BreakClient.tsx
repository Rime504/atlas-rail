'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Zap } from 'lucide-react';
import { VerdictBanner } from '@/components/Verdict';
import { RuleList } from '@/components/RuleList';
import { Details, MonoAddress } from '@/components/Details';
import type { BreakAttack, BreakResult } from '@/lib/scenario';

const ATTACKS: Array<{ id: BreakAttack; title: string; story: string; amount: string; recipient: boolean }> = [
  { id: 'pay-stranger', title: 'Pay a stranger', story: 'A web page tells the agent to pay an invoice to an address it has never seen.', amount: '500', recipient: true },
  { id: 'overcharge', title: 'Overcharge', story: 'An allowed seller quietly charges far more than the price the owner signed.', amount: '0.05', recipient: false },
  { id: 'split', title: 'Split into small payments', story: `Break a big payment into ${10} smaller ones, each under the per-payment limit.`, amount: '5', recipient: true },
  { id: 'after-revoke', title: 'Pay after revoke', story: 'The owner has revoked the mandate. The agent tries one more payment anyway.', amount: '0.01', recipient: false },
];

export function BreakClient() {
  const [attack, setAttack] = useState<BreakAttack>('pay-stranger');
  const [amount, setAmount] = useState('500');
  const [recipient, setRecipient] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BreakResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = ATTACKS.find((a) => a.id === attack)!;

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/break', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ attack, amountUsd: amount, recipient: current.recipient && recipient.trim() ? recipient.trim() : undefined }),
      });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? 'Something went wrong');
      else setResult(body as BreakResult);
    } catch {
      setError('Could not reach the gate. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-mutedText hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Atlas Rail
      </Link>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Try to break it</h1>
      <p className="mt-3 text-sm text-mutedText">
        You control the agent completely. Pick an attack, change the amount or the recipient, and send it. The real Atlas Rail gate decides,
        against a fresh mandate: at most $5 per payment, $20 an hour, two approved sellers.
      </p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Attack">
        {ATTACKS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="radio"
            aria-checked={a.id === attack}
            onClick={() => {
              setAttack(a.id);
              setAmount(a.amount);
              setResult(null);
            }}
            className={`rounded-xl border px-4 py-3 text-left transition ${a.id === attack ? 'border-solana-purple bg-surfaceRaised' : 'border-border bg-surface hover:bg-surfaceRaised'}`}
          >
            <span className="block text-sm font-medium text-white">{a.title}</span>
            <span className="mt-1 block text-xs text-mutedText">{a.story}</span>
          </button>
        ))}
      </div>

      <form
        className="mt-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-mutedText">{attack === 'split' ? 'Each slice, in USD' : 'Amount, in USD'}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-3 font-mono text-sm text-white focus:border-solana-purple focus:outline-none"
          />
        </label>
        {current.recipient && (
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-mutedText">Recipient (optional: leave empty for the attacker&rsquo;s address)</span>
            <input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Any Solana address"
              spellCheck={false}
              className="mt-1 w-full rounded-xl border border-border bg-surface px-4 py-3 font-mono text-sm text-white placeholder:text-mutedText focus:border-solana-purple focus:outline-none"
            />
          </label>
        )}
        <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background shadow-glow disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Zap className="h-4 w-4" aria-hidden="true" />}
          Send the attack
        </button>
      </form>

      <section className="mt-8" aria-live="polite">
        {error && (
          <div role="alert" className="rounded-xl border border-deny/40 bg-deny/10 px-4 py-3 text-sm text-deny">
            {error}
          </div>
        )}
        {result && <BreakResultView result={result} />}
      </section>
    </main>
  );
}

function BreakResultView({ result }: { result: BreakResult }) {
  const first = result.attempts.find((a) => a.outcome.verdict !== 'ALLOW') ?? result.attempts[0];
  const allowedCount = result.attempts.filter((a) => a.outcome.verdict === 'ALLOW').length;
  return (
    <div data-testid="break-result" data-verdict={first.outcome.verdict} className="space-y-4">
      {result.attack === 'split' ? (
        <>
          <p className="text-sm text-white/90">
            {allowedCount === 0
              ? `None of the ${result.attempts.length} slices were inside the mandate; every one was stopped.`
              : `${allowedCount} of ${result.attempts.length} slices were inside the mandate (${result.allowedUsd}, within the ${result.mandate.maxPerHourUsd} an hour the owner signed for).${allowedCount < result.attempts.length ? ' Every slice after that was stopped.' : ''}`}
          </p>
          <ol className="space-y-1 text-sm">
            {result.attempts.map((a, i) => (
              <li key={a.decision.id} className="flex items-center gap-2">
                <span className="w-16 text-mutedText">Slice {i + 1}</span>
                <span className={a.outcome.verdict === 'ALLOW' ? 'text-allow' : a.outcome.verdict === 'ESCALATE' ? 'text-escalate' : 'text-deny'}>{a.outcome.headline}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <VerdictBanner verdict={first.outcome.verdict} headline={first.outcome.headline} />
      {first.outcome.verdict === 'ALLOW' && (
        <p className="text-sm text-mutedText">That payment is inside the mandate, so the gate allows it: an approved seller, within the limits. Try a different recipient or amount.</p>
      )}
      <RuleList rules={first.outcome.rules} />
      <Details label="Show the signed decision (the receipt for a refusal)">
        <div className="space-y-1 text-xs text-mutedText">
          <p>
            Decision <MonoAddress value={first.decision.id} /> signed by the gate&rsquo;s key <MonoAddress value={first.decision.signedBy} />
          </p>
          <p className="break-all font-mono text-[11px]">hash {first.decision.decisionHash}</p>
          <p className="break-all font-mono text-[11px]">signature {first.decision.signature}</p>
        </div>
      </Details>
      <p className="text-xs text-mutedText">
        Nothing here touches a chain: each attempt runs the real gate code against a throwaway mandate. To check a real devnet payment, use{' '}
        <Link href="/verify" className="text-solana-green hover:underline">
          Verify any payment
        </Link>
        .
      </p>
    </div>
  );
}
