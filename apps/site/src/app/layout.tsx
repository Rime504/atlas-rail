import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { SITE_URL } from '@/content';

// Latin variable font checked in (src/fonts, SIL OFL): the build never fetches from Google Fonts.
const spaceGrotesk = localFont({ src: '../fonts/space-grotesk.woff2', weight: '300 700', variable: '--font-space-grotesk', display: 'swap' });

const TITLE = 'Atlas Rail · Proof of permission for every AI agent payment';
const DESCRIPTION =
  'The authorization layer for AI agent payments on Solana: a signed mandate, a gate before any wallet signs, and proof anyone can check. Open source, live on Solana devnet.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: 'Atlas Rail',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'Atlas Rail',
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: '#07070B',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-ink">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
