import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';

// One font family, one weight subset: next/font/google self-hosts whatever we ask for, and extra
// weights/families cost real mobile CPU time at hydration (measured with Lighthouse — see
// docs/PROGRESS.md). Inter alone, at the weights this page actually uses, keeps the budget tight.
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Atlas Rail Playground',
  description:
    'AI agents can now pay for things. See Atlas Rail make sure one only pays what it is allowed to, and prove it — live, in your browser, no signup.',
  metadataBase: new URL('https://playground.atlasrail.dev'),
  openGraph: {
    title: 'Atlas Rail Playground',
    description: 'Proof of permission for every AI agent payment on Solana. Watch payments get allowed, escalated and blocked, then verify one from the chain.',
    type: 'website',
  },
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
