'use client';

import { useState, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** "Technical details sit behind Show details toggles" — a plain collapsible for anything a judge
 * might want to inspect but a first-time visitor doesn't need to see. */
export function Details({ label = 'Show details', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-mutedText transition hover:text-white"
        aria-expanded={open}
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        {open ? 'Hide details' : label}
      </button>
      {open && <div className="mt-3 animate-fade-in">{children}</div>}
    </div>
  );
}

/** Shortened start…end, tap-to-copy (the full value is what actually gets copied) — the only way a
 * 44-character Solana address can appear inline without ever causing horizontal overflow. */
export function MonoAddress({ value, chars = 6 }: { value: string; chars?: number }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > chars * 2 + 1 ? `${value.slice(0, chars)}…${value.slice(-chars)}` : value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — the full value is still in the title.
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied!' : value}
      className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-mutedText transition hover:text-white"
    >
      {copied ? 'Copied!' : short}
    </button>
  );
}

export function ExplorerLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-solana-green underline-offset-4 hover:underline"
    >
      View on Solana Explorer ↗
    </a>
  );
}
