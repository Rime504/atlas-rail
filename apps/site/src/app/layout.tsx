import './globals.css';
import type { Metadata } from 'next';
import localFont from 'next/font/local';

// Latin variable fonts checked in (src/fonts, SIL OFL): the build never fetches from Google Fonts.
const inter = localFont({ src: '../fonts/inter.woff2', weight: '100 900', variable: '--font-inter', display: 'swap' });
const spaceGrotesk = localFont({ src: '../fonts/space-grotesk.woff2', weight: '300 700', variable: '--font-space-grotesk', display: 'swap' });

export const metadata: Metadata = {
  title: 'Atlas Rail — Your AI agent can be tricked. Your treasury shouldn’t be.',
  description:
    'Proof of permission for every AI agent payment on Solana: a signed mandate, a 15-rule gate before any signature, human approval for edge cases, and a receipt anyone can verify from the chain. Open source, devnet only.',
  metadataBase: new URL('https://atlasrail.dev'),
  openGraph: {
    title: 'Atlas Rail',
    description:
      'Proof of permission for every AI agent payment on Solana. Open source, devnet only.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Atlas Rail',
    description:
      'Proof of permission for every AI agent payment on Solana. Open source, devnet only.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
