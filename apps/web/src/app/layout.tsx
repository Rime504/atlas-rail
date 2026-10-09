import './globals.css';
import localFont from 'next/font/local';
import { AuthProvider } from '../lib/auth-context';
import { ToastProvider } from '../components/Toast';
import { Navigation } from '../components/Navigation';

// Latin variable fonts checked in (src/fonts, SIL OFL): the build never fetches from Google Fonts.
const inter = localFont({ src: '../fonts/inter.woff2', weight: '100 900', variable: '--font-inter', display: 'swap' });
const spaceGrotesk = localFont({ src: '../fonts/space-grotesk.woff2', weight: '300 700', variable: '--font-space-grotesk', display: 'swap' });

export const metadata = {
  title: 'Atlas Rail — Programmable Treasury Controls for Solana',
  description:
    'Devnet-only treasury governance, multi-approval authorization, and safe USDC payout platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans">
        <AuthProvider>
          <ToastProvider>
            <Navigation>{children}</Navigation>
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
