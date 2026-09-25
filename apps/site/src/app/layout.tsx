import './globals.css';
import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Atlas Rail — Your AI agent can be tricked. Your treasury shouldn’t be.',
  description:
    'Atlas Rail is an open-source policy and evidence layer for agent payments on Solana: signed mandates, a policy gate, human approval and verifiable receipts. Devnet only.',
  metadataBase: new URL('https://atlasrail.dev'),
  openGraph: {
    title: 'Atlas Rail',
    description:
      'An open-source policy and evidence layer for agent payments on Solana. Devnet only.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Atlas Rail',
    description:
      'An open-source policy and evidence layer for agent payments on Solana. Devnet only.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
