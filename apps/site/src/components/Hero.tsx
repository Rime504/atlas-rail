import { ArrowRight } from 'lucide-react';
import { FlowVisual } from './FlowVisual';
import { PLAYGROUND, VERIFY } from '@/content';

export function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden pt-28 sm:pt-36">
      <div aria-hidden="true" className="hero-grid absolute inset-0 -z-10" />
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-0 -z-10 h-[520px] w-[900px] -translate-x-1/2 opacity-60 [background:radial-gradient(closest-side,rgba(139,92,246,0.22),transparent_70%)]"
      />

      <div className="mx-auto max-w-page px-5 text-center sm:px-8">
        <p className="rise inline-flex items-center gap-2 rounded-full border border-line bg-white/[0.03] px-3.5 py-1.5 text-[13px] text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" aria-hidden="true" />
          Live on Solana devnet · Open source
        </p>
        <h1 className="mx-auto mt-7 max-w-[15ch] text-[42px] font-semibold leading-[1.04] tracking-[-0.035em] text-white sm:text-[64px] lg:text-[76px]">
          Proof of permission for every AI agent payment.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-[18px] leading-relaxed text-muted sm:text-[20px]">
          The authorization layer for AI agent payments on Solana.
        </p>
        <div className="rise rise-4 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={PLAYGROUND} target="_blank" rel="noreferrer" className="btn-primary w-full sm:w-auto">
            Try it live <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <a href={VERIFY} target="_blank" rel="noreferrer" className="btn-secondary w-full sm:w-auto">
            Verify a payment
          </a>
        </div>
      </div>

      <div className="rise rise-4 mx-auto mt-16 max-w-page px-5 sm:mt-20 sm:px-8">
        <FlowVisual />
      </div>
    </section>
  );
}
