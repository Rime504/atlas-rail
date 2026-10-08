'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { VerdictBanner } from '@/components/Verdict';
import { Details, ExplorerLink, MonoAddress } from '@/components/Details';
import { formatUsd } from '@/lib/format';
import { VERIFY_EXAMPLES } from '@/lib/verify-examples';

type Check = { id: string; title?: string; status?: 'PASS' | 'FAIL' | 'SKIP'; ok?: boolean; message: string };

interface PaymentResult {
  kind: 'payment';
  verdict: 'PROVEN' | 'INVALID' | 'NO_PROOF' | 'NOT_FOUND';
  txSignature: string;
  reason: string;
  receiptId?: string | null;
  receipt?: unknown;
  verification?: { checks: Check[] };
  facts?: {
    signers: Array<{ role: string; publicKey: string }>;
    limits: { maxPerPayment: string; maxTotal: string; windowBudget?: string };
    decision: { outcome: string; kind: string | null; failedRules: string[] };
    payment: { amount: string; payTo: string; payer: string | null };
    anchor: { mechanism: string; seq: number | null; txSignature: string } | null;
    mandateAtPaymentTime: { withinValidity: boolean; revoked: boolean | null };
    instanceKey: string;
  };
}

interface DecisionResult {
  kind: 'decision';
  verdict: 'BLOCKED' | 'INVALID' | 'NOT_FOUND';
  reason: string;
  checks?: Check[];
  facts?: { decisionId: string; failedRules: string[]; decisionReason: string; offer: { amount: string; payTo: string; resourceUrl: string }; instanceKey: string; signers: Array<{ role: string; publicKey: string }> } | null;
}

type Result = PaymentResult | DecisionResult;

const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

export function VerifyClient({ initialTx, initialDecision }: { initialTx: string | null; initialDecision: string | null }) {
  const [input, setInput] = useState(initialTx ?? '');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (query: { tx?: string; decision?: string }) => {
    setLoading(true);
    setError(null);
    setResult(null);
    const params = new URLSearchParams(query.decision ? { decision: query.decision } : { tx: query.tx ?? '' });
    window.history.replaceState(null, '', `/verify?${params}`);
    try {
      const res = await fetch(`/api/verify?${params}`);
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `Check failed (HTTP ${res.status})`);
      else setResult(body as Result);
    } catch {
      setError('Could not reach the verifier. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialDecision) void run({ decision: initialDecision });
    else if (initialTx) void run({ tx: initialTx });
  }, [initialDecision, initialTx, run]);

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm text-mutedText hover:text-white">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Atlas Rail
      </Link>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">Verify any payment</h1>
      <p className="mt-3 text-sm text-mutedText">
        Paste a Solana devnet transaction signature. We read its memo from the chain, fetch the receipt it names, and re-check everything:
        who signed the mandate, the limits, the decision, the on-chain anchor and the payment itself. You don&rsquo;t have to trust us; every
        check links to the chain.
      </p>

      <form
        className="mt-6 flex flex-col gap-3 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void run({ tx: input.trim() });
        }}
      >
        <label htmlFor="tx" className="sr-only">
          Transaction signature
        </label>
        <input
          id="tx"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Transaction signature"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3 font-mono text-sm text-white placeholder:text-mutedText focus:border-solana-purple focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          Verify
        </button>
      </form>

      <div className="mt-4">
        <p className="mb-2 text-xs uppercase tracking-wide text-mutedText">Or try a real example</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <ExampleButton label={VERIFY_EXAMPLES.proven.label} hint={VERIFY_EXAMPLES.proven.hint} onClick={() => { setInput(VERIFY_EXAMPLES.proven.tx); void run({ tx: VERIFY_EXAMPLES.proven.tx }); }} />
          <ExampleButton label={VERIFY_EXAMPLES.blocked.label} hint={VERIFY_EXAMPLES.blocked.hint} onClick={() => { setInput(''); void run({ decision: VERIFY_EXAMPLES.blocked.decision }); }} />
          <ExampleButton label={VERIFY_EXAMPLES.random.label} hint={VERIFY_EXAMPLES.random.hint} onClick={() => { setInput(VERIFY_EXAMPLES.random.tx); void run({ tx: VERIFY_EXAMPLES.random.tx }); }} />
        </div>
      </div>

      <section className="mt-8" aria-live="polite">
        {loading && (
          <p className="flex items-center gap-2 text-sm text-mutedText">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the chain…
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-deny/40 bg-deny/10 px-4 py-3 text-sm text-deny">
            {error}
          </div>
        )}
        {result && <ResultView result={result} />}
      </section>
    </main>
  );
}

function ExampleButton({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl border border-border bg-surface px-4 py-3 text-left transition hover:bg-surfaceRaised">
      <span className="block text-sm font-medium text-white">{label}</span>
      <span className="mt-1 block text-xs text-mutedText">{hint}</span>
    </button>
  );
}

function ResultView({ result }: { result: Result }) {
  return (
    <div data-testid="verify-result" data-verdict={result.verdict} className="space-y-4">
      {result.kind === 'payment' ? <PaymentView r={result} /> : <DecisionView r={result} />}
    </div>
  );
}

function PaymentView({ r }: { r: PaymentResult }) {
  if (r.verdict === 'NOT_FOUND') {
    return (
      <>
        <VerdictBanner verdict="ESCALATE" headline="Not found on devnet" />
        <p className="text-sm text-mutedText">{r.reason}</p>
      </>
    );
  }
  if (r.verdict === 'NO_PROOF') {
    return (
      <>
        <VerdictBanner verdict="DENY" headline="NO PROOF" />
        <p className="text-sm text-white/90">{r.reason}</p>
        <ExplorerLink url={explorer(r.txSignature)} />
      </>
    );
  }
  const f = r.facts!;
  return (
    <>
      <VerdictBanner verdict={r.verdict === 'PROVEN' ? 'ALLOW' : 'DENY'} headline={r.verdict === 'PROVEN' ? 'PROVEN: this payment was allowed' : 'INVALID'} />
      <p className="text-sm text-mutedText">{r.reason}</p>
      <dl className="divide-y divide-border rounded-2xl border border-border bg-surface text-sm">
        <Fact label="Mandate signed by">
          <ul className="space-y-1">
            {f.signers.map((s) => (
              <li key={s.role + s.publicKey} className="flex flex-wrap items-center gap-2">
                <span className="text-white/80">{s.role.toLowerCase()}</span>
                <MonoAddress value={s.publicKey} />
              </li>
            ))}
          </ul>
        </Fact>
        <Fact label="Limits">
          {formatUsd(f.limits.maxPerPayment)} per payment, {formatUsd(f.limits.maxTotal)} lifetime
        </Fact>
        <Fact label="Decision">
          {f.decision.outcome}
          {f.decision.kind === 'APPROVED' ? ', with human approval' : ''}
        </Fact>
        <Fact label="Payment">
          <span>
            {formatUsd(f.payment.amount)} to <MonoAddress value={f.payment.payTo} />
          </span>
          <div className="mt-1">
            <ExplorerLink url={explorer(r.txSignature)} />
          </div>
        </Fact>
        <Fact label="Anchored on-chain">
          {f.anchor ? (
            <>
              <span>
                {f.anchor.mechanism === 'root' ? `anchor_root, sequence ${f.anchor.seq}` : 'SPL Memo'}
              </span>
              <div className="mt-1">
                <ExplorerLink url={explorer(f.anchor.txSignature)} />
              </div>
            </>
          ) : (
            'not anchored'
          )}
        </Fact>
        <Fact label="Mandate when it paid">
          {f.mandateAtPaymentTime.withinValidity ? 'within its validity window' : 'outside its validity window'},{' '}
          {f.mandateAtPaymentTime.revoked === null ? 'revocation not checked' : f.mandateAtPaymentTime.revoked ? 'already revoked' : 'not revoked'}
        </Fact>
      </dl>
      <CheckList checks={r.verification?.checks ?? []} />
      <Details label="Show the raw receipt">
        <pre className="max-h-64 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] text-mutedText">{JSON.stringify(r.receipt, null, 2)}</pre>
      </Details>
    </>
  );
}

function DecisionView({ r }: { r: DecisionResult }) {
  if (r.verdict === 'NOT_FOUND' || !r.facts) {
    return (
      <>
        <VerdictBanner verdict="ESCALATE" headline="Not found" />
        <p className="text-sm text-mutedText">{r.reason}</p>
      </>
    );
  }
  const f = r.facts;
  return (
    <>
      <VerdictBanner verdict="DENY" headline={r.verdict === 'BLOCKED' ? 'BLOCKED: no payment was ever made' : 'INVALID'} />
      <p className="text-sm text-mutedText">{r.reason}</p>
      <dl className="divide-y divide-border rounded-2xl border border-border bg-surface text-sm">
        <Fact label="The agent tried to pay">
          {formatUsd(f.offer.amount)} to <MonoAddress value={f.offer.payTo} />
        </Fact>
        <Fact label="Rules that refused it">{f.failedRules.join(', ')}</Fact>
        <Fact label="Mandate signed by">{f.signers.map((s) => s.role.toLowerCase()).join(', ')}</Fact>
      </dl>
      <CheckList checks={r.checks ?? []} />
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 sm:flex sm:gap-4">
      <dt className="text-xs uppercase tracking-wide text-mutedText sm:w-40 sm:flex-shrink-0">{label}</dt>
      <dd className="mt-1 break-words text-white/90 sm:mt-0">{children}</dd>
    </div>
  );
}

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((check) => {
        const passed = check.status ? check.status === 'PASS' : check.ok;
        return (
          <li
            key={check.id}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${passed ? 'border-allow/30 bg-allow/5 text-allow' : 'border-deny/30 bg-deny/5 text-deny'}`}
          >
            <span className="flex-1 break-words">{check.title ?? check.message}</span>
            <span className="flex-shrink-0 text-xs font-medium">{passed ? 'PASS' : check.status ?? 'FAIL'}</span>
          </li>
        );
      })}
    </ul>
  );
}
