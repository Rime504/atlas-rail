import type { Metadata } from 'next';
import { VerifyClient } from './VerifyClient';

export const metadata: Metadata = {
  title: 'Verify any payment · Atlas Rail',
  description: 'Paste a Solana devnet transaction and check, from the chain alone, whether an AI agent was allowed to make it.',
};

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ tx?: string; decision?: string }> }) {
  const { tx, decision } = await searchParams;
  return <VerifyClient initialTx={tx ?? null} initialDecision={decision ?? null} />;
}
