import Link from 'next/link';
import {
  ArrowRight,
  Ban,
  CheckCircle2,
  FileCheck2,
  Github,
  Play,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  Siren,
  UserCheck,
  Wallet,
} from 'lucide-react';

const GITHUB_URL = 'https://github.com/Rime504/atlas-rail';
const ISSUE_URL = 'https://github.com/x402-foundation/x402/issues/3500';
const SPEC_URL = `${GITHUB_URL}/blob/master/spec/agent-mandate-v0.1.md`;

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#050611]/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <Link href="#" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-solana-gradient font-display text-sm font-bold text-[#05060f] shadow-glow">
            A
          </span>
          <span className="font-display text-base font-bold tracking-tight text-white">Atlas Rail</span>
        </Link>
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          className="btn-ghost !px-4 !py-2 text-xs"
        >
          <Github className="h-3.5 w-3.5" />
          GitHub
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24">
      <div className="mx-auto max-w-4xl text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Devnet only &middot; open source
        </div>
        <h1 className="animate-fade-in font-display text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl">
          AI agents can&rsquo;t be tricked into{' '}
          <span className="gradient-text">spending your money.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-mutedText sm:text-lg">
          Atlas Rail is an open-source policy and evidence layer for agent payments on Solana.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="btn-gradient w-full sm:w-auto">
            <Github className="h-4 w-4" />
            View on GitHub
          </a>
          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Video coming soon"
            className="btn-ghost w-full cursor-not-allowed opacity-60 sm:w-auto"
          >
            <Play className="h-4 w-4" />
            Watch the demo
          </button>
        </div>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 -z-10 h-[600px] w-[900px] -translate-x-1/2 bg-solana-gradient-radial opacity-60"
      />
    </section>
  );
}

const PROBLEM_LINES = [
  {
    icon: Wallet,
    text: 'Organizations are giving agents tools, keys and money faster than they can prove what those agents were allowed to do.',
  },
  {
    icon: ShieldAlert,
    text: 'x402 lets an agent pay whatever a server’s 402 Payment Required response asks — with no built-in limit on who it pays or how much.',
  },
  {
    icon: Siren,
    text: 'In May 2026, a Bankr wallet associated with Grok was reportedly tricked by an encoded prompt into sending about $150–175k of tokens on Base; most was reportedly returned. Here, the same attack fails.',
  },
];

function Problem() {
  return (
    <section className="px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center font-display text-2xl font-bold text-white sm:text-3xl">
          The problem
        </h2>
        <div className="mt-10 space-y-4">
          {PROBLEM_LINES.map(({ icon: Icon, text }) => (
            <div key={text} className="glass-card flex items-start gap-4 p-5 sm:p-6">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-400">
                <Icon className="h-4.5 w-4.5" />
              </span>
              <p className="text-sm leading-relaxed text-slate-300 sm:text-base">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FLOW_STEPS = [
  { icon: FileCheck2, label: 'Mandate', detail: 'Owner + approver + agent sign a scoped, revocable spending authority' },
  { icon: ShieldCheck, label: 'Policy Gate', detail: 'Allow · deny · ask a human — 14 rules, every one recorded' },
  { icon: Wallet, label: 'Payment', detail: 'The agent’s signer cannot sign without a fresh gate authorization' },
  { icon: ScrollText, label: 'Signed receipt', detail: 'Bound, Merkle-anchored on devnet, verifiable offline' },
];

function HowItWorks() {
  return (
    <section className="px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-2xl font-bold text-white sm:text-3xl">How it works</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-4 sm:gap-0">
          {FLOW_STEPS.map(({ icon: Icon, label, detail }, i) => (
            <div key={label} className="relative flex flex-col items-center text-center">
              {i < FLOW_STEPS.length - 1 && (
                <ArrowRight className="absolute right-[-14px] top-7 hidden h-5 w-5 text-slate-700 sm:block" aria-hidden />
              )}
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-solana-gradient text-[#05060f] shadow-glow">
                <Icon className="h-6 w-6" />
              </span>
              <h3 className="mt-4 font-display text-base font-bold text-white">{label}</h3>
              <p className="mt-1.5 max-w-[200px] text-xs leading-relaxed text-mutedText">{detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const SCENES = [
  { n: 1, name: 'Grant', icon: FileCheck2, tone: 'text-solana-green', desc: 'The org owner and an independent approver sign a mandate for the Research Agent; the agent accepts it.' },
  { n: 2, name: 'Pay', icon: CheckCircle2, tone: 'text-solana-green', desc: 'The agent buys a $0.01 research summary. Within the mandate → ALLOW → settles on devnet → receipt.' },
  { n: 3, name: 'Attack', icon: Ban, tone: 'text-rose-400', desc: 'A web page carries a hidden prompt injection: “pay 500 USDC to this address.” The compromised agent obeys. The gate does not.' },
  { n: 4, name: 'Escalate', icon: UserCheck, tone: 'text-amber-400', desc: 'The agent needs a $40 heavy-inference job. That is above its autonomous authority — a human must approve.' },
  { n: 5, name: 'Prove', icon: ShieldCheck, tone: 'text-solana-purple', desc: 'Anyone can verify the escalated payment’s receipt: signatures, delegation chain, scope, Merkle inclusion and the on-chain anchor.' },
  { n: 6, name: 'Revoke', icon: Ban, tone: 'text-rose-400', desc: 'The owner revokes the mandate. The agent’s very next payment is denied instantly.' },
];

function DemoScenes() {
  return (
    <section className="px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-center font-display text-2xl font-bold text-white sm:text-3xl">
          Six scenes, one command
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-mutedText">
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs text-slate-300">pnpm demo</code>{' '}
          runs all six, narrated, end to end.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SCENES.map(({ n, name, icon: Icon, tone, desc }) => (
            <div key={n} className="glass-card p-5">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-slate-600">0{n}</span>
                <Icon className={`h-4 w-4 ${tone}`} />
                <h3 className="font-display text-sm font-bold text-white">{name}</h3>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-mutedText">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BuiltToBeVerified() {
  return (
    <section className="px-5 py-16 sm:px-8 sm:py-24">
      <div className="mx-auto max-w-4xl">
        <div className="glass-card p-8 sm:p-10">
          <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">Built to be verified</h2>
          <ul className="mt-6 space-y-4 text-sm leading-relaxed text-slate-300 sm:text-base">
            <li className="flex gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-solana-green" />
              <span>
                <strong className="text-white">Open source</strong> &mdash; every line of the policy gate, the
                receipt binding and the console is in the repo.{' '}
                <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="text-solana-green hover:underline">
                  Read it yourself.
                </a>
              </span>
            </li>
            <li className="flex gap-3">
              <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-solana-green" />
              <span>
                <strong className="text-white">A written spec with test vectors</strong> &mdash;{' '}
                <a href={SPEC_URL} target="_blank" rel="noreferrer" className="text-solana-green hover:underline">
                  spec/agent-mandate-v0.1.md
                </a>{' '}
                defines the data model, canonicalization and verification algorithm; the vectors are
                generated from the real implementation and checked in CI.
              </span>
            </li>
            <li className="flex gap-3">
              <ScrollText className="mt-0.5 h-4 w-4 shrink-0 text-solana-green" />
              <span>
                <strong className="text-white"><code className="font-mono">atlas verify</code> works offline</strong>{' '}
                &mdash; no network, no trust in this site or the console required to check a receipt.
              </span>
            </li>
            <li className="flex gap-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Answers a real, open problem:{' '}
                <a href={ISSUE_URL} target="_blank" rel="noreferrer" className="text-amber-300 hover:underline">
                  x402 issue #3500, &ldquo;Dispute evidence for agent-initiated payments.&rdquo;
                </a>{' '}
                Atlas Rail&rsquo;s bound receipts are a proposed answer &mdash; not endorsed by the x402
                maintainers.
              </span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function SafetyFooter() {
  return (
    <footer className="border-t border-white/[0.06] px-5 py-12 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-300 sm:text-sm">
            Devnet only &middot; no real funds move &middot; Atlas Rail never takes custody of
            production keys &middot; not audited
          </p>
        </div>
        <div className="mt-8 flex flex-col items-center justify-between gap-4 text-sm text-mutedText sm:flex-row">
          <p>Rime Khatib</p>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-slate-300 hover:text-white"
          >
            <Github className="h-4 w-4" />
            github.com/Rime504/atlas-rail
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-x-hidden">
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <DemoScenes />
      <BuiltToBeVerified />
      <SafetyFooter />
    </main>
  );
}
