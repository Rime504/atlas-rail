import './globals.css';
import { Navigation } from '../components/Navigation';

export const metadata = {
  title: 'Atlas Rail — Programmable Treasury Controls for Solana',
  description: 'Devnet-only treasury governance, multi-approval authorization, and safe USDC payout platform.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Navigation>{children}</Navigation>
      </body>
    </html>
  );
}
