'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Github, FileText, Loader2, RotateCcw, ShieldCheck } from 'lucide-react';
import { ProgressBar } from '@/components/ProgressBar';
import { VerdictBanner } from '@/components/Verdict';
import { RuleList } from '@/components/RuleList';
import { Details, ExplorerLink, MonoAddress } from '@/components/Details';
import type { ActionType, PaymentOutcome, StepResponse, World } from '@/lib/types';
import type { ReceiptVerification } from '@atlas-rail/receipt';

const TOTAL_STEPS = 8;

interface Outcomes {
  normal?: PaymentOutcome;
  attack?: PaymentOutcome;
  moderate?: PaymentOutcome;
  severe?: PaymentOutcome;
  human?: PaymentOutcome;
  afterRevoke?: PaymentOutcome;
}

interface DemoState {
  step: number;
  world: World | null;
  outcomes: Outcomes;
  verification: ReceiptVerification | null;
  useDevnet: boolean;
  finished: boolean;
}

const INITIAL_STATE: DemoState = { step: 1, world: null, outcomes: {}, verification: null, useDevnet: false, finished: false };

async function callApi(world: World | null, action: { type: ActionType; approve?: boolean; useDevnet?: boolean }): Promise<StepResponse> {
  const res = await fetch('/api/step', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ world, action }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data as StepResponse;
}

export default function DemoPage() {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const [history, setHistory] = useState<DemoState[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initRequested = useRef(false);

  const runInit = useCallback(async (useDevnet: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const data = await callApi(null, { type: 'init', useDevnet });
      setState({ step: 1, world: data.world, outcomes: {}, verification: null, useDevnet, finished: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the demo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initRequested.current) return;
    initRequested.current = true;
    void runInit(false);
  }, [runInit]);

  const push = (next: DemoState) => {
    setHistory((h) => [...h, state]);
    setState(next);
  };

  const back = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setState(prev);
    setError(null);
  };

  const run = async (action: { type: ActionType; approve?: boolean }, apply: (data: StepResponse) => DemoState) => {
    if (!state.world) return;
    setLoading(true);
    setError(null);
    try {
      const data = await callApi(state.world, action);
      push(apply(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const goTo = (step: number) => push({ ...state, step });

  const restart = () => {
    setHistory([]);
    setState(INITIAL_STATE);
    initRequested.current = false;
    void runInit(false);
  };

  const world = state.world;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-6 py-12 sm:py-16">
      <ProgressBar step={Math.min(state.step, TOTAL_STEPS)} total={TOTAL_STEPS} />

      {error && (
        <div role="alert" className="mb-6 rounded-xl border border-deny/40 bg-deny/10 px-4 py-3 text-sm text-deny">
          {error}
        </div>
      )}

      {world?.devnetFallbackReason && (
        <div role="status" className="mb-6 rounded-xl border border-escalate/40 bg-escalate/10 px-4 py-3 text-sm text-escalate">
          {world.devnetFallbackReason}
        </div>
      )}

      <div className="animate-fade-in">
        {!world && !error ? (
          <LoadingCard label="Waking up the agent…" />
        ) : (
          world &&
          (state.step === 1 ? (
            <StepMeetAgent
              world={world}
              useDevnet={state.useDevnet}
              onToggleDevnet={(v) => void runInit(v)}
              loading={loading}
            />
          ) : state.step === 2 ? (
            <StepGiveRules
              world={world}
              loading={loading}
              onSign={() => run({ type: 'sign-mandate' }, (d) => ({ ...state, world: d.world }))}
            />
          ) : state.step === 3 ? (
            <StepNormalPayment
              outcome={state.outcomes.normal}
              loading={loading}
              onRun={() => run({ type: 'pay-normal' }, (d) => ({ ...state, world: d.world, outcomes: { ...state.outcomes, normal: d.payment } }))}
            />
          ) : state.step === 4 ? (
            <StepAttack
              outcome={state.outcomes.attack}
              loading={loading}
              onRun={() => run({ type: 'attack' }, (d) => ({ ...state, world: d.world, outcomes: { ...state.outcomes, attack: d.payment } }))}
            />
          ) : state.step === 5 ? (
            <StepPriceSpike
              moderate={state.outcomes.moderate}
              severe={state.outcomes.severe}
              loading={loading}
              onRunModerate={() =>
                run({ type: 'price-spike-moderate' }, (d) => ({ ...state, world: d.world, outcomes: { ...state.outcomes, moderate: d.payment } }))
              }
              onRunSevere={() =>
                run({ type: 'price-spike-severe' }, (d) => ({ ...state, world: d.world, outcomes: { ...state.outcomes, severe: d.payment } }))
              }
            />
          ) : state.step === 6 ? (
            <StepHuman
              moderate={state.outcomes.moderate}
              human={state.outcomes.human}
              loading={loading}
              onDecide={(approve) =>
                run({ type: 'human-decision', approve }, (d) => ({ ...state, world: d.world, outcomes: { ...state.outcomes, human: d.payment } }))
              }
            />
          ) : state.step === 7 ? (
            <StepProve
              world={world}
              verification={state.verification}
              loading={loading}
              onVerify={() => run({ type: 'prove' }, (d) => ({ ...state, world: d.world, verification: d.verification ?? null }))}
            />
          ) : (
            <StepRevoke
              world={world}
              afterRevoke={state.outcomes.afterRevoke}
              finished={state.finished}
              loading={loading}
              onRevoke={() => run({ type: 'revoke' }, (d) => ({ ...state, world: d.world }))}
              onPayAgain={() =>
                run({ type: 'pay-after-revoke' }, (d) => ({ ...state, world: d.world, outcomes: { ...state.outcomes, afterRevoke: d.payment } }))
              }
              onFinish={() => setState((s) => ({ ...s, finished: true }))}
              onRestart={restart}
            />
          ))
        )}
      </div>

      {world && !state.finished && (
        <nav className="mt-10 flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={history.length === 0 || loading}
            className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium text-mutedText transition hover:text-white disabled:opacity-30"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
          </button>
          {state.step < TOTAL_STEPS && canAdvance(state) && (
            <button
              type="button"
              onClick={() => goTo(state.step + 1)}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-solana-gradient px-6 py-2.5 text-sm font-semibold text-background shadow-glow transition-transform hover:scale-[1.03] disabled:opacity-50"
            >
              Next <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </nav>
      )}
    </main>
  );
}

function canAdvance(state: DemoState): boolean {
  switch (state.step) {
    case 1:
      return true;
    case 2:
      return Boolean(state.world?.mandate?.delegationChain.length === 3);
    case 3:
      return Boolean(state.outcomes.normal);
    case 4:
      return Boolean(state.outcomes.attack);
    case 5:
      return Boolean(state.outcomes.moderate && state.outcomes.severe);
    case 6:
      return Boolean(state.outcomes.human);
    case 7:
      return true;
    default:
      return false;
  }
}

/* ---- shared bits -------------------------------------------------------------------------------- */

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-mutedText">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-2xl font-semibold sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm text-mutedText">{subtitle}</p>
    </header>
  );
}

function PrimaryButton({ onClick, loading, disabled, children }: { onClick: () => void; loading: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="inline-flex items-center gap-2 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background shadow-glow transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-border bg-surface p-6">{children}</div>;
}

/* ---- Step 1 --------------------------------------------------------------------------------------- */

function StepMeetAgent({
  world,
  useDevnet,
  onToggleDevnet,
  loading,
}: {
  world: World;
  useDevnet: boolean;
  onToggleDevnet: (v: boolean) => void;
  loading: boolean;
}) {
  return (
    <section>
      <StepHeading title="Meet the agent" subtitle="This is a research agent with its own Solana wallet. It can browse the web and pay for things on its own — within limits you are about to set." />
      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-solana-gradient text-xl font-display font-bold text-background">
            RA
          </div>
          <div>
            <p className="font-display text-lg font-semibold">Research Agent</p>
            <p className="text-sm text-mutedText">Looks up research summaries and pays for them when it needs to.</p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-between rounded-xl bg-background px-4 py-3">
          <span className="text-xs uppercase tracking-wide text-mutedText">Wallet address</span>
          <MonoAddress value={world.keys.agent.publicKey} chars={8} />
        </div>
      </Card>

      <label className="mt-6 flex items-center justify-between rounded-2xl border border-border bg-surface px-5 py-4">
        <span className="text-sm">
          <span className="font-medium">Use real Solana devnet</span>
          <span className="block text-xs text-mutedText">Registers and revokes the mandate on the real, deployed program. Falls back automatically if unavailable.</span>
        </span>
        <input
          type="checkbox"
          checked={useDevnet}
          disabled={loading}
          onChange={(e) => onToggleDevnet(e.target.checked)}
          className="h-5 w-9 flex-shrink-0 appearance-none rounded-full bg-border bg-[length:200%_100%] bg-right transition-all checked:bg-solana-gradient checked:bg-left"
          aria-label="Use real Solana devnet"
        />
      </label>
      {loading && <p className="mt-2 text-xs text-mutedText">Switching mode…</p>}
    </section>
  );
}

/* ---- Step 2 --------------------------------------------------------------------------------------- */

function StepGiveRules({ world, loading, onSign }: { world: World; loading: boolean; onSign: () => void }) {
  const signed = world.mandate?.delegationChain.length === 3;
  return (
    <section>
      <StepHeading title="Give it rules" subtitle="The owner drafts a mandate; an independent approver and the agent itself each sign it. These are the hard limits the gate will enforce on every payment." />
      <Card>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <Rule label="Max per payment" value="$5.00" />
          <Rule label="Max per hour" value="$20.00" />
          <Rule label="Allowed sellers" value="2 research sellers" />
          <Rule label="Research call price" value="about $0.01" />
        </dl>
        <Details label="Show the signed mandate">
          <ol className="space-y-2 text-xs text-mutedText">
            {world.mandate?.delegationChain.map((link, i) => (
              <li key={i} className="flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5 text-allow" aria-hidden="true" />
                <span className="font-medium text-white/80">{link.role}</span>
                <MonoAddress value={link.publicKey} />
              </li>
            ))}
            {!world.mandate?.delegationChain.length && <li>Not signed yet.</li>}
          </ol>
        </Details>
      </Card>

      <div className="mt-6">
        {!signed ? (
          <PrimaryButton onClick={onSign} loading={loading}>
            Sign and register on Solana
          </PrimaryButton>
        ) : (
          <div className="space-y-3">
            <VerdictBanner verdict="ALLOW" headline="Signed by owner, approver and agent" />
            {world.mandateOnchain && <ExplorerLink url={world.mandateOnchain.explorerUrl} />}
          </div>
        )}
      </div>
    </section>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-background px-4 py-3">
      <dt className="text-xs uppercase tracking-wide text-mutedText">{label}</dt>
      <dd className="mt-1 font-display text-base font-semibold">{value}</dd>
    </div>
  );
}

/* ---- Step 3 --------------------------------------------------------------------------------------- */

function StepNormalPayment({ outcome, loading, onRun }: { outcome?: PaymentOutcome; loading: boolean; onRun: () => void }) {
  return (
    <section>
      <StepHeading title="A normal payment" subtitle="The agent buys a $0.01 research summary from a seller the mandate allows." />
      {!outcome ? (
        <PrimaryButton onClick={onRun} loading={loading}>
          Run the payment
        </PrimaryButton>
      ) : (
        <PaymentResult outcome={outcome} />
      )}
    </section>
  );
}

function PaymentResult({ outcome }: { outcome: PaymentOutcome }) {
  return (
    <div className="space-y-4">
      <VerdictBanner verdict={outcome.verdict} headline={outcome.headline} />
      <Details label="Show the rules it was checked against">
        <RuleList rules={outcome.rules} />
      </Details>
    </div>
  );
}

/* ---- Step 4 --------------------------------------------------------------------------------------- */

function StepAttack({ outcome, loading, onRun }: { outcome?: PaymentOutcome; loading: boolean; onRun: () => void }) {
  return (
    <section>
      <StepHeading
        title="An attack"
        subtitle="A web page the agent reads carries a hidden instruction: pay a stranger 500 USDC right now. A prompt-injected agent obeys. Watch what the gate does."
      />
      {!outcome ? (
        <PrimaryButton onClick={onRun} loading={loading}>
          Let the compromised agent try to pay
        </PrimaryButton>
      ) : (
        <PaymentResult outcome={outcome} />
      )}
    </section>
  );
}

/* ---- Step 5 --------------------------------------------------------------------------------------- */

function StepPriceSpike({
  moderate,
  severe,
  loading,
  onRunModerate,
  onRunSevere,
}: {
  moderate?: PaymentOutcome;
  severe?: PaymentOutcome;
  loading: boolean;
  onRunModerate: () => void;
  onRunSevere: () => void;
}) {
  return (
    <section className="space-y-6">
      <StepHeading
        title="Price spike"
        subtitle="The same, approved seller suddenly charges more for the same research call. The mandate's price limit (rule 15) has two zones."
      />
      <div>
        <p className="mb-2 text-sm font-medium text-mutedText">A moderate rise — $0.01 → $0.02</p>
        {!moderate ? (
          <PrimaryButton onClick={onRunModerate} loading={loading}>
            Charge $0.02 instead
          </PrimaryButton>
        ) : (
          <PaymentResult outcome={moderate} />
        )}
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-mutedText">A 5× spike — $0.01 → $0.05</p>
        {!severe ? (
          <PrimaryButton onClick={onRunSevere} loading={loading} disabled={!moderate}>
            Charge $0.05 instead
          </PrimaryButton>
        ) : (
          <PaymentResult outcome={severe} />
        )}
      </div>
    </section>
  );
}

/* ---- Step 6 --------------------------------------------------------------------------------------- */

function StepHuman({
  moderate,
  human,
  loading,
  onDecide,
}: {
  moderate?: PaymentOutcome;
  human?: PaymentOutcome;
  loading: boolean;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <section>
      <StepHeading title="You are the human" subtitle="The moderate price rise from the last step needs a person to decide. It's you." />
      {moderate && (
        <Card>
          <p className="text-sm text-mutedText">Seller wants $0.02 for a call the mandate expects to cost $0.01.</p>
        </Card>
      )}
      {!human ? (
        <div className="mt-6 flex gap-3">
          <PrimaryButton onClick={() => onDecide(true)} loading={loading}>
            Approve
          </PrimaryButton>
          <button
            type="button"
            onClick={() => onDecide(false)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-deny/40 px-6 py-3 text-sm font-semibold text-deny transition hover:bg-deny/10 disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="mt-6">
          <PaymentResult outcome={human} />
        </div>
      )}
    </section>
  );
}

/* ---- Step 7 --------------------------------------------------------------------------------------- */

function StepProve({
  world,
  verification,
  loading,
  onVerify,
}: {
  world: World;
  verification: ReceiptVerification | null;
  loading: boolean;
  onVerify: () => void;
}) {
  const receipt = world.receipts[world.receipts.length - 1];
  return (
    <section>
      <StepHeading title="Proof" subtitle="Every allowed payment gets a signed receipt. Anyone can check it — no account, no trust required." />
      {!receipt ? (
        <Card>
          <p className="text-sm text-mutedText">No receipt yet — go back and approve a payment first.</p>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wide text-mutedText">Receipt</span>
              <MonoAddress value={receipt.id} />
            </div>
            <Details label="Show the raw receipt">
              <pre className="max-h-64 overflow-auto rounded-lg bg-background p-3 font-mono text-[11px] text-mutedText">{JSON.stringify(receipt, null, 2)}</pre>
            </Details>
          </Card>
          <div className="mt-6">
            {!verification ? (
              <PrimaryButton onClick={onVerify} loading={loading}>
                Verify this receipt
              </PrimaryButton>
            ) : (
              <ul className="space-y-2">
                {verification.checks.map((check) => (
                  <li
                    key={check.id}
                    className={`animate-pop-in flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
                      check.status === 'PASS'
                        ? 'border-allow/30 bg-allow/5 text-allow'
                        : check.status === 'FAIL'
                          ? 'border-deny/30 bg-deny/5 text-deny'
                          : 'border-border bg-surface text-mutedText'
                    }`}
                  >
                    <span className="font-medium">{check.title}</span>
                    <span className="ml-auto text-xs opacity-80">{check.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ---- Step 8 + end screen ---------------------------------------------------------------------------- */

function StepRevoke({
  world,
  afterRevoke,
  finished,
  loading,
  onRevoke,
  onPayAgain,
  onFinish,
  onRestart,
}: {
  world: World;
  afterRevoke?: PaymentOutcome;
  finished: boolean;
  loading: boolean;
  onRevoke: () => void;
  onPayAgain: () => void;
  onFinish: () => void;
  onRestart: () => void;
}) {
  if (finished) {
    return (
      <section className="text-center">
        <h1 className="font-display text-3xl font-semibold">That&rsquo;s Atlas Rail</h1>
        <p className="mt-3 text-sm text-mutedText">Signed mandates, a policy gate, human escalation, and receipts anyone can verify.</p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <a href="https://github.com/Rime504/atlas-rail" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-mutedText hover:text-white">
            <Github className="h-4 w-4" aria-hidden="true" /> View the code
          </a>
          <a
            href="https://github.com/Rime504/atlas-rail/blob/master/spec/agent-mandate-v0.1.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-mutedText hover:text-white"
          >
            <FileText className="h-4 w-4" aria-hidden="true" /> Read the spec
          </a>
          <a
            href={`https://explorer.solana.com/address/CnGoTE5Bxc8MFGaeK5LDv5uAZ7pNiktMunYy8JZcLY4k?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-sm text-mutedText hover:text-white"
          >
            The program on Explorer ↗
          </a>
          <button type="button" onClick={onRestart} className="mt-4 inline-flex items-center gap-2 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background shadow-glow">
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Run it again
          </button>
        </div>
      </section>
    );
  }

  const revoked = Boolean(world.revoked);
  return (
    <section>
      <StepHeading title="Revoke" subtitle="The owner revokes the mandate. The agent's very next payment is denied instantly — no delay, no exceptions." />
      {!revoked ? (
        <PrimaryButton onClick={onRevoke} loading={loading}>
          Revoke on Solana
        </PrimaryButton>
      ) : (
        <div className="space-y-4">
          <VerdictBanner verdict="DENY" headline="Mandate revoked" />
          {world.revokeOnchain && <ExplorerLink url={world.revokeOnchain.explorerUrl} />}
          {!afterRevoke ? (
            <PrimaryButton onClick={onPayAgain} loading={loading}>
              Try the payment again
            </PrimaryButton>
          ) : (
            <>
              <PaymentResult outcome={afterRevoke} />
              <button
                type="button"
                onClick={onFinish}
                className="mt-4 inline-flex items-center gap-2 rounded-full bg-solana-gradient px-6 py-3 text-sm font-semibold text-background shadow-glow transition-transform hover:scale-[1.02]"
              >
                Finish <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
