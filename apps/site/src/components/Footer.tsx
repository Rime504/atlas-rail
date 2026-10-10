import { Wordmark } from './Logo';
import { GITHUB, PLAYGROUND, PROGRAM, SPEC, VERIFY, X_URL } from '@/content';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Playground', href: PLAYGROUND },
      { label: 'Verify a payment', href: VERIFY },
    ],
  },
  {
    title: 'Build',
    links: [
      { label: 'GitHub', href: GITHUB },
      { label: 'The spec', href: SPEC },
      { label: 'Program on Solana Explorer', href: PROGRAM },
    ],
  },
  {
    title: 'Follow',
    // X_URL is a placeholder until the account exists (src/content.ts).
    links: [{ label: 'X', href: X_URL }],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-page gap-12 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-[14px] leading-relaxed text-faint">The authorization layer for AI agent payments on Solana.</p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[13px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" aria-hidden="true" />
            Live on Solana devnet
          </p>
        </div>
        {COLUMNS.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <p className="text-[13px] font-medium text-white">{col.title}</p>
            <ul className="mt-4 space-y-3">
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href}
                    {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}
                    className="text-[14px] text-faint transition-colors hover:text-white"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto max-w-page border-t border-line px-5 py-6 text-[13px] text-faint sm:px-8">
        Devnet only: the server refuses mainnet RPC endpoints. Not audited. Apache 2.0 licensed.
      </div>
    </footer>
  );
}
