import './globals.css';
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { PLAYGROUND_URL } from '@/lib/links';

// One font family: extra families cost real mobile CPU time at hydration (measured with Lighthouse —
// see docs/PROGRESS.md). Inter's latin variable font is checked in (src/fonts, SIL OFL) so the build
// never depends on fetching from Google Fonts, which made CI flaky.
const inter = localFont({ src: '../fonts/inter.woff2', weight: '100 900', variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Atlas Rail Playground',
  description:
    'AI agents can now pay for things. See Atlas Rail make sure one only pays what it is allowed to, and prove it — live, in your browser, no signup.',
  metadataBase: new URL(PLAYGROUND_URL),
  openGraph: {
    url: '/',
    title: 'Atlas Rail Playground',
    description: 'Proof of permission for every AI agent payment on Solana. Watch payments get allowed, escalated and blocked, then verify one from the chain.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#050611',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
