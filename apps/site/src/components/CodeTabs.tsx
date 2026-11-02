'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

const AGENT = `import { createAtlasRail, keypairWallet } from 'atlasrails';

const atlas = createAtlasRail({
  apiUrl: process.env.ATLAS_API_URL, // the gate
  apiToken: process.env.ATLAS_VOUCHER_TOKEN,
  connection, // Solana devnet
  wallet: keypairWallet({ path: './payer.json' }),
  gate, // the key that signs receipts
  execution: 'autoExecute',
});

const result = await atlas.pay({ mandate, channel, recipient, mint, amount: 1000n, resourceUrl, network, expiresAt, mandateAddress });

if (result.status === 'paid') console.log('paid, receipt', result.receipt.id);
else console.log('not allowed:', result.reason);`;

const BUILD = `git clone https://github.com/Rime504/atlas-rail.git
cd atlas-rail
pnpm install
pnpm --filter atlasrails build
node scripts/launch-voucher-services.mjs both # the gate and the signer`;

const TABS = [
  { id: 'agent', label: 'your agent', note: 'pay()', code: AGENT, lang: 'ts' },
  { id: 'build', label: 'build from the repo', note: 'today', code: BUILD, lang: 'sh' },
] as const;

const KEYWORDS = /\b(import|from|const|await|try|catch|if|else|instanceof|new|return)\b/;

/** Just enough highlighting for two fixed snippets: comments, strings, keywords. */
function highlight(code: string, lang: 'ts' | 'sh') {
  return code.split('\n').map((line, i) => {
    const parts: React.ReactNode[] = [];
    // A comment starts at a `//` that begins the line or follows a space (never the `//` inside a URL).
    const commentMatch = lang === 'ts' ? /(^|\s)\/\/\s/.exec(line) : null;
    const commentAt = commentMatch ? commentMatch.index + commentMatch[1].length : -1;
    const body = commentAt >= 0 ? line.slice(0, commentAt) : line;
    const tokens = body.split(/('[^']*'|\s+|[(){}.,;:!?])/).filter(Boolean);
    tokens.forEach((t, j) => {
      if (t.startsWith("'")) parts.push(<span key={j} className="text-mint/90">{t}</span>);
      else if (lang === 'ts' && KEYWORDS.test(t) && t.match(KEYWORDS)?.[0] === t) parts.push(<span key={j} className="text-violet-text">{t}</span>);
      else if (lang === 'sh' && /^-[-\w]*$/.test(t)) parts.push(<span key={j} className="text-violet-text">{t}</span>);
      else parts.push(t);
    });
    if (commentAt >= 0) parts.push(<span key="c" className="text-faint">{line.slice(commentAt)}</span>);
    return (
      <span key={i} className="block pl-[2ch] -indent-[2ch]">
        {parts.length ? parts : ' '}
      </span>
    );
  });
}

export function CodeTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>('agent');
  const [copied, setCopied] = useState(false);
  const tab = TABS.find((t) => t.id === active)!;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tab.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the code stays selectable.
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line pl-2 pr-2">
        <div role="tablist" aria-label="Integration examples" className="flex">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              type="button"
              id={`tab-${t.id}`}
              aria-selected={active === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`relative px-3 py-3.5 text-[13px] transition-colors sm:px-4 ${active === t.id ? 'text-white' : 'text-faint hover:text-muted'}`}
            >
              {t.label}
              {active === t.id && <span aria-hidden="true" className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
            </button>
          ))}
        </div>
        <button type="button" onClick={copy} aria-label="Copy code" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-faint transition-colors hover:bg-white/5 hover:text-white">
          {copied ? <Check className="h-4 w-4 text-mint" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <div role="tabpanel" id={`panel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} tabIndex={0}>
        <pre className="whitespace-pre-wrap break-words p-5 font-mono text-[12.5px] leading-[1.75] text-white/85 sm:p-6 sm:text-[13px]">
          <code>{highlight(tab.code, tab.lang)}</code>
        </pre>
      </div>
      <p className="border-t border-line px-5 py-3 text-[12px] text-faint sm:px-6">
        Devnet only. Build from the repository today; the npm package is coming soon. Setup steps: <span className="font-mono">packages/atlasrails/MANUAL.md</span>.
      </p>
    </div>
  );
}
