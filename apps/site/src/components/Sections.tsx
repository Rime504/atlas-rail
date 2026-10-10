import { ArrowUpRight, BadgeCheck, Building2, Code2, FileSignature, ShieldCheck, Store, UserCheck, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { CodeTabs } from './CodeTabs';
import {
  CONCURRENCY_REPORT,
  GITHUB,
  INTEGRATE,
  LIVE_RUNS_REPORT,
  PLAYGROUND,
  REDTEAM_REPORT,
  ROADMAP,
  SECURITY_LIMITS,
  THREAT_MODEL,
  VERIFY,
  WHY_NOW_SOURCE,
  X_URL,
} from '@/content';

export function SectionHeader({ eyebrow, title, intro, id }: { eyebrow: string; title: ReactNode; intro?: ReactNode; id?: string }) {
  return (
    <header className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="mt-4 text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-white sm:text-[44px]">
        {title}
      </h2>
      {intro && <p className="mt-5 text-[17px] leading-relaxed text-muted sm:text-[18px]">{intro}</p>}
    </header>
  );
}

function External({ href, children, className = 'link-quiet' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 ${className}`}>
      {children}
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

/* ---- Why now ------------------------------------------------------------------------------------ */

export function WhyNow() {
  return (
    <section aria-labelledby="why-now" className="section">
      <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <SectionHeader
          id="why-now"
          eyebrow="Why now"
          title="AI agents already pay on Solana."
          intro="An API answers 402 Payment Required and the agent pays. An agent can be tricked by a prompt injection or overcharged by a seller, and it pays anyway. Afterwards, nobody can prove what it was actually allowed to do."
        />
        <div className="card p-7 sm:p-9">
          <p className="accent-text text-[56px] font-semibold leading-none tracking-[-0.04em] sm:text-[72px]">23.2M</p>
          <p className="mt-4 text-[17px] leading-relaxed text-white">
            Solana handled 76% of x402 agent transactions in four weeks: 23.2M (
            <a href={WHY_NOW_SOURCE} target="_blank" rel="noreferrer" className="link-quiet">
              Artemis via Solana, Sept 2026
            </a>
            )
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---- How it works ------------------------------------------------------------------------------- */

const STEPS = [
  {
    n: '01',
    icon: FileSignature,
    title: 'Mandate',
    body: 'The owner, an independent approver and the agent itself each sign one document: which sellers, which resources, how much per payment, per hour and in total.',
  },
  {
    n: '02',
    icon: ShieldCheck,
    title: 'Gate',
    body: "Every payment is checked against the mandate, 15 rules, before the agent's wallet will sign it. The wallet refuses anything the gate did not approve, byte for byte.",
  },
  {
    n: '03',
    icon: BadgeCheck,
    title: 'Proof',
    body: 'Each allowed payment names its own receipt in its on-chain memo. Anyone can check, from the chain alone, who signed the mandate, the limits, the decision and the on-chain anchor.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="section">
      <SectionHeader id="how-title" eyebrow="How it works" title="Permission first. Proof always." />
      <ol className="mt-14 grid gap-4 md:grid-cols-3">
        {STEPS.map(({ n, icon: Icon, title, body }) => (
          <li key={n} className="card flex flex-col p-7">
            <div className="flex items-center justify-between">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-raised">
                <Icon className="h-5 w-5 text-mint" aria-hidden="true" />
              </span>
              <span className="font-mono text-[13px] text-faint">{n}</span>
            </div>
            <h3 className="mt-8 text-[22px] font-semibold tracking-[-0.02em] text-white">{title}</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ol>
      <div className="card mt-4 flex flex-col gap-4 p-7 sm:flex-row sm:items-center sm:gap-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-raised">
          <UserCheck className="h-5 w-5 text-violet" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-[18px] font-semibold text-white">Anything unusual goes to a human.</h3>
          <p className="mt-1 text-[15px] leading-relaxed text-muted">
            Above a threshold, or for chosen resources, a person must approve that exact payment.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---- Who it's for ------------------------------------------------------------------------------- */

const AUDIENCES = [
  { icon: Code2, title: 'Agent builders', body: 'who want their agent to pay for APIs without handing it a wallet it can drain.' },
  { icon: Wallet, title: 'Wallets and agent platforms', body: 'which want to offer users safe spending limits for their agents without building the security themselves.' },
  { icon: Store, title: 'Sellers and API providers', body: 'who want proof that a paying agent was actually allowed to pay.' },
];

export function WhoFor() {
  return (
    <section aria-labelledby="who-title" className="section">
      <SectionHeader id="who-title" eyebrow="Who it's for" title="Built for everyone on both sides of an agent payment." />
      <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
        {AUDIENCES.map(({ icon: Icon, title, body }) => (
          <li key={title} className="bg-panel p-7">
            <Icon className="h-5 w-5 text-mint" aria-hidden="true" />
            <h3 className="mt-6 text-[19px] font-semibold text-white">{title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- Developers --------------------------------------------------------------------------------- */

export function Developers() {
  return (
    <section id="developers" aria-labelledby="dev-title" className="section">
      <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <SectionHeader
            id="dev-title"
            eyebrow="Developers"
            title="One line around fetch."
            intro="Wrap your agent's fetch: x402 payments go through the gate first, and a refused payment is never signed. Or give an AI assistant one MCP tool, pay(url)."
          />
          <dl className="mt-10 space-y-5 text-[15px]">
            <div>
              <dt className="text-white">Install</dt>
              <dd className="mt-1 text-muted">From the repository today. The npm package is coming.</dd>
            </div>
            <div>
              <dt className="text-white">The key stays out of the agent</dt>
              <dd className="mt-1 text-muted">
                In the demo, the agent&apos;s key lives in a separate signer service the agent reaches only over HTTP. It signs only what the gate authorised.
              </dd>
            </div>
          </dl>
          <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-[15px]">
            <External href={INTEGRATE}>Integration guide</External>
            <External href={GITHUB}>Source on GitHub</External>
          </div>
        </div>
        <CodeTabs />
      </div>
    </section>
  );
}

/* ---- Proof, not promises ------------------------------------------------------------------------ */

export function Proof() {
  return (
    <section id="proof" aria-labelledby="proof-title" className="section">
      <SectionHeader
        id="proof-title"
        eyebrow="Proof, not promises"
        title="We attacked it ourselves."
        intro="Our red team assumes the agent is fully compromised on every attempt: it sends any offer, transaction or request the attacker wants, and always tries to sign."
      />
      <div className="mt-14 grid gap-4 md:grid-cols-3">
        <Stat value="52" label="attack types" />
        <Stat value="1,017" label="malicious attempts" />
        <Stat value="$0.00" label="moved outside the mandate" accent />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="card p-7">
          <p className="text-[15px] text-muted">100 simultaneous payments against a $5 budget, on the full gate service</p>
          <p className="mt-3 text-[32px] font-semibold tracking-[-0.03em] text-white">
            $5.00 <span className="text-[17px] font-normal text-faint">spent. With our lock removed: $10.00.</span>
          </p>
          <p className="mt-4 text-[14px]">
            <External href={CONCURRENCY_REPORT}>Concurrency report</External>
          </p>
        </div>
        <div className="card p-7">
          <p className="text-[15px] text-muted">Pay, then verify from the chain, on real devnet</p>
          <p className="mt-3 text-[32px] font-semibold tracking-[-0.03em] text-white">
            PROVEN <span className="text-[17px] font-normal text-faint">3 of 3 runs.</span>
          </p>
          <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
            <External href={LIVE_RUNS_REPORT}>Run report</External>
            <External href={VERIFY}>Verify one yourself</External>
          </p>
        </div>
      </div>
      <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-[15px]">
        <External href={REDTEAM_REPORT}>Red-team report</External>
        <External href={THREAT_MODEL}>Threat model</External>
      </div>
      <p className="mt-10 max-w-3xl border-l-2 border-violet/60 pl-5 text-[15px] leading-relaxed text-muted">
        <span className="text-white">Honest limits.</span> Devnet only, unaudited. The server refuses mainnet RPC endpoints; nothing here has had an external security
        audit. <External href={SECURITY_LIMITS}>All limits</External>
      </p>
    </section>
  );
}

function Stat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="card p-7">
      <p className={`text-[48px] font-semibold leading-none tracking-[-0.04em] sm:text-[56px] ${accent ? 'accent-text' : 'text-white'}`}>{value}</p>
      <p className="mt-3 text-[15px] text-muted">{label}</p>
    </div>
  );
}

/* ---- Pricing (planned) -------------------------------------------------------------------------- */

const PLANS = [
  {
    icon: BadgeCheck,
    name: 'Open standard and verifier',
    price: 'Free',
    body: 'Anyone can read the mandate format and check any receipt. Adoption comes first.',
    cta: { label: 'Read the code', href: GITHUB },
  },
  {
    icon: ShieldCheck,
    name: 'Hosted gate',
    price: 'Usage-based · coming',
    body: "For teams that don't want to run the gate themselves.",
    cta: { label: 'Try the gate live', href: PLAYGROUND },
  },
  {
    icon: Building2,
    name: 'Platforms',
    price: 'Licensing · contact us',
    body: 'For wallets and agent platforms that will embed the gate in their own product.',
    cta: { label: 'Contact us', href: X_URL },
  },
];

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="section">
      <SectionHeader id="pricing-title" eyebrow="Pricing · planned" title="Free to verify. Pay to run it at scale." intro="These are plans: nothing here is for sale today." />
      <ul className="mt-14 grid gap-4 md:grid-cols-3">
        {PLANS.map(({ icon: Icon, name, price, body, cta }) => (
          <li key={name} className="card flex flex-col p-7">
            <Icon className="h-5 w-5 text-mint" aria-hidden="true" />
            <h3 className="mt-6 text-[19px] font-semibold text-white">{name}</h3>
            <p className="mt-1 text-[15px] text-violet-text">{price}</p>
            <p className="mt-4 flex-1 text-[15px] leading-relaxed text-muted">{body}</p>
            <p className="mt-6 text-[14px]">
              <External href={cta.href}>{cta.label}</External>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- Shipping next ---------------------------------------------------------------------------- */

const SHIPPING_NEXT = ['A spending cap Solana itself enforces', 'External security audit', 'Mainnet, with our first design partners'];

export function ShippingNext() {
  return (
    <section aria-labelledby="next-title" className="mx-auto max-w-page px-5 py-16 sm:px-8 sm:py-20">
      <div className="card p-7 sm:p-9">
        <h2 id="next-title" className="eyebrow">
          Shipping next · planned
        </h2>
        <ul className="mt-6 grid gap-3 md:grid-cols-3">
          {SHIPPING_NEXT.map((item) => (
            <li key={item} className="flex items-center gap-3 rounded-xl border border-line bg-raised px-5 py-4 text-[16px] font-medium text-white">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mint" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[14px]">
          <a href={ROADMAP} target="_blank" rel="noreferrer" className="link-quiet">
            Full roadmap →
          </a>
        </p>
      </div>
    </section>
  );
}

/* ---- Team --------------------------------------------------------------------------------------- */

const TEAM = [
  { name: 'Rime Khatib', role: 'Co-founder, lead engineer' },
  { name: 'Kamelia', role: 'Co-founder: original idea, product and go-to-market' },
  { name: 'Divyesh', role: 'On-chain engineer' },
];

export function Team() {
  return (
    <section aria-labelledby="team-title" className="section">
      <SectionHeader id="team-title" eyebrow="Team" title="The people behind it." />
      <ul className="mt-14 grid gap-4 md:grid-cols-3">
        {TEAM.map(({ name, role }) => (
          <li key={name} className="card p-7">
            <p className="text-[19px] font-semibold text-white">{name}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{role}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---- Closing call to action --------------------------------------------------------------------- */

export function ClosingCta() {
  return (
    <section aria-labelledby="cta-title" className="mx-auto max-w-page px-5 pb-24 sm:px-8">
      <div className="card relative overflow-hidden px-6 py-16 text-center sm:px-12">
        <div aria-hidden="true" className="absolute inset-x-0 -top-px mx-auto h-px max-w-md bg-accent opacity-70" />
        <h2 id="cta-title" className="mx-auto max-w-xl text-[30px] font-semibold leading-tight tracking-[-0.03em] text-white sm:text-[40px]">
          See a payment prove itself.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-[17px] text-muted">The real gate rules and receipt code, live on Solana devnet.</p>
        <p className="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-faint">The hosted playground runs the real gate rules with per-session state. The full gate service (Postgres ledger, reservations, per-mandate lock, separate signer) runs with pnpm demo; that&rsquo;s where the concurrency proof comes from.</p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={PLAYGROUND} target="_blank" rel="noreferrer" className="btn-primary w-full sm:w-auto">
            Try it live
          </a>
          <a href={VERIFY} target="_blank" rel="noreferrer" className="btn-secondary w-full sm:w-auto">
            Verify a payment
          </a>
        </div>
      </div>
    </section>
  );
}
