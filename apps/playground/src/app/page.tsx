import Link from 'next/link';
import { ArrowRight, FileText, Github, Globe, Search, ShieldX } from 'lucide-react';
import { WEBSITE_URL } from '@/lib/links';

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 py-20 text-center">
      <div className="pointer-events-none absolute inset-0 bg-solana-gradient-radial" aria-hidden="true" />
      <div className="relative z-10 flex max-w-2xl flex-col items-center">
        <span className="mb-6 rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium uppercase tracking-wide text-mutedText">
          Devnet only · open source
        </span>
        <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl">
          AI agents can now pay for things.
          <br />
          <span className="bg-solana-gradient-text bg-clip-text text-transparent">Atlas Rail makes sure they only pay what they&rsquo;re allowed to</span>, and proves it.
        </h1>
        <p className="mt-6 max-w-lg text-base text-mutedText">
          Check a real payment from the Solana chain, or try to make an agent overspend. The real gate rules decide, live.
        </p>
        <p className="mt-3 max-w-lg text-xs text-mutedText">
          The full 7-step demo runs on your laptop with <code className="font-mono">pnpm demo</code>.
        </p>
        <Link
          href="/verify"
          className="group mt-10 inline-flex items-center gap-2 rounded-full bg-solana-gradient px-8 py-4 text-base font-semibold text-background shadow-glow transition-transform hover:scale-[1.03] focus-visible:scale-[1.03]"
        >
          <Search className="h-5 w-5" aria-hidden="true" /> Verify a real payment
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </Link>
        <div className="mt-6 flex flex-col items-center gap-3 text-sm font-medium sm:flex-row sm:gap-6">
          <Link href="/break" className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
            <ShieldX className="h-4 w-4 text-deny" aria-hidden="true" /> Try to break the gate
          </Link>
          <Link href="/demo" className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
            Run the full demo
          </Link>
          <Link href="/wallet" className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
            Connect a Solana wallet
          </Link>
          <Link href="/fund" className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
            Fund a devnet channel
          </Link>
          <Link href="/mandate" className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
            Create an on-chain mandate
          </Link>
        </div>
        <div className="mt-12 flex items-center gap-6 text-sm text-mutedText">
          <a href={WEBSITE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-white">
            <Globe className="h-4 w-4" aria-hidden="true" /> Website
          </a>
          <a href="https://github.com/Rime504/atlas-rail" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-white">
            <Github className="h-4 w-4" aria-hidden="true" /> GitHub
          </a>
          <a
            href="https://github.com/Rime504/atlas-rail/blob/master/spec/agent-mandate-v0.1.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 hover:text-white"
          >
            <FileText className="h-4 w-4" aria-hidden="true" /> The spec
          </a>
        </div>
      </div>
    </main>
  );
}
