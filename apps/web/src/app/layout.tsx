import './globals.css';
import { Inter, Space_Grotesk } from 'next/font/google';
import { AuthProvider } from '../lib/auth-context';
import { ToastProvider } from '../components/Toast';
import { Navigation } from '../components/Navigation';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

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
