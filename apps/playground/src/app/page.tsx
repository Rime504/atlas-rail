import Link from 'next/link';
import { ArrowRight, FileText, Github, Search, ShieldX } from 'lucide-react';

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
          An 8-step guided walkthrough, running the real policy gate and receipt code. No signup, nothing to install.
        </p>
        <Link
          href="/demo"
          className="group mt-10 inline-flex items-center gap-2 rounded-full bg-solana-gradient px-8 py-4 text-base font-semibold text-background shadow-glow transition-transform hover:scale-[1.03] focus-visible:scale-[1.03]"
        >
          Start the demo
          <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </Link>
        <div className="mt-6 flex flex-col items-center gap-3 text-sm font-medium sm:flex-row sm:gap-6">
          <Link href="/break" className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
            <ShieldX className="h-4 w-4 text-deny" aria-hidden="true" /> Watch an attack get blocked
          </Link>
          <Link href="/verify" className="inline-flex items-center gap-1.5 text-white/90 hover:text-white">
            <Search className="h-4 w-4 text-allow" aria-hidden="true" /> Verify a real payment
          </Link>
        </div>
        <div className="mt-12 flex items-center gap-6 text-sm text-mutedText">
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
